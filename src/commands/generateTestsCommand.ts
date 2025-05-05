import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';

/**
 * Command to generate tests for code
 */
export class GenerateTestsCommand {
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

            // Get the language ID and file path
            const languageId = editor.document.languageId;
            const filePath = editor.document.uri.fsPath;
            const fileName = path.basename(filePath);

            // Determine the test framework based on language
            const testFramework = this.getTestFramework(languageId);

            // Show progress indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating Tests',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Analyzing code...' });

                    // Create the prompt
                    const prompt = `Generate comprehensive tests for the following ${languageId} code using ${testFramework}:

\`\`\`${languageId}
${selectedText}
\`\`\`

Please provide:
1. A complete test suite that covers the main functionality
2. Tests for edge cases and error handling
3. Any necessary setup and teardown code
4. Clear test descriptions/names

The tests should be ready to run with minimal modifications.`;

                    // Generate the test file path
                    const testFilePath = this.generateTestFilePath(filePath, languageId);

                    // Create output channel
                    const outputChannel = vscode.window.createOutputChannel('PraxCode Test Generation');
                    outputChannel.clear();
                    outputChannel.show();

                    let generatedTests = '';

                    // Stream the response to the output channel
                    await this.ragOrchestrator.streamQuery(
                        prompt,
                        (content, done) => {
                            if (done) {
                                generatedTests = content;
                                outputChannel.appendLine('\n--- Test Generation Complete ---');

                                // Extract the code block from the response
                                const codeBlockRegex = /```(?:\w+)?\s*([\s\S]+?)```/;
                                const match = content.match(codeBlockRegex);

                                if (match && match[1]) {
                                    generatedTests = match[1].trim();
                                }
                            } else {
                                // Clear and update the output
                                outputChannel.clear();
                                outputChannel.append(content);
                            }
                        },
                        {
                            systemPrompt: `You are a testing expert. Your task is to generate comprehensive, well-structured tests for code snippets. Follow the conventions and best practices for the specific testing framework and programming language.`
                        }
                    );

                    // Ask the user if they want to save the tests to a file
                    const saveOption = await vscode.window.showInformationMessage(
                        'Tests generated successfully. Would you like to save them to a file?',
                        'Save',
                        'Save As...',
                        'No'
                    );

                    if (saveOption === 'Save') {
                        // Save to the default test file path
                        await this.saveTestsToFile(testFilePath, generatedTests);
                        vscode.window.showInformationMessage(`Tests saved to ${testFilePath}`);

                        // The file should already be open from the saveTestsToFile method
                    } else if (saveOption === 'Save As...') {
                        // Let the user choose where to save the file
                        const uri = await vscode.window.showSaveDialog({
                            defaultUri: vscode.Uri.file(testFilePath),
                            filters: {
                                'Test Files': [this.getFileExtension(languageId)],
                                'All Files': ['*']
                            }
                        });

                        if (uri) {
                            await this.saveTestsToFile(uri.fsPath, generatedTests);
                            vscode.window.showInformationMessage(`Tests saved to ${uri.fsPath}`);

                            // The file should already be open from the saveTestsToFile method
                        }
                    }
                }
            );
        } catch (error) {
            logger.error('Failed to generate tests', error);
            vscode.window.showErrorMessage(`Failed to generate tests: ${error}`);
        }
    }

    /**
     * Get the test framework for a language
     * @param languageId The language ID
     */
    private getTestFramework(languageId: string): string {
        switch (languageId) {
            case 'javascript':
            case 'typescript':
            case 'javascriptreact':
            case 'typescriptreact':
                return 'Jest';
            case 'python':
                return 'pytest';
            case 'java':
                return 'JUnit';
            case 'csharp':
                return 'NUnit or xUnit';
            case 'go':
                return 'Go testing package';
            case 'ruby':
                return 'RSpec';
            case 'php':
                return 'PHPUnit';
            default:
                return 'a suitable testing framework';
        }
    }

    /**
     * Generate a test file path
     * @param filePath The original file path
     * @param languageId The language ID
     */
    private generateTestFilePath(filePath: string, languageId: string): string {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);

        // Create test file name based on language conventions
        switch (languageId) {
            case 'javascript':
            case 'typescript':
            case 'javascriptreact':
            case 'typescriptreact':
                // Check if there's a test directory
                const jsTestDir = path.join(dir, '__tests__');
                if (fs.existsSync(jsTestDir)) {
                    return path.join(jsTestDir, `${baseName}.test${ext}`);
                }
                return path.join(dir, `${baseName}.test${ext}`);

            case 'python':
                // Check if there's a test directory
                const pyTestDir = path.join(dir, 'tests');
                if (fs.existsSync(pyTestDir)) {
                    return path.join(pyTestDir, `test_${baseName}${ext}`);
                }
                return path.join(dir, `test_${baseName}${ext}`);

            case 'java':
                return path.join(dir, `${baseName}Test.java`);

            case 'csharp':
                return path.join(dir, `${baseName}Tests.cs`);

            case 'go':
                return path.join(dir, `${baseName}_test.go`);

            case 'ruby':
                return path.join(dir, `${baseName}_spec.rb`);

            case 'php':
                return path.join(dir, `${baseName}Test.php`);

            default:
                return path.join(dir, `${baseName}_test${ext}`);
        }
    }

    /**
     * Get the file extension for a language
     * @param languageId The language ID
     */
    private getFileExtension(languageId: string): string {
        switch (languageId) {
            case 'javascript':
                return 'js';
            case 'typescript':
                return 'ts';
            case 'javascriptreact':
                return 'jsx';
            case 'typescriptreact':
                return 'tsx';
            case 'python':
                return 'py';
            case 'java':
                return 'java';
            case 'csharp':
                return 'cs';
            case 'go':
                return 'go';
            case 'ruby':
                return 'rb';
            case 'php':
                return 'php';
            default:
                return '*';
        }
    }

    /**
     * Save tests to a file
     * @param filePath The file path
     * @param content The content
     */
    private async saveTestsToFile(filePath: string, content: string): Promise<void> {
        try {
            // Import the ActionExecutionService
            const { ActionExecutionService } = await import('../services/action/actionExecutionService.js');

            // Use the improved writeFile method
            const success = await ActionExecutionService.writeFile(filePath, content, true);

            if (!success) {
                throw new Error(`Failed to save tests to ${filePath}`);
            }

            logger.info(`Tests saved to ${filePath}`);
        } catch (error) {
            logger.error(`Failed to save tests to ${filePath}`, error);
            throw error;
        }
    }
}
