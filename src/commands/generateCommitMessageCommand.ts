import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger';
import { LLMService } from '../services/llm/llmService';
import { LLMServiceFactory } from '../services/llm/llmServiceFactory';

/**
 * Command to generate commit messages
 */
export class GenerateCommitMessageCommand {
    private llmServiceFactory: LLMServiceFactory;
    
    /**
     * Constructor
     * @param llmServiceFactory The LLM service factory
     */
    constructor(llmServiceFactory: LLMServiceFactory) {
        this.llmServiceFactory = llmServiceFactory;
    }
    
    /**
     * Execute the command
     */
    async execute(): Promise<void> {
        try {
            // Check if Git is available
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension is not available');
                return;
            }
            
            // Activate the Git extension
            const git = gitExtension.exports;
            await gitExtension.activate();
            
            // Get the Git API
            const api = git.getAPI(1);
            if (!api) {
                vscode.window.showErrorMessage('Git API is not available');
                return;
            }
            
            // Get the current repository
            const repositories = api.repositories;
            if (!repositories || repositories.length === 0) {
                vscode.window.showErrorMessage('No Git repository found');
                return;
            }
            
            // Use the first repository (most common case)
            const repository = repositories[0];
            
            // Check if there are any changes
            const changes = repository.state.workingTreeChanges;
            if (changes.length === 0) {
                vscode.window.showInformationMessage('No changes to commit');
                return;
            }
            
            // Show progress indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating Commit Message',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Analyzing changes...' });
                    
                    // Get the diff for each file
                    const diffs: { file: string; diff: string }[] = [];
                    
                    for (const change of changes) {
                        try {
                            // Skip deleted files
                            if (change.status === 3) { // Status 3 is deleted
                                diffs.push({
                                    file: change.uri.fsPath,
                                    diff: `File deleted: ${path.basename(change.uri.fsPath)}`
                                });
                                continue;
                            }
                            
                            // Skip binary files
                            if (change.status === 6 || change.status === 7) { // Status 6 is untracked, 7 is ignored
                                diffs.push({
                                    file: change.uri.fsPath,
                                    diff: `New file: ${path.basename(change.uri.fsPath)}`
                                });
                                continue;
                            }
                            
                            // Get the diff
                            const diff = await repository.diffWithHEAD(change.uri);
                            
                            // Add to the list
                            diffs.push({
                                file: change.uri.fsPath,
                                diff: diff || `Changes in ${path.basename(change.uri.fsPath)}`
                            });
                        } catch (error) {
                            logger.warn(`Failed to get diff for ${change.uri.fsPath}`, error);
                            diffs.push({
                                file: change.uri.fsPath,
                                diff: `Changes in ${path.basename(change.uri.fsPath)} (diff not available)`
                            });
                        }
                    }
                    
                    // Prepare the prompt
                    let prompt = `Generate a commit message for the following changes:\n\n`;
                    
                    // Add the diffs (limit to avoid token limits)
                    const maxDiffLength = 1000; // Characters per diff
                    const maxTotalLength = 6000; // Total characters for all diffs
                    
                    let totalLength = 0;
                    for (const { file, diff } of diffs) {
                        const fileName = path.basename(file);
                        const truncatedDiff = diff.length > maxDiffLength
                            ? diff.substring(0, maxDiffLength) + '... (truncated)'
                            : diff;
                        
                        const diffEntry = `File: ${fileName}\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n\n`;
                        
                        if (totalLength + diffEntry.length > maxTotalLength) {
                            prompt += `... and ${diffs.length - prompt.split('File:').length + 1} more files\n\n`;
                            break;
                        }
                        
                        prompt += diffEntry;
                        totalLength += diffEntry.length;
                    }
                    
                    prompt += `Please generate a concise, descriptive commit message following these guidelines:
1. Use the imperative mood (e.g., "Add feature" not "Added feature")
2. First line should be a summary (max 50 chars)
3. Optionally followed by a blank line and a more detailed explanation
4. Include relevant issue numbers if applicable (e.g., "Fix #123")
5. Focus on WHY the change was made, not just WHAT was changed`;
                    
                    progress.report({ message: 'Generating message...' });
                    
                    // Get the LLM service
                    const llmService = await this.llmServiceFactory.getService();
                    
                    // Generate the commit message
                    const response = await llmService.chat(
                        [
                            {
                                role: 'system',
                                content: 'You are a commit message generation assistant. Your task is to create clear, concise, and descriptive commit messages based on code changes. Follow Git commit message best practices.'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        {
                            temperature: 0.3
                        }
                    );
                    
                    // Extract the commit message
                    let commitMessage = response.content.trim();
                    
                    // Remove any markdown code block formatting
                    commitMessage = commitMessage.replace(/^```[a-z]*\n/gm, '').replace(/```$/gm, '');
                    
                    // Show the commit message and ask if the user wants to use it
                    const result = await vscode.window.showInputBox({
                        prompt: 'Generated commit message (you can edit it):',
                        value: commitMessage,
                        placeHolder: 'Commit message'
                    });
                    
                    if (result) {
                        // Set the commit message in the SCM input box
                        repository.inputBox.value = result;
                        vscode.window.showInformationMessage('Commit message set');
                        
                        // Focus the SCM view
                        vscode.commands.executeCommand('workbench.view.scm');
                    }
                }
            );
        } catch (error) {
            logger.error('Failed to generate commit message', error);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${error}`);
        }
    }
}
