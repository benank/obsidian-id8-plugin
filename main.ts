import { App, Notice, Plugin, PluginSettingTab, Setting, addIcon, Editor, MarkdownView, TFile } from 'obsidian';
import { Groq } from 'groq-sdk';
import { PROMPT, TITLE_PROMPT } from './prompt';
import { ID8_SVG } from 'id8_svg';
import { InlineMenuManager } from './inline-menu';

interface Id8PluginSettings {
	groqApiKey: string;
	selectedModel: string;
	dailyWordCount: number;
	baselineWordCount: number; // Word count at the start of tracking
}

const DEFAULT_SETTINGS: Id8PluginSettings = {
	groqApiKey: '',
	selectedModel: 'llama-3.1-8b-instant',
	dailyWordCount: 0,
	baselineWordCount: 0
}

export default class Id8Plugin extends Plugin {
	settings: Id8PluginSettings;
	private inlineMenuManager: InlineMenuManager;
	private statusBarItem: HTMLElement;
	private dailyGoal: number = 1000;
	private static STORIES_FOLDER = 'Stories/';

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

		// Initialize the inline menu manager
		this.inlineMenuManager = new InlineMenuManager(this.app, {
			groqApiKey: this.settings.groqApiKey,
			selectedModel: this.settings.selectedModel
		});
		this.addChild(this.inlineMenuManager);

		// Initialize word count tracking
		this.setupStatusBar();
		this.setupWordCountTracking();
		this.calculateInitialWordCount();

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

		// Add command for inline AI menu with Cmd+K hotkey override
		this.addCommand({
			id: 'id8-inline-menu',
			name: 'Open inline AI menu',
			hotkeys: [{ modifiers: ['Mod'], key: 'k' }],
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.inlineMenuManager.handleInlineMenuCommand(editor, view);
			}
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	/**
	 * Reset the word count when user clicks the status bar
	 */
	private async resetWordCount() {
		const currentTotal = await this.getTotalStoriesWordCount();
		this.settings.dailyWordCount = 0;
		this.settings.baselineWordCount = currentTotal;
		await this.saveSettings();
		this.updateStatusBar();
		new Notice('Word count reset!');
	}





	/**
	 * Set up the status bar item to display word count progress with click to reset
	 */
	private setupStatusBar() {
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.style.cursor = 'pointer';
		this.statusBarItem.addEventListener('click', () => {
			this.resetWordCount();
		});
		this.updateStatusBar();
	}

	/**
	 * Update the status bar with current progress
	 */
	private updateStatusBar() {
		const actualPercentage = Math.round((this.settings.dailyWordCount / this.dailyGoal) * 100);
		const circlePercentage = Math.min(100, actualPercentage); // Cap circle progress at 100%
		
		// Create a circular progress indicator (capped at 100%)
		const svg = `<svg width="16" height="16" viewBox="0 0 16 16" style="margin-right: 4px; vertical-align: middle;">
			<circle cx="8" cy="8" r="6" fill="none" stroke="var(--text-muted)" stroke-width="2"/>
			<circle cx="8" cy="8" r="6" fill="none" stroke="var(--text-accent)" stroke-width="2"
				stroke-dasharray="${2 * Math.PI * 6}" 
				stroke-dashoffset="${2 * Math.PI * 6 * (1 - circlePercentage / 100)}"
				transform="rotate(-90 8 8)" style="transition: stroke-dashoffset 0.3s ease;"/>
		</svg>`;
		
		// Show actual percentage (can exceed 100%)
		this.statusBarItem.innerHTML = `${svg}${actualPercentage}%`;
		this.statusBarItem.title = `Writing progress: ${this.settings.dailyWordCount}/${this.dailyGoal} words (${actualPercentage}%)\nClick to reset count`;
	}

	/**
	 * Set up word count tracking for files in the Stories folder
	 */
	private setupWordCountTracking() {
		// Track when files are modified
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.path.includes(Id8Plugin.STORIES_FOLDER) && file.extension === 'md') {
					this.updateWordCountForFile(file);
				}
			})
		);

		// Track when files are created
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.path.includes(Id8Plugin.STORIES_FOLDER) && file.extension === 'md') {
					this.updateWordCountForFile(file);
				}
			})
		);


	}

	/**
	 * Calculate the initial word count for all files in Stories folder
	 */
	private async calculateInitialWordCount() {
		const currentTotal = await this.getTotalStoriesWordCount();
		
		// If this is the first time or we don't have a baseline, set it
		if (this.settings.baselineWordCount === 0) {
			this.settings.baselineWordCount = currentTotal;
			await this.saveSettings();
		}
		
		// Calculate daily progress as difference from baseline
		this.settings.dailyWordCount = Math.max(0, currentTotal - this.settings.baselineWordCount);
		await this.saveSettings();
		this.updateStatusBar();
	}

	/**
	 * Get total word count for all Stories files
	 */
	private async getTotalStoriesWordCount(): Promise<number> {
		const files = this.app.vault.getMarkdownFiles();
		let totalWords = 0;

		for (const file of files) {
			if (file.path.includes(Id8Plugin.STORIES_FOLDER)) {
				try {
					const content = await this.app.vault.read(file);
					totalWords += this.countWords(content);
				} catch (error) {
					// File might be deleted, skip
					continue;
				}
			}
		}

		return totalWords;
	}

	/**
	 * Update word count when a file is modified
	 */
	private async updateWordCountForFile(file: TFile) {
		if (!file.path.includes(Id8Plugin.STORIES_FOLDER) || file.extension !== 'md') return;
		
		// Debounce to avoid too frequent updates
		setTimeout(async () => {
			await this.recalculateTotalWordCount();
		}, 1000);
	}

	/**
	 * Recalculate daily word count based on current total vs baseline
	 */
	private async recalculateTotalWordCount() {
		const currentTotal = await this.getTotalStoriesWordCount();
		
		// Calculate daily progress as difference from baseline
		this.settings.dailyWordCount = Math.max(0, currentTotal - this.settings.baselineWordCount);
		await this.saveSettings();
		this.updateStatusBar();
	}

	/**
	 * Count words in a text content
	 */
	private countWords(content: string): number {
		// Remove markdown syntax and count words
		const text = content
			.replace(/```[\s\S]*?```/g, '') // Remove code blocks
			.replace(/`[^`]*`/g, '') // Remove inline code
			.replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
			.replace(/\[.*?\]\(.*?\)/g, '') // Remove links
			.replace(/[#*_~\[\]()]/g, ' ') // Remove markdown characters
			.replace(/\s+/g, ' ') // Normalize whitespace
			.trim();
		
		if (!text) return 0;
		return text.split(/\s+/).length;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Update the inline menu manager with new settings
		if (this.inlineMenuManager) {
			this.inlineMenuManager.updateSettings({
				groqApiKey: this.settings.groqApiKey,
				selectedModel: this.settings.selectedModel
			});
		}
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

		new Setting(containerEl)
			.setName('Default Model')
			.setDesc('Select the default AI model to use for text operations')
			.addDropdown((dropdown) => {
				const models = [
					'llama-3.1-8b-instant',
					'llama-3.3-70b-versatile',
					'openai/gpt-oss-20b',
					'openai/gpt-oss-120b',
					'moonshotai/kimi-k2-instruct'
				];

				models.forEach(model => {
					dropdown.addOption(model, model);
				});

				return dropdown
					.setValue(this.plugin.settings.selectedModel)
					.onChange(async (value) => {
						this.plugin.settings.selectedModel = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
