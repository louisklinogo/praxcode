import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';

/**
 * Explain Code Command class
 */
export class ExplainCodeCommand {
    private ragOrchestrator: RAGOrchestrator;
    
    /**
     * Constructor
     * @param ragOrchestrator The RAG orchestrator
     */
    constructor(ragOrchestrator: RAGOrchestrator) {
        this.ragOrchestrator = ragOrchestrator;
    }
    
    /**
     * Execute the command
     */
    async execute(): Promise<void> {
        try {
            // Get the active editor
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No active editor found');
                return;
            }
            
            // Get the selected text
            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showInformationMessage('No code selected');
                return;
            }
            
            const selectedText = editor.document.getText(selection);
            if (!selectedText.trim()) {
                vscode.window.showInformationMessage('Selected text is empty');
                return;
            }
            
            // Get the file path and language
            const filePath = editor.document.uri.fsPath;
            const fileName = path.basename(filePath);
            const language = editor.document.languageId;
            
            // Create the query
            const query = `Explain the following ${language} code from ${fileName}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``;
            
            // Show progress indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'PraxCode: Explaining Code',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Analyzing code...' });
                    
                    // Query the RAG orchestrator
                    const explanation = await this.ragOrchestrator.query(query, {
                        maxResults: 3,
                        systemPrompt: `You are PraxCode, a helpful AI coding assistant. Explain the provided code in a clear and concise manner. 
                        Break down complex logic, explain the purpose of functions, and highlight any important patterns or techniques used.
                        If relevant, suggest improvements or potential issues.`
                    });
                    
                    // Show the explanation in a webview
                    this.showExplanationWebview(selectedText, explanation, language, fileName);
                }
            );
        } catch (error) {
            logger.error('Failed to explain code', error);
            vscode.window.showErrorMessage(`Failed to explain code: ${error}`);
        }
    }
    
    /**
     * Show the explanation in a webview
     * @param code The code to explain
     * @param explanation The explanation
     * @param language The language of the code
     * @param fileName The file name
     */
    private showExplanationWebview(code: string, explanation: string, language: string, fileName: string): void {
        // Create and show the webview panel
        const panel = vscode.window.createWebviewPanel(
            'praxcode.explanation',
            `PraxCode: Explain ${fileName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        
        // Set the HTML content
        panel.webview.html = this.getExplanationHtml(code, explanation, language, fileName);
    }
    
    /**
     * Get the HTML for the explanation webview
     * @param code The code to explain
     * @param explanation The explanation
     * @param language The language of the code
     * @param fileName The file name
     */
    private getExplanationHtml(code: string, explanation: string, language: string, fileName: string): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Code Explanation</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    padding: 20px;
                    line-height: 1.5;
                }
                
                h1 {
                    font-size: 1.5em;
                    margin-bottom: 20px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 10px;
                }
                
                .code-container {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 15px;
                    border-radius: 5px;
                    margin-bottom: 20px;
                    overflow-x: auto;
                    font-family: var(--vscode-editor-font-family);
                }
                
                .explanation {
                    background-color: var(--vscode-editor-background);
                    padding: 15px;
                    border-radius: 5px;
                    border: 1px solid var(--vscode-panel-border);
                }
                
                .explanation h2 {
                    font-size: 1.2em;
                    margin-top: 0;
                }
                
                .explanation code {
                    font-family: var(--vscode-editor-font-family);
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                }
                
                .explanation pre {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 10px;
                    border-radius: 5px;
                    overflow-x: auto;
                    margin: 10px 0;
                }
            </style>
        </head>
        <body>
            <h1>Code Explanation: ${fileName}</h1>
            
            <div class="code-container">
                <pre><code>${this.escapeHtml(code)}</code></pre>
            </div>
            
            <div class="explanation">
                <h2>Explanation</h2>
                ${this.formatExplanation(explanation)}
            </div>
            
            <script>
                // Simple markdown parsing for code blocks and inline code
                function parseMarkdown(text) {
                    // Replace code blocks with <pre><code> elements
                    text = text.replace(/\`\`\`([\\w]*)(\\n[\\s\\S]*?)\`\`\`/g, function(match, language, code) {
                        return \`<pre><code class="language-\${language}">\${code.trim()}</code></pre>\`;
                    });
                    
                    // Replace inline code with <code> elements
                    text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
                    
                    return text;
                }
                
                // Parse any markdown in the explanation
                const explanationElement = document.querySelector('.explanation');
                if (explanationElement) {
                    const content = explanationElement.innerHTML;
                    explanationElement.innerHTML = parseMarkdown(content);
                }
            </script>
        </body>
        </html>`;
    }
    
    /**
     * Format the explanation with markdown parsing
     * @param explanation The explanation
     */
    private formatExplanation(explanation: string): string {
        // Convert markdown-style code blocks to HTML
        let formatted = explanation.replace(/```(\w*)([\s\S]*?)```/g, (match, language, code) => {
            return `<pre><code class="language-${language}">${this.escapeHtml(code.trim())}</code></pre>`;
        });
        
        // Convert inline code
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Convert line breaks
        formatted = formatted.replace(/\n/g, '<br>');
        
        return formatted;
    }
    
    /**
     * Escape HTML special characters
     * @param text The text to escape
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
