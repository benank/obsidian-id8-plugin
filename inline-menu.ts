import { App, Editor, MarkdownView, Menu, Notice, Component, Modal } from 'obsidian';
import { Groq } from 'groq-sdk';

export interface InlineMenuSettings {
    groqApiKey: string;
    selectedModel: string;
}

/**
 * Represents a single diff operation
 */
interface DiffOperation {
    type: 'equal' | 'delete' | 'insert';
    text: string;
}

/**
 * Represents the result of a diff comparison
 */
interface DiffResult {
    operations: DiffOperation[];
    hasChanges: boolean;
}

/**
 * Modal for collecting custom instructions
 */
class CustomInstructionModal extends Modal {
    private action: string;
    private selectedText: string;
    private settings: InlineMenuSettings;
    private onSubmit: (instructions: string, model: string, includeContext: boolean) => void;
    private onCancel: () => void;
    private onModelChange: (model: string) => void;
    private includeContextCheckbox: HTMLInputElement | null = null;

    constructor(
        app: App, 
        action: string,
        selectedText: string,
        settings: InlineMenuSettings,
        onSubmit: (instructions: string, model: string, includeContext: boolean) => void,
        onCancel: () => void,
        onModelChange: (model: string) => void
    ) {
        super(app);
        this.action = action;
        this.selectedText = selectedText;
        this.settings = settings;
        this.onSubmit = onSubmit;
        this.onCancel = onCancel;
        this.onModelChange = onModelChange;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Modal title
        contentEl.createEl('h2', { text: `Add Custom Instructions - ${this.action}` });

        // Model selection dropdown
        const modelContainer = contentEl.createDiv('custom-instruction-model-container');
        modelContainer.createEl('label', { 
            text: 'Model:',
            cls: 'custom-instruction-label'
        });
        
        const modelSelect = modelContainer.createEl('select', {
            cls: 'custom-instruction-model-select'
        });

        const models = [
            'llama-3.1-8b-instant',
            'llama-3.3-70b-versatile',
            'openai/gpt-oss-20b',
            'openai/gpt-oss-120b',
            'moonshotai/kimi-k2-instruct'
        ];

        models.forEach(model => {
            const option = modelSelect.createEl('option', {
                value: model,
                text: model
            });
            if (model === this.settings.selectedModel) {
                option.selected = true;
            }
        });

        modelSelect.addEventListener('change', () => {
            this.onModelChange(modelSelect.value);
        });

        // Show selected text
        const selectedTextContainer = contentEl.createDiv('custom-instruction-selected-text');
        selectedTextContainer.createEl('label', { text: 'Selected text:' });
        const textPreview = selectedTextContainer.createDiv('custom-instruction-text-preview');
        textPreview.textContent = this.selectedText;

        // Instructions input
        const instructionsContainer = contentEl.createDiv('custom-instruction-input-container');
        instructionsContainer.createEl('label', { 
            text: 'Additional instructions (optional):',
            cls: 'custom-instruction-label'
        });
        
        const textarea = instructionsContainer.createEl('textarea', {
            cls: 'custom-instruction-textarea',
            attr: {
                placeholder: `Enter any specific instructions for how to ${this.action} this text...`,
                rows: '4'
            }
        });

        // Context checkbox container
        const contextContainer = contentEl.createDiv('custom-instruction-context-container');
        const contextLabel = contextContainer.createEl('label', {
            cls: 'custom-instruction-context-label'
        });
        
        this.includeContextCheckbox = contextLabel.createEl('input', {
            type: 'checkbox',
            cls: 'custom-instruction-context-checkbox'
        });
        this.includeContextCheckbox.checked = true; // ON by default
        
        contextLabel.createSpan({
            text: ' Include context (500 chars before/after)',
            cls: 'custom-instruction-context-text'
        });

        // Button container
        const buttonContainer = contentEl.createDiv('custom-instruction-buttons');
        
        // Submit button
        const submitBtn = buttonContainer.createEl('button', {
            text: `Apply ${this.action}`,
            cls: 'mod-cta custom-instruction-submit-btn'
        });
        submitBtn.onclick = () => {
            this.close();
            this.onSubmit(textarea.value.trim(), modelSelect.value, this.includeContextCheckbox?.checked || false);
        };

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'custom-instruction-cancel-btn'
        });
        cancelBtn.onclick = () => {
            this.close();
            this.onCancel();
        };

        // Focus on textarea
        textarea.focus();

        // Handle Enter key (Shift+Enter for new line, Enter to submit)
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitBtn.click();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Modal that displays diff preview with accept/reject options
 */
