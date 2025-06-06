import { App, Notice, Plugin, PluginSettingTab, Setting, addIcon } from 'obsidian';
import { Groq } from 'groq-sdk';
import { PROMPT, TITLE_PROMPT } from './prompt';
import { ID8_SVG } from 'id8_svg';

interface Id8PluginSettings {
	groqApiKey: string;
}

const DEFAULT_SETTINGS: Id8PluginSettings = {
	groqApiKey: ''
}

export default class Id8Plugin extends Plugin {
	settings: Id8PluginSettings;

	private async transcribeAudio() {
		try {
			const file = this.app.workspace.getActiveFile();
			if (!file) {
				new Notice('No active file.');
				return;
			}

			if (file.extension !== 'm4a') {
				new Notice('File is not an audio file.');
				return;
			}

			new Notice('Transcribing audio...');
			const audioContent = await this.app.vault.readBinary(file);
			const groq = new Groq({
				apiKey: this.settings.groqApiKey,
				dangerouslyAllowBrowser: true,
			});

			const transcription = await groq.audio.transcriptions.create({
				model: 'whisper-large-v3',
				file: new File([audioContent], file.name, { type: 'audio/m4a' }),
				language: 'en',
				response_format: 'text',
			});

			const summarized = await groq.chat.completions.create({
				model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
				messages: [
					{
						role: 'user',
						content: PROMPT.replace('{{transcription}}', transcription as any as string),
					},
				],
			})
			const title_res = await groq.chat.completions.create({
				model: 'llama-3.1-8b-instant',
				messages: [
					{
						role: 'user',
						content: TITLE_PROMPT.replace('{{notes}}', summarized.choices[0].message.content || ''),
					},
				],
				response_format: { type: 'json_object' },
			})
			const today = new Date();
			const dateAndTime = `${today.toLocaleDateString()} ${today.toLocaleTimeString()}`;
			const title = JSON.parse(title_res.choices[0].message.content || '{}').title?.replace(/[^a-zA-Z0-9\s]/g, '') ?? `Untitled`;

			const noteContents = `Date: ${dateAndTime}

${summarized.choices[0].message.content}`

			const newFile = await this.app.vault.create(file.path.replace(file.name, `${title}.md`), noteContents);
			await this.app.workspace.getLeaf(true).openFile(newFile);
			new Notice('Done! Created note: ' + newFile.name);
		} catch (e) {
			new Notice('Error transcribing audio: ' + e);
		}
	}

	async onload() {
		await this.loadSettings();

		addIcon('id8', ID8_SVG);

		this.addRibbonIcon('id8', 'Transcribe with id8', () => {
			this.transcribeAudio();
		});

		this.addCommand({
			id: 'id8-transcribe-audio',
			name: 'Transcribe audio',
			callback: async () => {
				this.transcribeAudio();
			}
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: Id8Plugin;

	constructor(app: App, plugin: Id8Plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Groq API Key')
			.setDesc('Get your API key from: https://console.groq.com/keys')
			.addText((text) => {
				text.inputEl.type = 'password';
				return text.setPlaceholder('gsk_XXXXX')
					.setValue(this.plugin.settings.groqApiKey)
					.onChange(async (value) => {
						this.plugin.settings.groqApiKey = value;
						await this.plugin.saveSettings();
					})
			});
	}
}
