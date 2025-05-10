import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { ConfigurationManager } from '../utils/configurationManager';

/**
 * Command to toggle Model Context Protocol (MCP) support
 */
export class ToggleMCPCommand {
    private configManager: ConfigurationManager;

    /**
     * Constructor
     * @param configManager The configuration manager
     */
    constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
    }

    /**
     * Register the command
     * @param context The extension context
     */
    public register(context: vscode.ExtensionContext): void {
        const disposable = vscode.commands.registerCommand('praxcode.toggleMCP', async () => {
            await this.execute();
        });

        context.subscriptions.push(disposable);
    }

    /**
     * Execute the command
     */
    public async execute(): Promise<void> {
        try {
            // Get the current configuration
            const config = this.configManager.getConfiguration();
            const currentValue = config.mcpEnabled;

            // Toggle the value
            const newValue = !currentValue;

            // Update the configuration
            await vscode.workspace.getConfiguration('praxcode').update('mcp.enabled', newValue, vscode.ConfigurationTarget.Global);

            // Show a message to the user
            if (newValue) {
                vscode.window.showInformationMessage('Model Context Protocol (MCP) support has been enabled.');

                // Get the updated configuration
                const updatedConfig = this.configManager.getConfiguration();

                // If enabled, prompt for endpoint URL and model if not already set
                if (!updatedConfig.mcpEndpointUrl || updatedConfig.mcpEndpointUrl === 'http://localhost:8000') {
                    const endpointUrl = await vscode.window.showInputBox({
                        prompt: 'Enter the URL for the MCP-compatible endpoint',
                        value: updatedConfig.mcpEndpointUrl || 'http://localhost:8000',
                        placeHolder: 'http://localhost:8000'
                    });

                    if (endpointUrl) {
                        await vscode.workspace.getConfiguration('praxcode').update('mcp.endpointUrl', endpointUrl, vscode.ConfigurationTarget.Global);
                    }
                }

                if (!updatedConfig.mcpEndpointModel || updatedConfig.mcpEndpointModel === 'default') {
                    const model = await vscode.window.showInputBox({
                        prompt: 'Enter the model to use with the MCP-compatible endpoint',
                        value: updatedConfig.mcpEndpointModel || 'default',
                        placeHolder: 'default'
                    });

                    if (model) {
                        await vscode.workspace.getConfiguration('praxcode').update('mcp.endpointModel', model, vscode.ConfigurationTarget.Global);
                    }
                }

                // Check if we need an API key (not needed for Ollama)
                if (updatedConfig.llmProvider !== 'ollama') {
                    // For non-Ollama providers, we need an API key
                    const apiKey = await this.configManager.getSecret('mcp.apiKey');
                    if (!apiKey) {
                        const key = await vscode.window.showInputBox({
                            prompt: 'Enter the API key for the MCP-compatible endpoint',
                            password: true
                        });

                        if (key) {
                            await this.configManager.storeSecret('mcp.apiKey', key);
                        }
                    }
                } else {
                    // For Ollama, inform the user that no API key is needed
                    vscode.window.showInformationMessage('No API key needed for Ollama with MCP.');
                }
            } else {
                vscode.window.showInformationMessage('Model Context Protocol (MCP) support has been disabled.');
            }

            logger.info(`MCP support toggled to ${newValue}`);
        } catch (error) {
            logger.error('Failed to toggle MCP support', error);
            vscode.window.showErrorMessage(`Failed to toggle MCP support: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
