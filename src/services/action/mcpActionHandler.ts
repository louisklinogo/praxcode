import * as vscode from 'vscode';
import { logger } from '../../utils/logger';
import { MCPContextItem } from '../mcp/modelContextProtocolService';
import { ActionExecutionService } from './actionExecutionService';

/**
 * Handler for MCP-generated actions
 * Processes context items from MCP responses that represent actions
 */
export class MCPActionHandler {
    private static instance: MCPActionHandler;
    private actionExecutionService: ActionExecutionService;

    private constructor() {
        this.actionExecutionService = new ActionExecutionService();
        logger.info('MCPActionHandler initialized');
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        logger.debug('MCPActionHandler disposed');
    }

    /**
     * Get the singleton instance of the handler
     */
    public static getInstance(): MCPActionHandler {
        if (!MCPActionHandler.instance) {
            MCPActionHandler.instance = new MCPActionHandler();
        }
        return MCPActionHandler.instance;
    }

    /**
     * Process context items from an MCP response
     * @param contextItems The context items to process
     * @returns True if any actions were processed
     */
    public async processContextItems(contextItems: MCPContextItem[]): Promise<boolean> {
        if (!contextItems || contextItems.length === 0) {
            return false;
        }

        let actionsProcessed = false;

        // Process each context item
        for (const item of contextItems) {
            switch (item.type) {
                case 'diff':
                    await this.processDiffAction(item);
                    actionsProcessed = true;
                    break;
                case 'terminal':
                    await this.processTerminalAction(item);
                    actionsProcessed = true;
                    break;
                case 'file':
                    await this.processFileAction(item);
                    actionsProcessed = true;
                    break;
                default:
                    // Not an actionable item
                    break;
            }
        }

        return actionsProcessed;
    }

