import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';

/**
 * Command to generate documentation for code
 */
export class GenerateDocsCommand {
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
            
            // Get the selected text or the entire document
            const selection = editor.selection;
            const selectedText = selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(selection);
            
            if (!selectedText.trim()) {
                vscode.window.showInformationMessage('No code selected');
                return;
            }
            
            // Get the language ID
            const languageId = editor.document.languageId;
            
            // Show progress indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating Documentation',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Analyzing code...' });
                    
                    // Create the prompt
                    const prompt = `Generate comprehensive documentation for the following ${languageId} code:

\`\`\`${languageId}
${selectedText}
\`\`\`

Please provide:
1. A clear description of what the code does
2. Function/method documentation with parameters and return values
3. Usage examples
4. Any important notes or caveats

Format the documentation in a style appropriate for the language (e.g., JSDoc for JavaScript, docstrings for Python, etc.).`;
                    
                    // Create output channel if it doesn't exist
                    const outputChannel = vscode.window.createOutputChannel('PraxCode Documentation');
                    outputChannel.clear();
                    outputChannel.show();
                    
                    // Stream the response to the output channel
                    await this.ragOrchestrator.streamQuery(
                        prompt,
                        (content, done) => {
                            if (done) {
                                outputChannel.appendLine('\n--- Documentation Generation Complete ---');
                            } else {
                                // Clear and update the output
                                outputChannel.clear();
                                outputChannel.append(content);
                            }
                        },
                        {
                            systemPrompt: `You are a documentation expert. Your task is to generate clear, comprehensive, and accurate documentation for code snippets. Follow the conventions and best practices for the specific programming language.`
                        }
                    );
                    
                    // Show success message
                    vscode.window.showInformationMessage('Documentation generated successfully');
                }
            );
        } catch (error) {
            logger.error('Failed to generate documentation', error);
            vscode.window.showErrorMessage(`Failed to generate documentation: ${error}`);
        }
    }
}
