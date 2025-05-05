import * as vscode from 'vscode';
import { ActionExecutionService } from '../../services/action/actionExecutionService';
import { LLMResponseParser, ParsedCodeChange, ParsedCommand } from '../../services/action/llmResponseParser';
import { logger } from '../../utils/logger';
import { DiffParser } from '../../services/action/diffParser';

/**
 * Class for handling actionable items in the chat
 */
export class ActionableItems {
    /**
     * Process a message for actionable items
     * @param content The message content
     * @param webview The webview to post messages to
     */
    public static processMessage(content: string, webview: vscode.Webview): void {
        if (!content || !webview) {
            logger.warn('Cannot process message: content or webview is missing');
            return;
        }

        try {
            logger.debug('Processing message for actionable items', { contentLength: content.length });

            // Parse code changes
            const allCodeChanges = LLMResponseParser.parseCodeChanges(content);

            // Filter out invalid code changes
            const validCodeChanges = allCodeChanges.filter(change => {
                // Must have code content
                if (!change.newCode || change.newCode.trim().length === 0) {
                    logger.debug('Filtering out code change with empty code');
                    return false;
                }

                // Prefer changes with file paths
                if (!change.filePath) {
                    logger.debug('Code change has no file path, but keeping it for user selection');
                    // We'll still keep it and let the user select a file
                }

                // Check if the code looks valid for the language
                if (change.language && !this.isValidCodeForLanguage(change.newCode, change.language)) {
                    logger.debug('Filtering out code change with invalid code for language', {
                        language: change.language
                    });
                    return false;
                }

                return true;
            });

            // Parse commands
            const commands = LLMResponseParser.parseCommands(content);

            // Log the results
            logger.debug('Actionable items parsed', {
                totalCodeChanges: allCodeChanges.length,
                validCodeChanges: validCodeChanges.length,
                commands: commands.length
            });

            // If we have actionable items, send them to the webview
            if (validCodeChanges.length > 0 || commands.length > 0) {
                logger.info('Sending actionable items to webview', {
                    codeChangesCount: validCodeChanges.length,
                    commandsCount: commands.length
                });

                webview.postMessage({
                    command: 'setActionableItems',
                    items: {
                        codeChanges: validCodeChanges,
                        commands
                    }
                });
            } else {
                logger.debug('No valid actionable items found in message');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error processing message for actionable items', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }

    /**
     * Check if code is valid for a given language
     * @param code The code to check
     * @param language The language to check against
     * @returns True if the code is valid for the language
     */
    private static isValidCodeForLanguage(code: string, language: string): boolean {
        // Basic validation based on language
        switch (language.toLowerCase()) {
            case 'javascript':
            case 'typescript':
            case 'js':
            case 'ts':
                // Check for balanced braces and parentheses
                return this.hasBalancedBraces(code) &&
                       !code.includes('```') &&
                       (code.includes('function') ||
                        code.includes('const') ||
                        code.includes('let') ||
                        code.includes('var') ||
                        code.includes('import') ||
                        code.includes('export') ||
                        code.includes('class'));

            case 'python':
            case 'py':
                // Check for Python indentation and keywords
                return !code.includes('```') &&
                       (code.includes('def ') ||
                        code.includes('class ') ||
                        code.includes('import ') ||
                        code.includes('from '));

            case 'html':
                // Check for HTML tags
                return this.hasBalancedTags(code) &&
                       !code.includes('```') &&
                       code.includes('<') &&
                       code.includes('>');

            case 'css':
                // Check for CSS syntax
                return this.hasBalancedBraces(code) &&
                       !code.includes('```') &&
                       code.includes('{') &&
                       code.includes('}');

            case 'json':
                // Check for valid JSON
                try {
                    if (code.includes('```') || !code.trim().startsWith('{') && !code.trim().startsWith('[')) {
                        return false;
                    }
                    // Just check structure, don't actually parse
                    return this.hasBalancedBraces(code) &&
                           (code.trim().startsWith('{') || code.trim().startsWith('[')) &&
                           (code.trim().endsWith('}') || code.trim().endsWith(']'));
                } catch {
                    return false;
                }

            default:
                // For other languages, just make sure it doesn't contain markdown code block markers
                // and has some code-like structure
                return !code.includes('```') &&
                       (code.includes('{') ||
                        code.includes('(') ||
                        code.includes('=') ||
                        code.includes(';'));
        }
    }

    /**
     * Check if a string has balanced braces, brackets, and parentheses
     * @param code The code to check
     * @returns True if the braces are balanced
     */
    private static hasBalancedBraces(code: string): boolean {
        const stack: string[] = [];
        const openingBraces = '{[(<';
        const closingBraces = '}])>';
        const pairs: Record<string, string> = {
            '}': '{',
            ']': '[',
            ')': '(',
            '>': '<'
        };

        for (const char of code) {
            if (openingBraces.includes(char)) {
                stack.push(char);
            } else if (closingBraces.includes(char)) {
                if (stack.length === 0) {
                    return false;
                }

                const lastBrace = stack.pop();
                if (lastBrace !== pairs[char]) {
                    return false;
                }
            }
        }

        return stack.length === 0;
    }

    /**
     * Check if HTML has balanced tags
     * @param code The HTML code to check
     * @returns True if the tags are balanced
     */
    private static hasBalancedTags(code: string): boolean {
        const stack: string[] = [];
        const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
        let match;

        while ((match = tagRegex.exec(code)) !== null) {
            const fullTag = match[0];
            const tagName = match[1].toLowerCase();

            // Skip self-closing tags
            if (fullTag.endsWith('/>')) {
                continue;
            }

            // If it's a closing tag
            if (fullTag.startsWith('</')) {
                // Stack should not be empty and the last tag should match
                if (stack.length === 0 || stack.pop() !== tagName) {
                    return false;
                }
            } else {
                // It's an opening tag, push to stack
                stack.push(tagName);
            }
        }

        return stack.length === 0;
    }

    /**
     * Get file extension from language
     * @param language The language
     * @returns The file extension
     */
    private static getExtensionFromLanguage(language: string): string | undefined {
        const languageMap: Record<string, string> = {
            'javascript': 'js',
            'typescript': 'ts',
            'js': 'js',
            'ts': 'ts',
            'jsx': 'jsx',
            'tsx': 'tsx',
            'python': 'py',
            'py': 'py',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'csharp': 'cs',
            'cs': 'cs',
            'go': 'go',
            'ruby': 'rb',
            'rb': 'rb',
            'php': 'php',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'markdown': 'md',
            'md': 'md',
            'xml': 'xml',
            'yaml': 'yml',
            'yml': 'yml'
        };

        return languageMap[language.toLowerCase()];
    }

    /**
     * Handle a code change action
     * @param codeChange The code change to apply
     */
    public static async handleCodeChange(codeChange: ParsedCodeChange): Promise<void> {
        // Validate code change
        if (!codeChange) {
            logger.error('Invalid code change: codeChange is null or undefined');
            vscode.window.showErrorMessage('Cannot apply code change: Invalid data');
            return;
        }

        if (!codeChange.newCode) {
            logger.error('Invalid code change: newCode is missing', { codeChange });
            vscode.window.showErrorMessage('Cannot apply code change: No code content provided');
            return;
        }

        logger.info('Handling code change', {
            filePath: codeChange.filePath,
            language: codeChange.language,
            hasOriginalCode: !!codeChange.originalCode,
            newCodeLength: codeChange.newCode.length
        });

        // Check if this is already in diff format
        if (codeChange.originalCode && this.isDiffFormat(codeChange.originalCode, codeChange.newCode)) {
            logger.info('Detected diff-based code change, handling as diff');
            await this.handleDiffCodeChange(codeChange);
            return;
        }

        try {
            // If we have a file path, try to find the file
            if (codeChange.filePath) {
                logger.debug('Searching for file', { filePath: codeChange.filePath });

                try {
                    // Try multiple search patterns to find the file
                    let files: vscode.Uri[] = [];

                    // 1. Try exact path match first
                    files = await vscode.workspace.findFiles(`**/${codeChange.filePath}`, '**/node_modules/**');

                    // 2. If not found, try just the filename
                    if (files.length === 0) {
                        const fileName = codeChange.filePath.split('/').pop();
                        if (fileName) {
                            logger.debug('Trying to find by filename only', { fileName });
                            files = await vscode.workspace.findFiles(`**/${fileName}`, '**/node_modules/**');
                        }
                    }

                    // 3. If still not found and we have a language, try by extension
                    if (files.length === 0 && codeChange.language) {
                        const extension = this.getExtensionFromLanguage(codeChange.language);
                        if (extension) {
                            logger.debug('Trying to find by extension', { extension });
                            files = await vscode.workspace.findFiles(`**/*.${extension}`, '**/node_modules/**');

                            // If we have multiple files with the same extension, try to find the best match
                            if (files.length > 1 && codeChange.filePath) {
                                const filePathLower = codeChange.filePath.toLowerCase();
                                // Sort files by similarity to the original file path
                                files.sort((a, b) => {
                                    const aPath = a.path.toLowerCase();
                                    const bPath = b.path.toLowerCase();
                                    const aMatch = aPath.includes(filePathLower);
                                    const bMatch = bPath.includes(filePathLower);
                                    if (aMatch && !bMatch) return -1;
                                    if (!aMatch && bMatch) return 1;
                                    return 0;
                                });
                            }
                        }
                    }

                    logger.debug('File search results', {
                        filePath: codeChange.filePath,
                        filesFound: files.length
                    });

                    if (files.length > 0) {
                        const fileUri = files[0];
                        logger.info('Found file', { filePath: codeChange.filePath, uri: fileUri.toString() });

                        try {
                            // Read the file content
                            logger.debug('Reading file content', { uri: fileUri.toString() });
                            const document = await vscode.workspace.openTextDocument(fileUri);
                            const originalContent = document.getText();
                            logger.debug('File content read', {
                                uri: fileUri.toString(),
                                contentLength: originalContent.length,
                                lineCount: document.lineCount
                            });

                            // Create a diff from the original content and the new code
                            logger.debug('Creating diff from original and new content');
                            const diffString = this.createUnifiedDiff(
                                originalContent,
                                codeChange.newCode,
                                codeChange.filePath
                            );

                            // Apply the diff changes
                            logger.debug('Applying diff changes');
                            const success = await ActionExecutionService.applyDiffChanges(
                                diffString,
                                `Apply changes to ${codeChange.filePath}`
                            );

                            if (success) {
                                logger.info('Code changes applied successfully', { filePath: codeChange.filePath });
                            } else {
                                logger.warn('Code changes were not applied', { filePath: codeChange.filePath });
                            }

                            return;
                        } catch (fileError) {
                            const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
                            logger.error('Error processing file', {
                                filePath: codeChange.filePath,
                                error: errorMessage,
                                stack: fileError instanceof Error ? fileError.stack : undefined
                            });
                            throw new Error(`Error processing file ${codeChange.filePath}: ${errorMessage}`);
                        }
                    } else {
                        logger.info('File not found, will prompt user to select file', { filePath: codeChange.filePath });
                    }
                } catch (searchError) {
                    const errorMessage = searchError instanceof Error ? searchError.message : String(searchError);
                    logger.error('Error searching for file', {
                        filePath: codeChange.filePath,
                        error: errorMessage,
                        stack: searchError instanceof Error ? searchError.stack : undefined
                    });
                    // Continue to file selection dialog
                }
            }

            // If we don't have a file path or couldn't find the file,
            // ask the user to select a file
            logger.info('Prompting user to select file');
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select File to Modify'
            });

            if (fileUri && fileUri.length > 0) {
                const selectedFileUri = fileUri[0];
                logger.info('User selected file', { uri: selectedFileUri.toString() });

                try {
                    // Read the file content
                    logger.debug('Reading selected file content', { uri: selectedFileUri.toString() });
                    const document = await vscode.workspace.openTextDocument(selectedFileUri);
                    const originalContent = document.getText();
                    logger.debug('Selected file content read', {
                        uri: selectedFileUri.toString(),
                        contentLength: originalContent.length,
                        lineCount: document.lineCount
                    });

                    // Create a diff from the original content and the new code
                    logger.debug('Creating diff from original and new content for selected file');
                    const diffString = this.createUnifiedDiff(
                        originalContent,
                        codeChange.newCode,
                        selectedFileUri.fsPath
                    );

                    // Apply the diff changes
                    logger.debug('Applying diff changes to selected file');
                    const success = await ActionExecutionService.applyDiffChanges(
                        diffString,
                        `Apply changes to ${selectedFileUri.path.split('/').pop()}`
                    );

                    if (success) {
                        logger.info('Code changes applied successfully to selected file', {
                            uri: selectedFileUri.toString()
                        });
                    } else {
                        logger.warn('Code changes were not applied to selected file', {
                            uri: selectedFileUri.toString()
                        });
                    }
                } catch (selectedFileError) {
                    const errorMessage = selectedFileError instanceof Error ?
                        selectedFileError.message : String(selectedFileError);
                    logger.error('Error processing selected file', {
                        uri: selectedFileUri.toString(),
                        error: errorMessage,
                        stack: selectedFileError instanceof Error ? selectedFileError.stack : undefined
                    });
                    throw new Error(`Error processing selected file: ${errorMessage}`);
                }
            } else {
                logger.info('User cancelled file selection');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error handling code change', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                codeChange: {
                    filePath: codeChange.filePath,
                    language: codeChange.language,
                    newCodeLength: codeChange.newCode.length
                }
            });
            vscode.window.showErrorMessage(`Error handling code change: ${errorMessage}`);
        }
    }

    /**
     * Check if the code change is in diff format
     * @param originalCode The original code
     * @param newCode The new code
     * @returns True if the code is in diff format
     */
    private static isDiffFormat(originalCode: string, newCode: string): boolean {
        // Check if either the original or new code looks like a diff
        const diffPatterns = [
            /^---\s+a\//m,
            /^\+\+\+\s+b\//m,
            /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m,
            /^diff\s+--git/m
        ];

        return diffPatterns.some(pattern =>
            pattern.test(originalCode) || pattern.test(newCode)
        );
    }

    /**
     * Create a unified diff string from original and new code
     * @param originalCode The original code
     * @param newCode The new code
     * @param filePath The file path
     * @returns The unified diff string
     */
    private static createUnifiedDiff(originalCode: string, newCode: string, filePath?: string): string {
        const oldPath = filePath ? `a/${filePath}` : 'a/file';
        const newPath = filePath ? `b/${filePath}` : 'b/file';

        // Start with the file headers
        let diffString = `--- ${oldPath}\n+++ ${newPath}\n`;

        // Split the code into lines
        const oldLines = originalCode.split('\n');
        const newLines = newCode.split('\n');

        // If the content is identical, return an empty diff
        if (originalCode === newCode) {
            return diffString + '@@ -1,0 +1,0 @@ No changes\n';
        }

        // Find common prefix and suffix
        let prefixLength = 0;
        const minLength = Math.min(oldLines.length, newLines.length);

        while (prefixLength < minLength && oldLines[prefixLength] === newLines[prefixLength]) {
            prefixLength++;
        }

        let suffixLength = 0;
        while (
            suffixLength < minLength - prefixLength &&
            oldLines[oldLines.length - 1 - suffixLength] === newLines[newLines.length - 1 - suffixLength]
        ) {
            suffixLength++;
        }

        // Calculate the changed region
        const oldStart = Math.max(1, prefixLength - 3); // Add some context lines
        const oldEnd = Math.min(oldLines.length, oldLines.length - suffixLength + 3);
        const newStart = Math.max(1, prefixLength - 3);
        const newEnd = Math.min(newLines.length, newLines.length - suffixLength + 3);

        // Add the hunk header
        diffString += `@@ -${oldStart},${oldEnd - oldStart + 1} +${newStart},${newEnd - newStart + 1} @@\n`;

        // Add context lines before the change
        for (let i = oldStart - 1; i < prefixLength; i++) {
            if (i >= 0 && i < oldLines.length) {
                diffString += ` ${oldLines[i]}\n`;
            }
        }

        // Add removed lines
        for (let i = prefixLength; i < oldLines.length - suffixLength; i++) {
            diffString += `-${oldLines[i]}\n`;
        }

        // Add added lines
        for (let i = prefixLength; i < newLines.length - suffixLength; i++) {
            diffString += `+${newLines[i]}\n`;
        }

        // Add context lines after the change
        for (let i = oldLines.length - suffixLength; i < oldEnd; i++) {
            if (i >= 0 && i < oldLines.length) {
                diffString += ` ${oldLines[i]}\n`;
            }
        }

        return diffString;
    }

    /**
     * Handle a diff-based code change
     * @param codeChange The code change to apply
     */
    private static async handleDiffCodeChange(codeChange: ParsedCodeChange): Promise<void> {
        try {
            logger.info('Handling diff-based code change');

            // Get the diff string
            let diffString: string;

            // If the original code is already in diff format, use it directly
            if (this.isDiffFormat(codeChange.originalCode!, '')) {
                diffString = codeChange.originalCode!;
            }
            // If the new code is in diff format, use it directly
            else if (this.isDiffFormat('', codeChange.newCode)) {
                diffString = codeChange.newCode;
            }
            // Otherwise, create a diff from the original and new code
            else {
                diffString = this.createUnifiedDiff(
                    codeChange.originalCode!,
                    codeChange.newCode,
                    codeChange.filePath
                );
            }

            logger.debug('Diff string created', { length: diffString.length });

            // Parse the diff to extract file paths
            const parsedDiffs = DiffParser.parseDiff(diffString);

            if (parsedDiffs.length === 0) {
                logger.error('Failed to parse diff');
                vscode.window.showErrorMessage('Failed to parse diff format');
                return;
            }

            // Get the file path from the diff
            let filePath = parsedDiffs[0].newPath || parsedDiffs[0].oldPath;

            // If we don't have a file path from the diff, use the one from the code change
            if (!filePath && codeChange.filePath) {
                filePath = codeChange.filePath;
            }

            // If we still don't have a file path, ask the user to select a file
            if (!filePath) {
                logger.info('No file path found in diff, prompting user to select file');
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: 'Select File to Apply Diff'
                });

                if (!fileUri || fileUri.length === 0) {
                    logger.info('User cancelled file selection');
                    return;
                }

                filePath = fileUri[0].fsPath;

                // Update the diff with the selected file path
                diffString = diffString.replace(
                    /^---\s+.*$/m,
                    `--- a/${filePath}`
                ).replace(
                    /^\+\+\+\s+.*$/m,
                    `+++ b/${filePath}`
                );

                // Re-parse the diff with the updated file path
                parsedDiffs[0].oldPath = filePath;
                parsedDiffs[0].newPath = filePath;
            }

            // Apply the diff changes
            logger.info('Applying diff changes', { filePath });
            const success = await ActionExecutionService.applyDiffChanges(
                diffString,
                `Apply changes to ${filePath}`
            );

            if (success) {
                logger.info('Diff changes applied successfully');
            } else {
                logger.warn('Diff changes were not applied');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error handling diff code change', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined
            });
            vscode.window.showErrorMessage(`Error applying diff: ${errorMessage}`);
        }
    }

    /**
     * Handle a command action
     * @param command The command to run
     */
    public static async handleCommand(command: ParsedCommand): Promise<void> {
        // Validate command
        if (!command) {
            logger.error('Invalid command: command is null or undefined');
            vscode.window.showErrorMessage('Cannot run command: Invalid data');
            return;
        }

        if (!command.command || typeof command.command !== 'string') {
            logger.error('Invalid command: command string is missing or not a string', { command });
            vscode.window.showErrorMessage('Cannot run command: No valid command string provided');
            return;
        }

        // Trim the command to remove any leading/trailing whitespace
        const commandStr = command.command.trim();
        if (!commandStr) {
            logger.error('Invalid command: command string is empty after trimming');
            vscode.window.showErrorMessage('Cannot run command: Empty command string');
            return;
        }

        logger.info('Handling command', {
            command: commandStr,
            description: command.description
        });

        try {
            logger.debug('Calling ActionExecutionService.runTerminalCommand', { command: commandStr });
            const success = await ActionExecutionService.runTerminalCommand(commandStr);

            if (success) {
                logger.info('Command sent to terminal successfully', { command: commandStr });
            } else {
                logger.warn('Command was not sent to terminal', { command: commandStr });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error handling command', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                command: commandStr
            });
            vscode.window.showErrorMessage(`Error handling command: ${errorMessage}`);
        }
    }

    /**
     * Create a new file with the given content
     * @param filePath The file path
     * @param content The file content
     */
    public static async createNewFile(filePath: string, content: string): Promise<void> {
        try {
            // Request confirmation
            const confirmed = await ActionExecutionService.requestConfirmation(
                'Create new file?',
                `File: ${filePath}`
            );

            if (!confirmed) {
                logger.info('User cancelled file creation');
                return;
            }

            // Use the improved ActionExecutionService.writeFile method
            const success = await ActionExecutionService.writeFile(filePath, content, false);

            if (success) {
                logger.info('Created new file', { filePath });
            } else {
                logger.warn('Failed to create new file', { filePath });

                // If the file already exists, ask if we should overwrite
                const overwrite = await vscode.window.showWarningMessage(
                    `File ${filePath} already exists. Overwrite?`,
                    { modal: true },
                    'Overwrite',
                    'Cancel'
                );

                if (overwrite !== 'Overwrite') {
                    logger.info('User cancelled file overwrite');
                    return;
                }

                // Try again with overwrite=true
                const overwriteSuccess = await ActionExecutionService.writeFile(filePath, content, true);

                if (overwriteSuccess) {
                    logger.info('Created new file (overwrite)', { filePath });
                } else {
                    logger.error('Failed to create new file even with overwrite', { filePath });
                    vscode.window.showErrorMessage(`Failed to create file: ${filePath}`);
                }
            }
        } catch (error) {
            logger.error('Error creating new file', error);
            vscode.window.showErrorMessage(`Error creating new file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