    /**
     * Process a diff context item
     * @param item The diff context item
     */
    private async processDiffAction(item: MCPContextItem): Promise<void> {
        try {
            const filePath = item.metadata?.filePath;
            if (!filePath) {
                logger.warn('Diff action missing file path', { item });
                return;
            }

            const diffContent = item.content;
            if (!diffContent) {
                logger.warn('Diff action has empty content', { filePath });
                return;
            }

            // Ask for confirmation
            const result = await vscode.window.showInformationMessage(
                `Apply changes to ${filePath}?`,
                { modal: true },
                'Apply',
                'Show Diff',
                'Cancel'
            );

            if (result === 'Apply') {
                try {
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
                        logger.debug('Resolved file path for diff action', {
                            originalPath: filePath,
                            resolvedPath: fileUri.fsPath
                        });
                    }

                    // If this is a unified diff, parse it and apply the changes
                    if (diffContent.startsWith('---') || diffContent.startsWith('diff --git')) {
                        await ActionExecutionService.applyDiffChanges(diffContent, `Apply changes to ${filePath}`);
                    } else {
                        // This is just the new content, not a diff
                        // Check if file exists
                        let fileExists = false;
                        let originalContent = '';

                        try {
                            await vscode.workspace.fs.stat(fileUri);
                            fileExists = true;

                            // Read the original content
                            try {
                                const document = await vscode.workspace.openTextDocument(fileUri);
                                originalContent = document.getText();

                                // Create a diff from the original and new content
                                const diffString = this.createUnifiedDiff(
                                    originalContent,
                                    diffContent,
                                    filePath
                                );

                                // Show diff preview
                                await ActionExecutionService.showDiffPreview(
                                    originalContent,
                                    diffContent,
                                    fileUri,
                                    'Proposed Changes'
                                );

                                // Ask for confirmation after showing the diff
                                const diffConfirmResult = await vscode.window.showWarningMessage(
                                    `Apply these changes to ${filePath}?`,
                                    { modal: true },
                                    'Apply',
                                    'Cancel'
                                );

                                if (diffConfirmResult !== 'Apply') {
                                    return;
                                }

                                // Apply the diff changes
                                const success = await ActionExecutionService.applyDiffChanges(
                                    diffString,
                                    `Apply changes to ${filePath}`
                                );

                                if (success) {
                                    vscode.window.showInformationMessage(`Successfully updated file ${filePath}`);

                                    // Open the file
                                    const updatedDocument = await vscode.workspace.openTextDocument(fileUri);
                                    await vscode.window.showTextDocument(updatedDocument);
                                } else {
                                    vscode.window.showErrorMessage(`Failed to update file ${filePath}`);
                                }

                                return;
                            } catch (readError) {
                                logger.error('Error reading file for diff', readError);
                                // Fall back to direct file write
                            }
                        } catch (error) {
                            // File doesn't exist, which is fine
                            logger.info(`File ${filePath} doesn't exist, will create it`);
                        }

                        // If we get here, either the file doesn't exist or we couldn't read it
                        // Use the ActionExecutionService to write the file directly
                        const success = await ActionExecutionService.writeFile(filePath, diffContent, true);

                        if (success) {
                            vscode.window.showInformationMessage(`Successfully ${fileExists ? 'updated' : 'created'} file ${filePath}`);

                            // Open the file
                            const document = await vscode.workspace.openTextDocument(fileUri);
                            await vscode.window.showTextDocument(document);
                        } else {
                            vscode.window.showErrorMessage(`Failed to ${fileExists ? 'update' : 'create'} file ${filePath}`);
                        }
                    }
                } catch (error) {
                    logger.error('Error applying changes', error);
                    vscode.window.showErrorMessage(`Error applying changes: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else if (result === 'Show Diff') {
                // Show the diff
                // Create a temporary file for the diff content
                const tempFile = await vscode.workspace.openTextDocument({
                    content: diffContent,
                    language: 'diff'
                });
                await vscode.window.showTextDocument(tempFile);
            }
        } catch (error) {
            logger.error('Error processing diff action', error);
            vscode.window.showErrorMessage(`Error processing diff action: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Process a terminal context item
     * @param item The terminal context item
     */
    private async processTerminalAction(item: MCPContextItem): Promise<void> {
        try {
            const command = item.content;
            if (!command) {
                logger.warn('Terminal action has empty content');
                return;
            }

            // Ask for confirmation
            const result = await vscode.window.showInformationMessage(
                `Run command: ${command}?`,
                { modal: true },
                'Run',
                'Cancel'
            );

            if (result === 'Run') {
                // Run the command
                await ActionExecutionService.runTerminalCommand(command);
                logger.info('Executed terminal command from MCP action', { command });
            }
        } catch (error) {
            logger.error('Error processing terminal action', error);
            vscode.window.showErrorMessage(`Error processing terminal action: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Process a file context item
     * @param item The file context item
     */
    private async processFileAction(item: MCPContextItem): Promise<void> {
        try {
            const filePath = item.metadata?.filePath;
            if (!filePath) {
                logger.warn('File action missing file path', { item });
                return;
            }

            const fileContent = item.content;
            if (fileContent === undefined) {
                logger.warn('File action has undefined content', { filePath });
                return;
            }

            // Ask for confirmation
            const result = await vscode.window.showInformationMessage(
                `Create or update file: ${filePath}?`,
                { modal: true },
                'Apply',
                'Show Content',
                'Cancel'
            );

            if (result === 'Apply') {
                try {
                    // Get the file URI, ensuring it's properly resolved relative to the workspace
                    let uri: vscode.Uri;

                    // Check if the path is absolute
                    if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:\\/)) {
                        // It's an absolute path, use it directly
                        uri = vscode.Uri.file(filePath);
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
                        uri = vscode.Uri.joinPath(workspaceRoot, filePath);

                        // Log the resolved path
                        logger.debug('Resolved file path for file action', {
                            originalPath: filePath,
                            resolvedPath: uri.fsPath
                        });
                    }

                    // Check if file exists
                    let fileExists = false;
                    let originalContent = '';

                    try {
                        await vscode.workspace.fs.stat(uri);
                        fileExists = true;

                        // File exists, ask for confirmation to overwrite
                        const overwriteResult = await vscode.window.showWarningMessage(
                            `File ${filePath} already exists. Overwrite?`,
                            { modal: true },
                            'Overwrite',
                            'Show Diff',
                            'Cancel'
                        );

                        if (overwriteResult === 'Cancel') {
                            return;
                        }

                        if (overwriteResult === 'Show Diff') {
                            // Read the original content
                            const document = await vscode.workspace.openTextDocument(uri);
                            originalContent = document.getText();

                            // Show diff preview
                            await ActionExecutionService.showDiffPreview(
                                originalContent,
                                fileContent,
                                uri,
                                'Proposed Changes'
                            );

                            // Ask again after showing the diff
                            const afterDiffResult = await vscode.window.showWarningMessage(
                                `Apply changes to ${filePath}?`,
                                { modal: true },
                                'Apply',
                                'Cancel'
                            );

                            if (afterDiffResult !== 'Apply') {
                                return;
                            }
                        }
                    } catch (error) {
                        // File doesn't exist, which is fine
                        logger.info(`File ${filePath} doesn't exist, will create it`);
                    }

                    if (fileExists) {
                        // If the file exists and we have the original content, use diff-based approach
                        if (originalContent) {
                            // Create a diff from the original and new content
                            const diffString = this.createUnifiedDiff(
                                originalContent,
                                fileContent,
                                filePath
                            );

                            // Apply the diff changes
                            const success = await ActionExecutionService.applyDiffChanges(
                                diffString,
                                `Apply changes to ${filePath}`
                            );

                            if (success) {
                                vscode.window.showInformationMessage(`Successfully updated file ${filePath}`);

                                // Open the file
                                const document = await vscode.workspace.openTextDocument(uri);
                                await vscode.window.showTextDocument(document);
                            } else {
                                vscode.window.showErrorMessage(`Failed to update file ${filePath}`);
                            }

                            return;
                        } else {
                            // We don't have the original content yet, read it now
                            try {
                                const document = await vscode.workspace.openTextDocument(uri);
                                originalContent = document.getText();

                                // Create a diff from the original and new content
                                const diffString = this.createUnifiedDiff(
                                    originalContent,
                                    fileContent,
                                    filePath
                                );

                                // Apply the diff changes
                                const success = await ActionExecutionService.applyDiffChanges(
                                    diffString,
                                    `Apply changes to ${filePath}`
                                );

                                if (success) {
                                    vscode.window.showInformationMessage(`Successfully updated file ${filePath}`);

                                    // Open the file
                                    await vscode.window.showTextDocument(document);
                                } else {
                                    vscode.window.showErrorMessage(`Failed to update file ${filePath}`);
                                }

                                return;
                            } catch (readError) {
                                logger.error('Error reading file for diff', readError);
                                // Fall back to direct file write
                            }
                        }
                    }

                    // If the file doesn't exist or we couldn't read it, use direct file write
                    const success = await ActionExecutionService.writeFile(filePath, fileContent, true);

                    if (success) {
                        vscode.window.showInformationMessage(`Successfully ${fileExists ? 'updated' : 'created'} file ${filePath}`);

                        // Open the file
                        const document = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(document);
                    } else {
                        vscode.window.showErrorMessage(`Failed to ${fileExists ? 'update' : 'create'} file ${filePath}`);
                    }
                } catch (error) {
                    logger.error('Error creating/updating file', error);
                    vscode.window.showErrorMessage(`Error creating/updating file: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else if (result === 'Show Content') {
                // Show the content in a new untitled document
                const untitledUri = vscode.Uri.parse(`untitled:${filePath}`);
                const untitledDoc = await vscode.workspace.openTextDocument(untitledUri);
                const edit = new vscode.WorkspaceEdit();
                edit.insert(untitledUri, new vscode.Position(0, 0), fileContent);
                await vscode.workspace.applyEdit(edit);
                await vscode.window.showTextDocument(untitledDoc);
            }
        } catch (error) {
            logger.error('Error processing file action', error);
            vscode.window.showErrorMessage(`Error processing file action: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Create a unified diff string from original and new code
     * @param originalCode The original code
     * @param newCode The new code
     * @param filePath The file path
     * @returns The unified diff string
     */
    private createUnifiedDiff(originalCode: string, newCode: string, filePath?: string): string {
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
}