class DiffPreviewModal extends Modal {
    private originalText: string;
    private newText: string;
    private diffResult: DiffResult;
    private onAccept: () => void;
    private onReject: () => void;

    constructor(
        app: App, 
        originalText: string, 
        newText: string, 
        diffResult: DiffResult,
        onAccept: () => void,
        onReject: () => void
    ) {
        super(app);
        this.originalText = originalText;
        this.newText = newText;
        this.diffResult = diffResult;
        this.onAccept = onAccept;
        this.onReject = onReject;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Modal title
        contentEl.createEl('h2', { text: 'Preview Changes' });

        // Diff container
        const diffContainer = contentEl.createDiv('diff-preview-container');
        
        if (!this.diffResult.hasChanges) {
            diffContainer.createEl('p', { 
                text: 'No changes detected.',
                cls: 'diff-no-changes'
            });
        } else {
            this.renderDiff(diffContainer);
        }

        // Button container
        const buttonContainer = contentEl.createDiv('diff-buttons');
        
        // Accept button
        const acceptBtn = buttonContainer.createEl('button', {
            text: 'Accept Changes',
            cls: 'mod-cta diff-accept-btn'
        });
        acceptBtn.onclick = () => {
            this.close();
            this.onAccept();
        };

        // Reject button
        const rejectBtn = buttonContainer.createEl('button', {
            text: 'Reject Changes',
            cls: 'diff-reject-btn'
        });
        rejectBtn.onclick = () => {
            this.close();
            this.onReject();
        };

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'diff-cancel-btn'
        });
        cancelBtn.onclick = () => {
            this.close();
        };
    }

    /**
     * Render the diff visualization
     */
    private renderDiff(container: HTMLElement) {
        const diffElement = container.createDiv('diff-content');
        
        this.diffResult.operations.forEach(operation => {
            const span = diffElement.createSpan();
            span.textContent = operation.text;
            
            switch (operation.type) {
                case 'delete':
                    span.addClass('diff-delete');
                    break;
                case 'insert':
                    span.addClass('diff-insert');
                    break;
                case 'equal':
                    span.addClass('diff-equal');
                    break;
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Manages the inline menu functionality for text selection and AI-powered text operations
 */
export class InlineMenuManager extends Component {
    private app: App;
    private settings: InlineMenuSettings;
    private menu: Menu | null = null;
    private currentEditor: Editor | null = null;
    private selectedText: string = '';
    private selectionStart: { line: number; ch: number } | null = null;
    private selectionEnd: { line: number; ch: number } | null = null;

    constructor(app: App, settings: InlineMenuSettings) {
        super();
        this.app = app;
        this.settings = settings;
    }

    /**
     * Initialize the inline menu functionality by registering event handlers
     */
    onload() {
        // Add CSS styles for the menu
        this.addMenuStyles();
    }

    /**
     * Clean up when the component is unloaded
     */
    onunload() {
        this.hideMenu();
    }

    /**
     * Handle the inline menu command trigger
     */
    handleInlineMenuCommand(editor: Editor, view: MarkdownView) {
        const selectedText = editor.getSelection();
        
        if (selectedText.trim().length > 0) {
            this.showInlineMenu(editor, selectedText);
        } else {
            new Notice('Please select some text first to use the inline AI menu.');
        }
    }

    /**
     * Show the inline menu at the current cursor position
     */
    private showInlineMenu(editor: Editor, selectedText: string) {
        this.currentEditor = editor;
        this.selectedText = selectedText;
        
        // Store selection positions (ensure start comes before end)
        const selection = editor.listSelections()[0];
        const anchor = selection.anchor;
        const head = selection.head;
        
        // Compare positions to ensure start is before end
        if (anchor.line < head.line || (anchor.line === head.line && anchor.ch < head.ch)) {
            this.selectionStart = anchor;
            this.selectionEnd = head;
        } else {
            this.selectionStart = head;
            this.selectionEnd = anchor;
        }
        
        // Create and show menu
        this.menu = new Menu();
        
        // Add menu items
        this.menu.addItem((item) => {
            item.setTitle('✨ Rewrite')
                .setIcon('edit')
                .onClick(() => {
                    this.showCustomInstructionModal('rewrite', selectedText);
                });
        });
        
        this.menu.addItem((item) => {
            item.setTitle('📝 Add detail')
                .setIcon('plus-circle')
                .onClick(() => {
                    this.showCustomInstructionModal('add_detail', selectedText);
                });
        });
        
        this.menu.addItem((item) => {
            item.setTitle('🎯 Summarize')
                .setIcon('list')
                .onClick(() => {
                    this.showCustomInstructionModal('summarize', selectedText);
                });
        });
        
        this.menu.addItem((item) => {
            item.setTitle('🔧 Fix grammar')
                .setIcon('check-circle')
                .onClick(() => {
                    this.showCustomInstructionModal('fix_grammar', selectedText);
                });
        });
        
        this.menu.addItem((item) => {
            item.setTitle('🔄 Synonym')
                .setIcon('shuffle')
                .onClick(() => {
                    this.showCustomInstructionModal('synonym', selectedText);
                });
        });
        
        this.menu.addSeparator();
        
        this.menu.addItem((item) => {
            item.setTitle('Cancel')
                .setIcon('x')
                .onClick(() => {
                    this.hideMenu();
                });
        });
        
        // Position the menu at mouse position or fallback to center
        this.menu.showAtMouseEvent(new MouseEvent('click', {
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2
        }));
    }

    /**
     * Hide the current menu
     */
    private hideMenu() {
        if (this.menu) {
            this.menu.hide();
            this.menu = null;
        }
    }

    /**
     * Show custom instruction modal for the selected action
     */
    private showCustomInstructionModal(action: string, text: string) {
        this.hideMenu();
        
        const modal = new CustomInstructionModal(
            this.app,
            action,
            text,
            this.settings,
            (customInstructions: string, selectedModel: string, includeContext: boolean) => {
                this.performAction(action, text, customInstructions, selectedModel, includeContext);
            },
            () => {
                // User cancelled, do nothing
            },
            (selectedModel: string) => {
                // Update settings when model changes
                this.settings.selectedModel = selectedModel;
            }
        );
        
        modal.open();
    }

    /**
     * Perform the selected action using Groq API
     */
    private async performAction(action: string, text: string, customInstructions?: string, selectedModel?: string, includeContext?: boolean) {
        
        if (!this.settings.groqApiKey) {
            new Notice('Please configure your Groq API key in the plugin settings.');
            return;
        }
        
        if (!this.currentEditor) {
            new Notice('No active editor found.');
            return;
        }
        
        try {
            new Notice(`Processing: ${action}...`);
            
            const groq = new Groq({
                apiKey: this.settings.groqApiKey,
                dangerouslyAllowBrowser: true,
            });
            
            const prompt = this.getPromptForAction(action, text, customInstructions);
            const contextText = includeContext ? this.getContextText() : '';
            
            const modelToUse = selectedModel || this.settings.selectedModel || 'llama-3.1-8b-instant';
            
            const messages: any[] = [
                {
                    role: 'user',
                    content: prompt,
                }
            ];

            // Add context as a separate message if included
            if (includeContext && contextText) {
                messages.push({
                    role: 'user',
                    content: `CONTEXT:\n${contextText}`
                });
            }
            
            const response = await groq.chat.completions.create({
                model: modelToUse,
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000,
            });
            
            const result = response.choices[0]?.message?.content;
            
            if (result) {
                const cleanResult = result.trim();
                
                // Compute diff between original and new text
                const diffResult = this.computeDiff(this.selectedText, cleanResult);
                
                if (!diffResult.hasChanges) {
                    new Notice('No changes were made to the text.');
                    return;
                }
                
                // Show diff preview modal
                const diffModal = new DiffPreviewModal(
                    this.app,
                    this.selectedText,
                    cleanResult,
                    diffResult,
                    () => {
                        // Accept changes - replace the text
                        this.applyTextReplacement(cleanResult, action);
                    },
                    () => {
                        // Reject changes - do nothing
                        new Notice('Changes rejected.');
                    }
                );
                
                diffModal.open();
            } else {
                new Notice('No response received from AI.');
            }
            
        } catch (error) {
            console.error('Error performing action:', error);
            new Notice(`Error performing ${action}: ${error.message || error}`);
        }
    }

    /**
     * Generate appropriate prompts for different actions
     */
    private getPromptForAction(action: string, text: string, customInstructions?: string): string {
        const customInstructionText = customInstructions 
            ? `\n\nAdditional instructions: ${customInstructions}` 
            : '';
            
        const baseInstruction = "Return only the result text without any additional commentary or explanation.";
        switch (action) {
            case 'rewrite':
                return `Please rewrite the following text to make it clearer, more engaging, and better structured while maintaining the original meaning and tone:

"${text}"${customInstructionText}

${baseInstruction}`;

            case 'add_detail':
                return `Please expand on the following text by adding relevant details, examples, and explanations to make it more comprehensive and informative:

"${text}"${customInstructionText}

${baseInstruction}`;

            case 'summarize':
                return `Please create a concise summary of the following text, capturing the main points and key information:

"${text}"${customInstructionText}

${baseInstruction}`;

            case 'fix_grammar':
                return `Please fix any grammar, spelling, punctuation, and syntax errors in the following text while maintaining the original meaning and style:

"${text}"${customInstructionText}

${baseInstruction}`;

            case 'synonym':
                return `Please provide a suitable synonym or alternative phrase for the following text, maintaining the same meaning and context. Ensure that the capitalization is the same as the original text:

"${text}"${customInstructionText}

${baseInstruction}`;

            default:
                return `Please improve the following text:

"${text}"${customInstructionText}

${baseInstruction}`;
        }
    }

    /**
     * Add CSS styles for the menu appearance and diff visualization
     */
    private addMenuStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .menu.inline-menu {
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
                padding: 4px;
                min-width: 200px;
            }
            
            .menu.inline-menu .menu-item {
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
            }
            
            .menu.inline-menu .menu-item:hover {
                background: var(--background-modifier-hover);
            }
            
            .menu.inline-menu .menu-item-icon {
                width: 16px;
                height: 16px;
                opacity: 0.8;
            }
            
            .menu.inline-menu .menu-separator {
                height: 1px;
                background: var(--background-modifier-border);
                margin: 4px 8px;
            }

            /* Diff Preview Modal Styles */
            .diff-preview-container {
                margin: 16px 0;
                max-height: 400px;
                overflow-y: auto;
            }

            .diff-content {
                font-family: var(--font-text);
                line-height: 1.6;
                padding: 16px;
                background: var(--background-secondary);
                border-radius: 8px;
                border: 1px solid var(--background-modifier-border);
                white-space: pre-wrap;
                word-wrap: break-word;
            }

            .diff-delete {
                background-color: rgba(248, 81, 73, 0.15);
                color: var(--text-error);
                text-decoration: line-through;
                padding: 2px 0;
            }

            .diff-insert {
                background-color: rgba(46, 160, 67, 0.15);
                color: var(--text-success);
                padding: 2px 0;
                font-weight: 500;
            }

            .diff-equal {
                color: var(--text-normal);
            }

            .diff-no-changes {
                text-align: center;
                color: var(--text-muted);
                font-style: italic;
                padding: 32px;
            }



            .diff-buttons {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
                margin-top: 24px;
                padding-top: 16px;
                border-top: 1px solid var(--background-modifier-border);
            }

            .diff-accept-btn {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            }

            .diff-accept-btn:hover {
                background: var(--interactive-accent-hover);
            }

            .diff-reject-btn {
                background: var(--background-modifier-error);
                color: var(--text-error);
                border: 1px solid var(--background-modifier-error-border);
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            }

            .diff-reject-btn:hover {
                background: var(--background-modifier-error-hover);
            }

            .diff-cancel-btn {
                background: var(--background-secondary);
                color: var(--text-normal);
                border: 1px solid var(--background-modifier-border);
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
            }

            .diff-cancel-btn:hover {
                background: var(--background-modifier-hover);
            }

            /* Dark mode adjustments */
            .theme-dark .diff-delete {
                background-color: rgba(248, 81, 73, 0.25);
            }

            .theme-dark .diff-insert {
                background-color: rgba(46, 160, 67, 0.25);
            }

            /* Custom Instruction Modal Styles */
            .custom-instruction-model-container {
                margin-bottom: 16px;
            }

            .custom-instruction-model-select {
                width: 100%;
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                background: var(--background-primary);
                color: var(--text-normal);
                font-family: var(--font-text);
                font-size: 14px;
                cursor: pointer;
                min-height: 42px;
                padding: 8px 12px;
            }

            .custom-instruction-model-select:focus {
                outline: none;
                border-color: var(--interactive-accent);
                box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2);
            }

            .custom-instruction-selected-text {
                margin-bottom: 16px;
            }

            .custom-instruction-selected-text label {
                display: block;
                font-weight: 600;
                margin-bottom: 8px;
                color: var(--text-normal);
            }

            .custom-instruction-text-preview {
                background: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                padding: 12px;
                font-size: 14px;
                line-height: 1.5;
                color: var(--text-muted);
                max-height: 120px;
                overflow-y: auto;
                white-space: pre-wrap;
            }

            .custom-instruction-input-container {
                margin-bottom: 16px;
            }

            .custom-instruction-context-container {
                margin-bottom: 24px;
                padding: 12px;
                background: var(--background-secondary);
                border-radius: 6px;
                border: 1px solid var(--background-modifier-border);
            }

            .custom-instruction-context-label {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                font-size: 14px;
                color: var(--text-normal);
            }

            .custom-instruction-context-checkbox {
                margin: 0;
                cursor: pointer;
            }

            .custom-instruction-context-text {
                user-select: none;
            }

            .custom-instruction-label {
                display: block;
                font-weight: 600;
                margin-bottom: 8px;
                color: var(--text-normal);
            }

            .custom-instruction-textarea {
                width: 100%;
                min-height: 100px;
                padding: 12px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                background: var(--background-primary);
                color: var(--text-normal);
                font-family: var(--font-text);
                font-size: 14px;
                line-height: 1.5;
                resize: vertical;
                box-sizing: border-box;
            }

            .custom-instruction-textarea:focus {
                outline: none;
                border-color: var(--interactive-accent);
                box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2);
            }

            .custom-instruction-buttons {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }

            .custom-instruction-submit-btn {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
            }

            .custom-instruction-submit-btn:hover {
                background: var(--interactive-accent-hover);
            }

            .custom-instruction-cancel-btn {
                background: var(--background-secondary);
                color: var(--text-normal);
                border: 1px solid var(--background-modifier-border);
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
            }

            .custom-instruction-cancel-btn:hover {
                background: var(--background-modifier-hover);
            }
        `;
        
        document.head.appendChild(style);
    }

    /**
     * Update settings reference
     */
    updateSettings(settings: InlineMenuSettings) {
        this.settings = settings;
    }

    /**
     * Apply text replacement to the editor
     */
    private applyTextReplacement(newText: string, action: string) {
        if (this.currentEditor && this.selectionStart && this.selectionEnd) {
            try {
                // Validate that the positions are still valid
                const currentText = this.currentEditor.getRange(this.selectionStart, this.selectionEnd);
                
                if (currentText === this.selectedText) {
                    // Text matches, safe to replace
                    this.currentEditor.replaceRange(
                        newText,
                        this.selectionStart,
                        this.selectionEnd
                    );
                    new Notice(`${action} applied successfully!`);
                } else {
                    // Text has changed, ask user to reselect
                    new Notice('The selected text has changed. Please select the text again and retry.');
                }
            } catch (error) {
                console.error('Error applying changes:', error);
                new Notice('Error applying changes. Please try selecting the text again.');
            }
        }
    }



    /**
     * Get context text (500 characters before and after the selection)
     */
    private getContextText(): string {
        if (!this.currentEditor || !this.selectionStart || !this.selectionEnd) {
            return '';
        }

        try {
            const editor = this.currentEditor;
            const fullText = editor.getValue();
            
            // Calculate character positions
            const startPos = editor.posToOffset(this.selectionStart);
            const endPos = editor.posToOffset(this.selectionEnd);
            
            // Get 500 characters before and after
            const contextStart = Math.max(0, startPos - 500);
            const contextEnd = Math.min(fullText.length, endPos + 500);
            
            const beforeText = fullText.slice(contextStart, startPos);
            const afterText = fullText.slice(endPos, contextEnd);
            
            return `CONTEXT BEFORE:\n${beforeText}\n\nSELECTED TEXT:\n${this.selectedText}\n\nCONTEXT AFTER:\n${afterText}`;
        } catch (error) {
            console.error('Error getting context text:', error);
            return '';
        }
    }

    /**
     * Compute word-level diff between original and new text
     */
    private computeDiff(originalText: string, newText: string): DiffResult {
        // Split text into words while preserving whitespace
        const originalWords = this.tokenizeText(originalText);
        const newWords = this.tokenizeText(newText);
        
        // Use a simple LCS-based diff algorithm
        const operations = this.diffWords(originalWords, newWords);
        
        return {
            operations,
            hasChanges: operations.some(op => op.type !== 'equal')
        };
    }

    /**
     * Tokenize text into words while preserving whitespace and punctuation
     */
    private tokenizeText(text: string): string[] {
        // Split on word boundaries but keep delimiters
        return text.split(/(\s+|[.,!?;:])/g).filter(token => token.length > 0);
    }

    /**
     * Perform word-level diff using dynamic programming (LCS algorithm)
     */
    private diffWords(oldWords: string[], newWords: string[]): DiffOperation[] {
        const m = oldWords.length;
        const n = newWords.length;
        
        // Create LCS table
        const lcs: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        
        // Fill LCS table
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldWords[i - 1] === newWords[j - 1]) {
                    lcs[i][j] = lcs[i - 1][j - 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
                }
            }
        }
        
        // Backtrack to build diff operations
        const operations: DiffOperation[] = [];
        let i = m, j = n;
        
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
                operations.unshift({ type: 'equal', text: oldWords[i - 1] });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
                operations.unshift({ type: 'insert', text: newWords[j - 1] });
                j--;
            } else if (i > 0) {
                operations.unshift({ type: 'delete', text: oldWords[i - 1] });
                i--;
            }
        }
        
        return operations;
    }
}
