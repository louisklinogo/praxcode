import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';

/**
 * Command to refactor code
 */
export class RefactorCodeCommand {
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
            
            // Ask for refactoring options
            const refactoringOption = await vscode.window.showQuickPick([
                { label: 'Improve Code Quality', description: 'Refactor for better readability and maintainability' },
                { label: 'Optimize Performance', description: 'Refactor for better performance' },
                { label: 'Modernize Syntax', description: 'Update to modern language features' },
                { label: 'Fix Potential Bugs', description: 'Identify and fix potential issues' },
                { label: 'Custom Refactoring', description: 'Specify your own refactoring goals' }
            ], {
                placeHolder: 'Select refactoring goal',
                title: 'PraxCode: Refactor Code'
            });
            
            if (!refactoringOption) {
                return; // User cancelled
            }
            
            // If custom refactoring, ask for details
            let customGoal = '';
            if (refactoringOption.label === 'Custom Refactoring') {
                customGoal = await vscode.window.showInputBox({
                    prompt: 'Describe your refactoring goal',
                    placeHolder: 'e.g., Convert to async/await, Extract repeated logic into functions, etc.'
                }) || '';
                
                if (!customGoal) {
                    return; // User cancelled
                }
            }
            
            // Show progress indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Refactoring Code',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Analyzing code...' });
                    
                    // Create the prompt
                    let prompt = `Refactor the following ${languageId} code to ${refactoringOption.label === 'Custom Refactoring' ? customGoal : refactoringOption.label.toLowerCase()}:

\`\`\`${languageId}
${selectedText}
\`\`\`

Please provide:
1. The refactored code
2. A brief explanation of the changes made
3. Any potential issues or trade-offs with the refactoring

Return the refactored code in a code block with the appropriate language tag.`;
                    
                    // Create output channel
                    const outputChannel = vscode.window.createOutputChannel('PraxCode Refactoring');
                    outputChannel.clear();
                    outputChannel.show();
                    
                    let refactoredCode = '';
                    let explanation = '';
                    
                    // Stream the response to the output channel
                    await this.ragOrchestrator.streamQuery(
                        prompt,
                        (content, done) => {
                            if (done) {
                                // Extract the code block and explanation
                                const codeBlockRegex = /```(?:\w+)?\s*([\s\S]+?)```/;
                                const match = content.match(codeBlockRegex);
                                
                                if (match && match[1]) {
                                    refactoredCode = match[1].trim();
                                }
                                
                                // Get the explanation (everything before and after the code block)
                                const parts = content.split(/```(?:\w+)?\s*[\s\S]+?```/);
                                explanation = parts.join('\n').trim();
                                
                                outputChannel.appendLine('\n--- Refactoring Complete ---');
                            } else {
                                // Clear and update the output
                                outputChannel.clear();
                                outputChannel.append(content);
                            }
                        },
                        {
                            systemPrompt: `You are a code refactoring expert. Your task is to improve code quality, readability, and maintainability while preserving the original functionality. Follow best practices for the specific programming language.`
                        }
                    );
                    
                    // If we have refactored code, ask if the user wants to apply it
                    if (refactoredCode) {
                        const applyOption = await vscode.window.showInformationMessage(
                            'Refactoring complete. Would you like to apply the changes?',
                            'Apply',
                            'Show Diff',
                            'Cancel'
                        );
                        
                        if (applyOption === 'Apply') {
                            // Apply the changes
                            editor.edit(editBuilder => {
                                if (selection.isEmpty) {
                                    // Replace the entire document
                                    const fullRange = new vscode.Range(
                                        0, 0,
                                        editor.document.lineCount - 1,
                                        editor.document.lineAt(editor.document.lineCount - 1).text.length
                                    );
                                    editBuilder.replace(fullRange, refactoredCode);
                                } else {
                                    // Replace only the selection
                                    editBuilder.replace(selection, refactoredCode);
                                }
                            });
                            
                            vscode.window.showInformationMessage('Refactoring applied successfully');
                        } else if (applyOption === 'Show Diff') {
                            // Create a temporary file to show the diff
                            const tempDoc = await vscode.workspace.openTextDocument({
                                content: refactoredCode,
                                language: languageId
                            });
                            
                            // Show the diff
                            vscode.commands.executeCommand('vscode.diff',
                                editor.document.uri,
                                tempDoc.uri,
                                'Original ↔ Refactored',
                                { viewColumn: vscode.ViewColumn.Beside }
                            );
                        }
                    }
                }
            );
        } catch (error) {
            logger.error('Failed to refactor code', error);
            vscode.window.showErrorMessage(`Failed to refactor code: ${error}`);
        }
    }
}
