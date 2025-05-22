import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { DiffParser, ParsedDiff } from './diffParser';

/**
 * Service for executing actions in the workspace
 * Handles file modifications and terminal commands with user confirmation
 */
export class ActionExecutionService {
    private static _terminal: vscode.Terminal | undefined;

    /**
     * Request confirmation from the user
     * @param prompt The prompt to show
     * @param actionDescription The description of the action
     * @returns A promise that resolves to true if confirmed, false otherwise
     */
    public static async requestConfirmation(prompt: string, actionDescription: string): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(
            prompt,
            { modal: true, detail: actionDescription },
            'Confirm',
            'Cancel'
        );

        return result === 'Confirm';
    }

    /**
     * Get or create a dedicated terminal
     * @returns The terminal
     */
    public static getOrCreateTerminal(): vscode.Terminal {
        if (!this._terminal || this._terminal.exitStatus !== undefined) {
            this._terminal = vscode.window.createTerminal('PraxCode');
            logger.info('Created new PraxCode terminal');
        }

        return this._terminal;
    }

    /**
     * Apply code changes to the workspace
     * @param edit The workspace edit to apply
     * @param description A description of the changes
     * @returns A promise that resolves to true if the changes were applied, false otherwise
     */
    public static async applyCodeChanges(edit: vscode.WorkspaceEdit, description: string): Promise<boolean> {
        try {
            // Request confirmation
            const confirmed = await this.requestConfirmation(
                'Apply code changes?',
                description
            );

            if (!confirmed) {
                logger.info('User cancelled code changes');
                return false;
            }

            // Apply the edit
            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                logger.info('Successfully applied code changes');
                vscode.window.showInformationMessage('Successfully applied code changes');
            } else {
                logger.error('Failed to apply code changes');
                vscode.window.showErrorMessage('Failed to apply code changes');
            }

            return success;
        } catch (error) {
            logger.error('Error applying code changes', error);
            vscode.window.showErrorMessage(`Error applying code changes: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Show a diff preview of the proposed changes
     * @param originalContent The original content
     * @param newContent The new content
     * @param originalUri The original file URI (or a title if not a file)
     * @param newTitle The title for the new content
     */
    public static async showDiffPreview(
        originalContent: string,
        newContent: string,
        originalUri: vscode.Uri | string,
        newTitle: string
    ): Promise<void> {
        try {
            // Create a temporary file for the new content
            const tempFile = await vscode.workspace.openTextDocument({
                content: newContent
            });

            // Determine the original URI
            let originalUriObj: vscode.Uri;
            let originalTitle: string;

            if (typeof originalUri === 'string') {
                // Create a temporary file for the original content
                const originalTempFile = await vscode.workspace.openTextDocument({
                    content: originalContent
                });
                originalUriObj = originalTempFile.uri;
                originalTitle = originalUri;
            } else {
                originalUriObj = originalUri;
                originalTitle = originalUri.path.split('/').pop() || 'Original';
            }

            // Show the diff
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUriObj,
                tempFile.uri,
                `${originalTitle} ↔ ${newTitle}`
            );

            logger.info('Showing diff preview');
        } catch (error) {
            logger.error('Error showing diff preview', error);
            vscode.window.showErrorMessage(`Error showing diff preview: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Create a workspace edit for replacing text in a file
     * @param uri The file URI
     * @param range The range to replace
     * @param newText The new text
     * @returns The workspace edit
     */
    public static createReplaceEdit(uri: vscode.Uri, range: vscode.Range, newText: string): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, range, newText);
        return edit;
    }

    /**
     * Create a workspace edit for inserting text in a file
     * @param uri The file URI
     * @param position The position to insert at
     * @param newText The new text
     * @returns The workspace edit
     */
    public static createInsertEdit(uri: vscode.Uri, position: vscode.Position, newText: string): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, position, newText);
        return edit;
    }

    /**
     * Create a workspace edit for deleting text in a file
     * @param uri The file URI
     * @param range The range to delete
     * @returns The workspace edit
     */
    public static createDeleteEdit(uri: vscode.Uri, range: vscode.Range): vscode.WorkspaceEdit {
        const edit = new vscode.WorkspaceEdit();
        edit.delete(uri, range);
        return edit;
    }

    /**
     * Run a command in the terminal
     * @param command The command to run
     * @returns A promise that resolves to true if the command was sent, false otherwise
     */
    public static async runTerminalCommand(command: string): Promise<boolean> {
        // Validate command
        if (!command || typeof command !== 'string') {
            logger.error('Invalid command: command is null, undefined, or not a string', { command });
            vscode.window.showErrorMessage('Cannot run command: Invalid command');
            return false;
        }

        // Trim the command
        const trimmedCommand = command.trim();
        if (!trimmedCommand) {
            logger.error('Invalid command: command is empty after trimming');
            vscode.window.showErrorMessage('Cannot run command: Empty command');
            return false;
        }

        logger.debug('Running terminal command', { command: trimmedCommand });

        try {
            // Check for potentially dangerous commands
            const isDangerous = this.isPotentiallyDangerousCommand(trimmedCommand);
            logger.debug('Command danger check', { command: trimmedCommand, isDangerous });

            if (isDangerous) {
                logger.warn('Potentially dangerous command detected', { command: trimmedCommand });
                const confirmed = await this.requestConfirmation(
                    'This command may be potentially dangerous. Are you sure you want to run it?',
                    `Command: ${trimmedCommand}`
                );

                if (!confirmed) {
                    logger.info('User cancelled potentially dangerous command', { command: trimmedCommand });
                    return false;
                }
                logger.info('User confirmed potentially dangerous command', { command: trimmedCommand });
            } else {
                // Request normal confirmation
                const confirmed = await this.requestConfirmation(
                    'Run this command in the terminal?',
                    `Command: ${trimmedCommand}`
                );

                if (!confirmed) {
                    logger.info('User cancelled command execution', { command: trimmedCommand });
                    return false;
                }
                logger.info('User confirmed command execution', { command: trimmedCommand });
            }

            try {
                // Get or create the terminal
                logger.debug('Getting or creating terminal');
                const terminal = this.getOrCreateTerminal();

                if (!terminal) {
                    logger.error('Failed to get or create terminal');
                    vscode.window.showErrorMessage('Failed to access terminal');
                    return false;
                }

                // Show the terminal
                logger.debug('Showing terminal');
                terminal.show();

                // Send the command
                logger.debug('Sending command to terminal', { command: trimmedCommand });
                terminal.sendText(trimmedCommand, true);

                logger.info('Command sent to terminal successfully', { command: trimmedCommand });
                vscode.window.showInformationMessage(`Command sent to terminal: ${trimmedCommand}`);

                return true;
            } catch (terminalError) {
                const errorMessage = terminalError instanceof Error ? terminalError.message : String(terminalError);
                logger.error('Terminal operation error', {
                    error: errorMessage,
                    stack: terminalError instanceof Error ? terminalError.stack : undefined,
                    command: trimmedCommand
                });
                vscode.window.showErrorMessage(`Terminal error: ${errorMessage}`);
                return false;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error running terminal command', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                command: trimmedCommand
            });
            vscode.window.showErrorMessage(`Error running terminal command: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Check if a command is potentially dangerous
     * @param command The command to check
     * @returns True if the command is potentially dangerous, false otherwise
     */
    private static isPotentiallyDangerousCommand(command: string): boolean {
        const dangerousPatterns = [
            /rm\s+-rf/i,                  // Remove recursively with force
            /rmdir\s+\/s/i,               // Windows equivalent of rm -rf
            /del\s+\/[fs]/i,              // Windows delete with force
            /format/i,                    // Format drives
            /dd\s+if/i,                   // Disk destroyer
            /mkfs/i,                      // Make filesystem
            /chmod\s+-R/i,                // Recursive chmod
            /chown\s+-R/i,                // Recursive chown
            /git\s+push\s+(-f|--force)/i, // Force push
            /git\s+reset\s+--hard/i,      // Hard reset
            /git\s+clean\s+-fd/i,         // Force clean
            /sudo\s+/i,                   // Sudo commands
            />\s*\/dev\/sd[a-z]/i,        // Write to block devices
            /mv\s+.*\s+\/dev\/null/i      // Move to /dev/null
        ];

        return dangerousPatterns.some(pattern => pattern.test(command));
    }

    /**
     * Parse code blocks from LLM response
     * @param content The LLM response content
     * @returns An array of code blocks with language and content
     */
    public static parseCodeBlocks(content: string): Array<{ language: string, code: string }> {
        const codeBlockRegex = /```([\w-]*)\n([\s\S]*?)```/g;
        const codeBlocks: Array<{ language: string, code: string }> = [];

        let match;
        while ((match = codeBlockRegex.exec(content)) !== null) {
            codeBlocks.push({
                language: match[1].trim(),
                code: match[2].trim()
            });
        }

        return codeBlocks;
    }

    /**
     * Parse commands from LLM response
     * @param content The LLM response content
     * @returns An array of commands
     */
    public static parseCommands(content: string): string[] {
        const commands: string[] = [];

        // Look for commands in code blocks with shell, bash, cmd, powershell, etc.
        const codeBlocks = this.parseCodeBlocks(content);
        const shellCodeBlocks = codeBlocks.filter(block =>
            ['sh', 'shell', 'bash', 'cmd', 'powershell', 'ps', 'bat', 'batch', ''].includes(block.language.toLowerCase())
        );

        for (const block of shellCodeBlocks) {
            // Split by lines and filter out comments and empty lines
            const lines = block.code.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));

            commands.push(...lines);
        }

        // Also look for inline commands with $ or > prefix
        const inlineCommandRegex = /[`$>]\s*([\w\s-./\\:;|&<>"']+)/g;
        let inlineMatch;
        while ((inlineMatch = inlineCommandRegex.exec(content)) !== null) {
            const command = inlineMatch[1].trim();
            if (command && !commands.includes(command)) {
                commands.push(command);
            }
        }

        return commands;
    }

    /**
     * Apply changes from a diff string
     * @param diffString The diff string to apply
     * @param description A description of the changes
     * @returns A promise that resolves to true if the changes were applied, false otherwise
     */
    public static async applyDiffChanges(diffString: string, description: string): Promise<boolean> {
        try {
            logger.debug('Parsing diff string', { length: diffString.length });

            // Parse the diff
            const parsedDiffs = DiffParser.parseDiff(diffString);

            if (parsedDiffs.length === 0) {
                logger.error('No valid diffs found in the diff string');
                vscode.window.showErrorMessage('No valid diffs found in the provided diff');
                return false;
            }

            // Show a preview of the changes
            await this.showDiffPreviewFromParsedDiff(parsedDiffs[0]);

            // Create workspace edits for each diff
            const allEdits = new vscode.WorkspaceEdit();

            for (const parsedDiff of parsedDiffs) {
                const edit = await DiffParser.createWorkspaceEdit(parsedDiff);

                if (edit) {
                    // Merge the edits
                    edit.entries().forEach(([uri, edits]) => {
                        edits.forEach(edit => {
                            if (edit.newText !== undefined) {
                                allEdits.replace(uri, edit.range, edit.newText);
                            } else {
                                allEdits.delete(uri, edit.range);
                            }
                        });
                    });
                }
            }

            // Apply the edits
            return await this.applyCodeChanges(allEdits, description);
        } catch (error) {
            logger.error('Error applying diff changes', error);
            vscode.window.showErrorMessage(`Error applying diff changes: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Show a diff preview from a parsed diff
     * @param parsedDiff The parsed diff
     */
    public static async showDiffPreviewFromParsedDiff(parsedDiff: ParsedDiff): Promise<void> {
        try {
            if (!parsedDiff.newPath && !parsedDiff.oldPath) {
                logger.error('Cannot show diff preview: No file path provided');
                vscode.window.showErrorMessage('Cannot show diff preview: No file path provided');
                return;
            }

            const filePath = parsedDiff.newPath || parsedDiff.oldPath;
            if (!filePath) {
                logger.error('Cannot show diff preview: No file path provided');
                vscode.window.showErrorMessage('Cannot show diff preview: No file path provided');
                return;
            }

            // Get the file URI, ensuring it's properly resolved relative to the workspace
            let fileUri: vscode.Uri;

            // Check if the path is absolute
            if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:\\/)) {
                // It's an absolute path, use it directly
                fileUri = vscode.Uri.file(filePath);
            } else {
                // It's a relative path, resolve it against the workspace root
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    logger.error('Cannot resolve file path: No workspace folder open');
                    vscode.window.showErrorMessage('Cannot resolve file path: No workspace folder open');
                    return;
                }

                // Try to find the file in the workspace
                const workspaceRoot = workspaceFolders[0].uri;
                fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);

                // Log the resolved path
                logger.debug('Resolved file path', {
                    originalPath: filePath,
                    resolvedPath: fileUri.fsPath
                });
            }

            try {
                // Try to read the file
                const document = await vscode.workspace.openTextDocument(fileUri);
                const originalContent = document.getText();

                // Apply the diff to get the new content
                let newContent = originalContent;

                // Sort hunks in reverse order to avoid position shifts
                const sortedHunks = [...parsedDiff.hunks].sort((a, b) => b.oldStart - a.oldStart);

                for (const hunk of sortedHunks) {
                    const startLine = hunk.oldStart - 1;
                    const endLine = startLine + hunk.oldLines;

                    // Split the content into lines
                    const lines = newContent.split('\n');

                    // Extract the lines before and after the hunk
                    const beforeLines = lines.slice(0, startLine);
                    const afterLines = lines.slice(endLine);

                    // Extract the new lines from the hunk
                    const newLines = hunk.lineDiffs
                        .filter(line => line.type === 'add' || line.type === 'context')
                        .map(line => line.content);

                    // Combine the lines
                    newContent = [...beforeLines, ...newLines, ...afterLines].join('\n');
                }

                // Show the diff preview
                await this.showDiffPreview(originalContent, newContent, fileUri, 'Proposed Changes');
            } catch (fileError) {
                logger.error('Error reading file for diff preview', fileError);
                vscode.window.showErrorMessage(`Error reading file for diff preview: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
            }
        } catch (error) {
            logger.error('Error showing diff preview from parsed diff', error);
            vscode.window.showErrorMessage(`Error showing diff preview: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Write content to a file in the workspace
     * @param filePath The path to the file
     * @param content The content to write
     * @param overwrite Whether to overwrite the file if it exists
     * @returns A promise that resolves to true if the file was written, false otherwise
     */
public static async writeFile(filePath: string, content: string, overwrite: boolean = false): Promise<boolean> {
    try {
        // --- Existing filePath to fileUri resolution logic ---
        let resolvedFilePath: string;
        let fileUri: vscode.Uri;

        if (!filePath || filePath.trim() === '') { // Added check for empty/blank filePath
            logger.error('Error writing file: File path is empty or invalid.');
            vscode.window.showErrorMessage('Error writing file: File path is empty or invalid.');
            return false;
        }

        // Check if the path is absolute
        if (path.isAbsolute(filePath)) { // Using path.isAbsolute for better check
            resolvedFilePath = filePath;
            try {
                fileUri = vscode.Uri.file(resolvedFilePath);
            } catch (e) {
                logger.error(`Error creating URI for absolute path: ${resolvedFilePath}`, e);
                vscode.window.showErrorMessage(`Error writing file: Invalid file path provided: ${filePath}`);
                return false;
            }
        } else {
            // It's a relative path, resolve it against the workspace root
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                logger.error('Cannot resolve relative file path: No workspace folder open');
                vscode.window.showErrorMessage('Cannot resolve relative file path: No workspace folder open. Please open a folder.');
                return false;
            }
            const workspaceRoot = workspaceFolders[0].uri;
            // Intentionally not using path.join here as vscode.Uri.joinPath is for URIs
            try {
                fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);
            } catch (e) {
                logger.error(`Error creating URI for relative path: ${filePath} in workspace ${workspaceRoot.toString()}`, e);
                vscode.window.showErrorMessage(`Error writing file: Invalid relative file path provided: ${filePath}`);
                return false;
            }
            resolvedFilePath = fileUri.fsPath;
        }

        // Validate the URI scheme
        if (fileUri.scheme !== 'file') {
            logger.error(`Error writing file: Invalid URI scheme '${fileUri.scheme}' for path '${filePath}'. Expected 'file'.`);
            vscode.window.showErrorMessage(`Error writing file: Path '${filePath}' did not resolve to a valid file location.`);
            return false;
        }

        // Log the resolved path
        logger.debug('Resolved file path for writing', {
            originalPath: filePath,
            resolvedPath: fileUri.fsPath // Use fileUri.fsPath for logging the actual path
        });

        // Check if the file exists using VS Code API
        let fileExists = false;
        try {
            await vscode.workspace.fs.stat(fileUri);
            fileExists = true;

            if (!overwrite) {
                logger.warn(`File ${fileUri.fsPath} already exists and overwrite is false`);
                // Not showing a user message here as this function is a service.
                // The caller (MCPActionHandler) should handle user interaction if overwrite is false.
                return false; 
            }
        } catch (error) {
            // File doesn't exist, which is fine if we intend to create it.
            logger.debug(`File ${fileUri.fsPath} doesn't exist, will create it`);
        }

        // Create parent directories if they don't exist
        try {
            const dirUri = vscode.Uri.joinPath(fileUri, '..');
            try {
                await vscode.workspace.fs.stat(dirUri);
            } catch (error) { // Assuming error means directory doesn't exist
                logger.debug(`Creating directory ${dirUri.fsPath}`);
                await vscode.workspace.fs.createDirectory(dirUri);
            }

            // Write the file using VS Code API
            const encoder = new TextEncoder(); // Should be outside try-catch if used in finally
            await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));

            logger.info(`Successfully ${fileExists ? 'updated' : 'created'} file ${fileUri.fsPath}`);

            // Open the file in the editor
            const document = await vscode.workspace.openTextDocument(fileUri); 
            await vscode.window.showTextDocument(document);

            return true;
        } catch (error) { // Catches errors from createDirectory, writeFile
            logger.error(`Error writing file operations for ${fileUri.fsPath}`, error);
            vscode.window.showErrorMessage(`Error writing file ${fileUri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }

    } catch (error) // Catch errors from initial URI parsing or other unexpected issues
    {
        logger.error(`Critical error in writeFile for path ${filePath}`, error);
        vscode.window.showErrorMessage(`Critical error processing file path '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

    /**
     * Dispose of resources
     */
    public static dispose(): void {
        if (this._terminal) {
            this._terminal.dispose();
            this._terminal = undefined;
        }
    }
}
