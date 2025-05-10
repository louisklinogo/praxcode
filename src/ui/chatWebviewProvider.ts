import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { LLMServiceFactory } from '../services/llm/llmServiceFactory';
import { ConfigurationManager } from '../utils/configurationManager';
import { ChatMessage } from '../services/llm/llmService';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';
import { VectorStoreService } from '../services/vectorstore/vectorStoreService';
import { EmbeddingService } from '../services/embedding/embeddingService';
import { ActionableItems } from './components/actionableItems';
import { ParsedCodeChange, ParsedCommand } from '../services/action/llmResponseParser';
import { diffFormatPrompt } from '../prompts/diffFormatPrompt';

/**
 * Provider for the Chat Webview
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly sidebarChatViewType = 'praxcode.sidebarChatView';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _configManager: ConfigurationManager;
    private _llmServiceFactory: LLMServiceFactory;
    private _vectorStore: VectorStoreService;
    private _embeddingService: EmbeddingService;
    private _ragOrchestrator: RAGOrchestrator | null = null;
    private _currentSessionModel: string | null = null;

    /**
     * Constructor
     * @param extensionUri The extension URI
     * @param configManager The configuration manager
     * @param llmServiceFactory The LLM service factory
     * @param vectorStore The vector store service
     * @param embeddingService The embedding service
     */
    constructor(
        extensionUri: vscode.Uri,
        configManager: ConfigurationManager,
        llmServiceFactory: LLMServiceFactory,
        vectorStore: VectorStoreService,
        embeddingService: EmbeddingService
    ) {
        this._extensionUri = extensionUri;
        this._configManager = configManager;
        this._llmServiceFactory = llmServiceFactory;
        this._vectorStore = vectorStore;
        this._embeddingService = embeddingService;
    }

    /**
     * Resolve the webview view
     * @param webviewView The webview view
     * @param context The webview view context
     * @param token The cancellation token
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        // Set up the webview
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Set the HTML content
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            logger.info('Received message from webview', { command: message.command });

            try {
                switch (message.command) {
                    case 'sendMessage':
                        logger.debug('Processing sendMessage', {
                            textLength: message.text?.length,
                            agentMode: message.agentMode,
                            model: message.model,
                            useMCP: message.useMCP
                        });
                        await this._handleSendMessage(message.text, message.agentMode, message.model, message.useMCP);
                        break;
                    case 'clearChat':
                        logger.debug('Processing clearChat');
                        this._handleClearChat();
                        break;
                    case 'getProviderInfo':
                        logger.debug('Processing getProviderInfo');
                        await this._handleGetProviderInfo();
                        break;
                    case 'changeModel':
                        logger.debug('Processing changeModel', { model: message.model });
                        await this._handleChangeModel(message.model);
                        break;
                    case 'indexCodebase':
                        logger.debug('Processing indexCodebase');
                        await this._handleIndexCodebase();
                        break;
                    case 'applyCodeChange':
                        logger.debug('Processing applyCodeChange', {
                            filePath: message.codeChange?.filePath,
                            language: message.codeChange?.language,
                            codeLength: message.codeChange?.newCode?.length
                        });
                        await this._handleApplyCodeChange(message.codeChange);
                        break;
                    case 'runCommand':
                        logger.debug('Processing runCommand', {
                            command: message.terminalCommand?.command,
                            description: message.terminalCommand?.description
                        });
                        await this._handleRunCommand(message.terminalCommand);
                        break;
                    default:
                        logger.warn('Unknown command received from webview', { command: message.command });
                }
            } catch (error) {
                logger.error('Error processing webview message', {
                    command: message.command,
                    error: error instanceof Error ? error.message : String(error)
                });

                // Show error in chat if possible
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'addMessage',
                        message: {
                            role: 'assistant',
                            content: `Error: Failed to process ${message.command}: ${error instanceof Error ? error.message : String(error)}`
                        }
                    });
                }
            }
        });

        // Send initial provider info
        this._handleGetProviderInfo();
    }

    /**
     * Handle sending a message
     * @param text The message text
     * @param agentMode The agent mode (auto or off)
     * @param model The selected model (optional)
     */
    private async _handleSendMessage(text: string, agentMode: string = 'auto', model?: string, useMCP: boolean = false): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            // Add user message to UI
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'user',
                    content: text
                }
            });

            // Add initial assistant message
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: ''
                }
            });

            // Get document count to determine if we should use RAG
            const documentCount = await this._vectorStore.getDocumentCount();
            const config = this._configManager.getConfiguration();

            logger.info(`Chat request received. Vector store has ${documentCount} documents. Vector store enabled: ${config.vectorStoreEnabled}`);

            // Debug the vector store path
            if (this._vectorStore instanceof Object && 'dbPath' in this._vectorStore) {
                logger.info(`Vector store path: ${(this._vectorStore as any).dbPath}`);
            }

            // Use RAG if vector store is enabled and has documents
            if (config.vectorStoreEnabled && documentCount > 0) {
                logger.info(`Using RAG for query: "${text.substring(0, 50)}..."`);

                // Initialize RAG orchestrator if needed
                if (!this._ragOrchestrator || model) {
                    logger.debug(`Creating new RAG orchestrator. Current orchestrator exists: ${!!this._ragOrchestrator}, model specified: ${model || 'none'}`);

                    // Get the LLM service
                    const llmService = await this._llmServiceFactory.getService();
                    logger.debug(`Got LLM service: ${llmService.getName()}`);

                    // Log the current configuration
                    const currentConfig = this._configManager.getConfiguration();
                    logger.debug(`Current configuration: provider=${currentConfig.llmProvider}, ollamaModel=${currentConfig.ollamaModel}`);
                    logger.debug(`RAG settings: enabled=${currentConfig.ragOnlyModeEnabled}, forced=${currentConfig.ragOnlyModeForceEnabled}`);

                    // If model is specified, check if we need to change it
                    if (model) {
                        // Parse the model string if it's in the new format (provider:model)
                        let modelName = model;
                        let provider = '';

                        if (model.includes(':')) {
                            // Handle special case for Ollama models that may contain colons
                            if (model.startsWith('ollama:')) {
                                provider = 'ollama';
                                modelName = model.substring('ollama:'.length);
                                logger.debug(`Parsed Ollama model: provider=${provider}, modelName=${modelName}`);
                            } else {
                                // For other providers, split by the first colon
                                const firstColonIndex = model.indexOf(':');
                                if (firstColonIndex !== -1) {
                                    provider = model.substring(0, firstColonIndex);
                                    modelName = model.substring(firstColonIndex + 1);
                                    logger.debug(`Parsed model: provider=${provider}, modelName=${modelName}`);
                                }
                            }
                        }

                        // Update the configuration temporarily for this request
                        const config = this._configManager.getConfiguration();
                        const currentModel = this._getCurrentModelFromConfig(config);

                        if (model !== currentModel) {
                            logger.info(`Temporarily using model: ${model} instead of ${currentModel}`);
                            // We'll use the existing service but note the model change in logs
                        }
                    }

                    // Create the RAG orchestrator
                    logger.debug('Creating new RAG orchestrator with current LLM service');
                    this._ragOrchestrator = new RAGOrchestrator(
                        this._vectorStore,
                        this._embeddingService,
                        llmService,
                        this._configManager
                    );
                    logger.info('RAG orchestrator initialized');
                }

                // Prepare system message based on agent mode
                let systemMessage = 'You are PraxCode, a helpful AI coding assistant. Provide clear, concise answers to coding questions. When sharing code, use markdown code blocks with the appropriate language syntax.';

                if (agentMode === 'auto') {
                    systemMessage = `You are PraxCode, an agentic AI coding assistant. You can help users by modifying files and executing terminal commands.

When a user asks you to make changes to their code:
1. Analyze the request carefully
2. Retrieve the relevant files using codebase-retrieval
3. Make precise edits using str-replace-editor
4. Execute terminal commands when needed using launch-process
5. Verify your changes worked correctly

${diffFormatPrompt}

For code changes, follow these guidelines:
- Always specify the exact file path when suggesting code changes (e.g., "In src/app.js, we need to...")
- When showing code changes, use markdown code blocks with the appropriate language syntax
- Only suggest changes to actual code files, not documentation or configuration files unless specifically requested
- Make sure your suggested code is complete and valid
- If suggesting a complete file replacement, include the entire file content in your code block

For terminal commands:
- Use shell/bash code blocks for terminal commands
- Keep commands simple and focused on one task
- Explain what each command does before showing it

Always explain what you're doing and why. Be thorough but concise.`;
                }

                // Get MCP configuration
                const mcpConfig = this._configManager.getConfiguration();
                const mcpEnabled = mcpConfig.mcpEnabled;

                // Determine if we should use MCP for this query
                const shouldUseMCP = useMCP || mcpEnabled;

                if (shouldUseMCP) {
                    logger.info('Using Model Context Protocol (MCP) for this query');
                }

                // Stream the response using RAG
                await this._ragOrchestrator.streamQuery(
                    text,
                    (content, done) => {
                        // Update the message content
                        this._view?.webview.postMessage({
                            command: 'updateMessage',
                            content: content
                        });

                        // Process actionable items if agent mode is enabled
                        if (agentMode === 'auto' && this._view) {
                            ActionableItems.processMessage(content, this._view.webview);
                        }

                        // Log the content for debugging
                        if (done) {
                            logger.info('RAG response completed', { contentLength: content.length });
                        }
                    },
                    {
                        systemPrompt: systemMessage,
                        useMCP: shouldUseMCP
                    }
                );

                logger.info('RAG chat response completed');
            } else {
                logger.info(`Falling back to direct LLM service. Vector store has ${documentCount} documents.`);

                // Fallback to direct LLM service if RAG is not available
                const llmService = await this._llmServiceFactory.getService();

                // If model is specified, log that we're using a different model
                if (model) {
                    // Parse the model string if it's in the new format (provider:model)
                    let modelName = model;
                    if (model.includes(':')) {
                        // Handle special case for Ollama models that may contain colons
                        if (model.startsWith('ollama:')) {
                            modelName = model.substring('ollama:'.length);
                        } else {
                            // For other providers, split by the first colon
                            const firstColonIndex = model.indexOf(':');
                            if (firstColonIndex !== -1) {
                                modelName = model.substring(firstColonIndex + 1);
                            }
                        }
                    }

                    const config = this._configManager.getConfiguration();
                    const currentModel = this._getCurrentModelFromConfig(config);

                    if (model !== currentModel) {
                        logger.info(`Temporarily using model: ${model} instead of ${currentModel}`);
                        // We'll use the existing service but note the model change in logs
                    }
                }

                // Prepare system message based on agent mode
                let systemMessage = 'You are PraxCode, a helpful AI coding assistant. Provide clear, concise answers to coding questions. When sharing code, use markdown code blocks with the appropriate language syntax.';

                if (agentMode === 'auto') {
                    systemMessage = `You are PraxCode, an agentic AI coding assistant. You can help users by modifying files and executing terminal commands.

When a user asks you to make changes to their code:
1. Analyze the request carefully
2. Retrieve the relevant files using codebase-retrieval
3. Make precise edits using str-replace-editor
4. Execute terminal commands when needed using launch-process
5. Verify your changes worked correctly

${diffFormatPrompt}

For code changes, follow these guidelines:
- Always specify the exact file path when suggesting code changes (e.g., "In src/app.js, we need to...")
- When showing code changes, use markdown code blocks with the appropriate language syntax
- Only suggest changes to actual code files, not documentation or configuration files unless specifically requested
- Make sure your suggested code is complete and valid
- If suggesting a complete file replacement, include the entire file content in your code block

For terminal commands:
- Use shell/bash code blocks for terminal commands
- Keep commands simple and focused on one task
- Explain what each command does before showing it

Always explain what you're doing and why. Be thorough but concise.`;
                }

                // Get MCP configuration
                const mcpConfig = this._configManager.getConfiguration();
                const mcpEnabled = mcpConfig.mcpEnabled;

                // Determine if we should use MCP for this query
                const shouldUseMCP = useMCP || mcpEnabled;

                if (shouldUseMCP) {
                    logger.info('Using Model Context Protocol (MCP) for direct LLM query');
                }

                // Prepare messages
                const messages: ChatMessage[] = [
                    {
                        role: 'system',
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ];

                // Log that we're starting the request
                logger.debug('Starting direct LLM request');

                // Stream the response
                await llmService.streamChat(
                    messages,
                    (response) => {
                        // Update the message content
                        this._view?.webview.postMessage({
                            command: 'updateMessage',
                            content: response.content
                        });

                        // Process actionable items if agent mode is enabled
                        if (agentMode === 'auto' && this._view) {
                            ActionableItems.processMessage(response.content, this._view.webview);
                        }

                        // Process any context items in the response if MCP is enabled
                        if (shouldUseMCP && response.contextItems && response.contextItems.length > 0 && this._view) {
                            logger.debug(`Received ${response.contextItems.length} context items in MCP response`);
                            // Here we could process the context items for actions
                        }

                        // Log the content for debugging
                        if (response.done) {
                            logger.debug('Direct response completed', { contentLength: response.content.length });
                        }
                    },
                    {
                        useMCP: shouldUseMCP
                    }
                );

                logger.debug('Direct chat response completed');
            }
        } catch (error) {
            logger.error('Error sending message', error);

            // Show error in chat
            this._view.webview.postMessage({
                command: 'updateMessage',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /**
     * Handle clearing the chat
     */
    private _handleClearChat(): void {
        if (!this._view) {
            return;
        }

        this._view.webview.postMessage({
            command: 'clearChat'
        });
    }

    /**
     * Handle getting provider info
     */
    private async _handleGetProviderInfo(): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            const config = this._configManager.getConfiguration();

            // Get all available providers and their models
            const allProviders = await this._llmServiceFactory.getAllProviders();

            // Flatten all models into a single array with provider prefixes
            const allModels: string[] = [];

            // Add RAG-only option first
            allModels.push('rag-only');

            // Add all other models with provider prefixes
            for (const provider of allProviders) {
                if (provider.provider !== 'RAG-Only') {
                    for (const model of provider.models) {
                        allModels.push(`${provider.provider.toLowerCase()}:${model}`);
                    }
                }
            }

            // Get the current model - use session model if available
            let currentModel = '';

            if (this._currentSessionModel) {
                // Use the session model if we have one
                currentModel = this._currentSessionModel;
                logger.info(`Using session model: ${currentModel}`);
            } else {
                // Otherwise get from config based on provider type
                if (config.llmProvider === 'none' || config.ragOnlyModeForceEnabled) {
                    currentModel = 'rag-only';
                } else {
                    switch (config.llmProvider) {
                        case 'ollama':
                            currentModel = `ollama:${config.ollamaModel}`;
                            break;
                        case 'openai':
                            currentModel = `openai:${config.openaiModel}`;
                            break;
                        case 'anthropic':
                            currentModel = `anthropic:${config.anthropicModel}`;
                            break;
                        case 'google':
                            currentModel = `google:${config.googleModel}`;
                            break;
                        case 'openrouter':
                            currentModel = `openrouter:${config.openrouterModel}`;
                            break;
                        case 'custom':
                            currentModel = `custom:${config.customProviderModel}`;
                            break;
                        default:
                            currentModel = 'rag-only';
                    }
                }
            }

            // Get the current LLM service for the provider name
            const llmService = await this._llmServiceFactory.getService();

            this._view.webview.postMessage({
                command: 'setProviderInfo',
                provider: {
                    name: llmService.getName(),
                    model: currentModel,
                    availableModels: allModels
                }
            });
        } catch (error) {
            logger.error('Error getting provider info', error);

            // Fallback to basic model list
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'setProviderInfo',
                    provider: {
                        name: 'PraxCode',
                        model: 'rag-only',
                        availableModels: ['rag-only', 'ollama:llama3']
                    }
                });
            }
        }
    }

    /**
     * Handle changing the model
     * @param model The model to change to
     */
    private async _handleChangeModel(model: string): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            // Check if this is RAG-only mode
            if (model === 'rag-only') {
                // Set the provider to 'none' to enable RAG-only mode
                logger.debug('Setting llmProvider to "none" for RAG-only mode');
                await vscode.workspace.getConfiguration('praxcode').update('llmProvider', 'none', vscode.ConfigurationTarget.Workspace);
                logger.info('Switched to RAG-only mode');

                // Force reload the configuration to ensure we have the latest values
                this._configManager.reloadConfiguration();
                const updatedConfig = this._configManager.getConfiguration();
                logger.debug(`After update, llmProvider is: ${updatedConfig.llmProvider}`);

                // Double-check that the setting was actually updated
                if (updatedConfig.llmProvider !== 'none') {
                    logger.warn(`Configuration update failed! llmProvider is still: ${updatedConfig.llmProvider}`);
                    // Try updating again with a different approach
                    try {
                        await vscode.workspace.getConfiguration().update('praxcode.llmProvider', 'none', vscode.ConfigurationTarget.Workspace);
                        logger.debug('Attempted alternative configuration update method');
                        this._configManager.reloadConfiguration();
                        logger.debug(`After second attempt, llmProvider is: ${this._configManager.getConfiguration().llmProvider}`);
                    } catch (secondError) {
                        logger.error('Failed to update configuration on second attempt', secondError);
                    }
                }

                // Store the model in memory for this session
                this._currentSessionModel = model;

                // Reset the LLM service to use the new model
                logger.debug('Resetting LLM service to use RAG-only mode');
                this._llmServiceFactory.resetService();

                // Get the updated LLM service with the new model
                logger.debug('Getting updated LLM service for RAG-only mode');
                const llmService = await this._llmServiceFactory.getService();
                logger.debug(`New LLM service created: ${llmService.getName()}`);

                // Reset the RAG orchestrator to use the new LLM service
                logger.debug('Resetting RAG orchestrator for RAG-only mode');
                this._ragOrchestrator = null;

                // Update the UI with the new model
                this._view.webview.postMessage({
                    command: 'setProviderInfo',
                    provider: {
                        name: 'RAG-Only Mode',
                        model: model,
                        availableModels: await this._getFormattedModelList()
                    }
                });

                // Show a confirmation message
                this._view.webview.postMessage({
                    command: 'addMessage',
                    message: {
                        role: 'assistant',
                        content: `Switched to RAG-only mode. No LLM will be used. Only codebase search results will be shown.`
                    }
                });

                return;
            }

            // Parse the model string (format: "provider:model")
            // Handle special case for Ollama models that may contain colons
            let provider: string;
            let modelName: string;

            if (model.startsWith('ollama:')) {
                // For Ollama models, the provider is 'ollama' and the rest is the model name
                provider = 'ollama';
                modelName = model.substring('ollama:'.length);
            } else {
                // For other providers, split by the first colon
                const firstColonIndex = model.indexOf(':');
                if (firstColonIndex === -1) {
                    throw new Error(`Invalid model format: ${model}. Expected format: "provider:model"`);
                }

                provider = model.substring(0, firstColonIndex);
                modelName = model.substring(firstColonIndex + 1);
            }

            // Update the provider setting
            logger.debug(`Changing provider from ${this._configManager.getConfiguration().llmProvider} to ${provider}`);
            await vscode.workspace.getConfiguration('praxcode').update('llmProvider', provider, vscode.ConfigurationTarget.Workspace);
            logger.info(`Updated provider to ${provider}`);

            // Force reload the configuration to ensure we have the latest values
            this._configManager.reloadConfiguration();
            const updatedConfig = this._configManager.getConfiguration();
            logger.debug(`After update, llmProvider is: ${updatedConfig.llmProvider}`);

            // Double-check that the setting was actually updated
            if (updatedConfig.llmProvider !== provider) {
                logger.warn(`Configuration update failed! llmProvider is still: ${updatedConfig.llmProvider}`);
                // Try updating again with a different approach
                try {
                    await vscode.workspace.getConfiguration().update(`praxcode.llmProvider`, provider, vscode.ConfigurationTarget.Workspace);
                    logger.debug('Attempted alternative configuration update method');
                    this._configManager.reloadConfiguration();
                    logger.debug(`After second attempt, llmProvider is: ${this._configManager.getConfiguration().llmProvider}`);
                } catch (secondError) {
                    logger.error('Failed to update configuration on second attempt', secondError);
                }
            }

            // Update the appropriate model setting based on provider type
            const settingKey = `${provider}Model`;

            // We need to update the VS Code settings
            // Use ConfigurationTarget.Workspace instead of Global to avoid file save dialog
            try {
                // Get the current model value based on provider
                let currentModelValue = '';
                const config = this._configManager.getConfiguration();
                switch (provider) {
                    case 'ollama':
                        currentModelValue = config.ollamaModel;
                        break;
                    case 'openai':
                        currentModelValue = config.openaiModel;
                        break;
                    case 'anthropic':
                        currentModelValue = config.anthropicModel;
                        break;
                    case 'google':
                        currentModelValue = config.googleModel;
                        break;
                    case 'openrouter':
                        currentModelValue = config.openrouterModel;
                        break;
                    case 'custom':
                        currentModelValue = config.customProviderModel;
                        break;
                    default:
                        currentModelValue = 'unknown';
                }
                logger.debug(`Updating model setting ${settingKey} from ${currentModelValue} to ${modelName}`);
                await vscode.workspace.getConfiguration('praxcode').update(settingKey, modelName, vscode.ConfigurationTarget.Workspace);
                logger.info(`Updated model setting ${settingKey} to ${modelName} at workspace level`);

                // Force reload the configuration to ensure we have the latest values
                this._configManager.reloadConfiguration();
                // Get the updated model value based on provider
                const updatedConfig = this._configManager.getConfiguration();
                let updatedModelValue = '';
                switch (provider) {
                    case 'ollama':
                        updatedModelValue = updatedConfig.ollamaModel;
                        break;
                    case 'openai':
                        updatedModelValue = updatedConfig.openaiModel;
                        break;
                    case 'anthropic':
                        updatedModelValue = updatedConfig.anthropicModel;
                        break;
                    case 'google':
                        updatedModelValue = updatedConfig.googleModel;
                        break;
                    case 'openrouter':
                        updatedModelValue = updatedConfig.openrouterModel;
                        break;
                    case 'custom':
                        updatedModelValue = updatedConfig.customProviderModel;
                        break;
                    default:
                        updatedModelValue = 'unknown';
                }
                logger.debug(`Configuration reloaded after model change. New provider: ${updatedConfig.llmProvider}, New model: ${updatedModelValue}`);
            } catch (configError) {
                logger.warn(`Failed to update at workspace level, falling back to memory-only: ${configError}`);
                // If workspace update fails, we'll just keep the setting in memory for this session
                // This avoids the file save dialog but won't persist the setting between sessions
            }

            // Store the model in memory for this session
            this._currentSessionModel = model;

            // Reset the LLM service to use the new model
            logger.debug('Resetting LLM service to use the new model');
            this._llmServiceFactory.resetService();

            // Get the updated LLM service with the new model
            logger.debug('Getting updated LLM service with the new model');
            const llmService = await this._llmServiceFactory.getService();
            logger.debug(`New LLM service created: ${llmService.getName()}`);

            // Reset the RAG orchestrator to use the new LLM service
            logger.debug('Resetting RAG orchestrator to use the new LLM service');
            this._ragOrchestrator = null;

            // Get formatted model list
            const formattedModels = await this._getFormattedModelList();

            // Update the UI with the new model and available models
            this._view.webview.postMessage({
                command: 'setProviderInfo',
                provider: {
                    name: llmService.getName(),
                    model: model,
                    availableModels: formattedModels
                }
            });

            // Show a confirmation message
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Model changed to ${model}. You can now start a new conversation.`
                }
            });
        } catch (error) {
            logger.error('Error changing model', error);

            // Show error in chat
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Error: Failed to change model: ${error instanceof Error ? error.message : String(error)}`
                }
            });

            // Try to refresh provider info to restore the model list
            this._handleGetProviderInfo().catch(e =>
                logger.error('Failed to refresh provider info after model change error', e)
            );
        }
    }

    /**
     * Get a formatted list of all available models
     * @returns A promise that resolves to an array of formatted model strings
     */
    private async _getFormattedModelList(): Promise<string[]> {
        try {
            // Get all available providers and their models
            const allProviders = await this._llmServiceFactory.getAllProviders();

            // Flatten all models into a single array with provider prefixes
            const allModels: string[] = [];

            // Add RAG-only option first
            allModels.push('rag-only');

            // Add all other models with provider prefixes
            for (const provider of allProviders) {
                if (provider.provider !== 'RAG-Only') {
                    for (const model of provider.models) {
                        // For Ollama models, ensure we don't double-format models that already have colons
                        if (provider.provider.toLowerCase() === 'ollama') {
                            // Just add the provider prefix
                            allModels.push(`ollama:${model}`);
                        } else {
                            // For other providers, add the standard prefix
                            allModels.push(`${provider.provider.toLowerCase()}:${model}`);
                        }
                    }
                }
            }

            return allModels;
        } catch (error) {
            logger.error('Error getting formatted model list', error);
            return ['rag-only', 'ollama:llama3'];
        }
    }

    /**
     * Handle indexing the codebase
     */
    private async _handleIndexCodebase(): Promise<void> {
        if (!this._view) {
            return;
        }

        try {
            // Execute the indexWorkspace command
            await vscode.commands.executeCommand('praxcode.indexWorkspace');

            // Show success message after indexing
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Codebase indexing completed successfully! You can now ask questions about your code.'
                }
            });
        } catch (error) {
            logger.error('Error indexing codebase', error);

            // Show error in chat
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Error: Failed to index codebase: ${error}`
                }
            });
        }
    }

    /**
     * Handle applying a code change
     * @param codeChange The code change to apply
     */
    private async _handleApplyCodeChange(codeChange: ParsedCodeChange): Promise<void> {
        if (!this._view) {
            logger.warn('Cannot apply code change: No active view');
            return;
        }

        // Validate the code change
        if (!codeChange) {
            logger.error('Invalid code change: codeChange is null or undefined');
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Error: Cannot apply code change - invalid data received'
                }
            });
            return;
        }

        if (!codeChange.newCode) {
            logger.error('Invalid code change: newCode is missing', { codeChange });
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Error: Cannot apply code change - no code content provided'
                }
            });
            return;
        }

        logger.info('Applying code change', {
            filePath: codeChange.filePath,
            language: codeChange.language,
            hasOriginalCode: !!codeChange.originalCode,
            newCodeLength: codeChange.newCode.length
        });

        try {
            // Use the ActionableItems class to handle the code change
            logger.debug('Calling ActionableItems.handleCodeChange');
            await ActionableItems.handleCodeChange(codeChange);

            logger.info('Code changes applied successfully');

            // Show success message
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Code changes applied successfully!'
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error applying code change', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined
            });

            // Show error in chat
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Error: Failed to apply code change: ${errorMessage}`
                }
            });
        }
    }

    /**
     * Handle running a terminal command
     * @param command The command to run
     */
    private async _handleRunCommand(command: ParsedCommand): Promise<void> {
        if (!this._view) {
            logger.warn('Cannot run command: No active view');
            return;
        }

        // Validate the command
        if (!command) {
            logger.error('Invalid command: command is null or undefined');
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Error: Cannot run command - invalid data received'
                }
            });
            return;
        }

        if (!command.command || typeof command.command !== 'string') {
            logger.error('Invalid command: command string is missing or not a string', { command });
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Error: Cannot run command - no valid command string provided'
                }
            });
            return;
        }

        // Trim the command to remove any leading/trailing whitespace
        const commandStr = command.command.trim();
        if (!commandStr) {
            logger.error('Invalid command: command string is empty after trimming');
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: 'Error: Cannot run command - empty command string'
                }
            });
            return;
        }

        logger.info('Running terminal command', {
            command: commandStr,
            description: command.description
        });

        try {
            // Use the ActionableItems class to handle the command
            logger.debug('Calling ActionableItems.handleCommand');
            await ActionableItems.handleCommand(command);

            logger.info('Command sent to terminal successfully');

            // Show success message
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Command sent to terminal: ${commandStr}`
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error running command', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                command: commandStr
            });

            // Show error in chat
            this._view.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Error: Failed to run command: ${errorMessage}`
                }
            });
        }
    }

    /**
     * Get the current model from the configuration
     * @param config The configuration
     * @returns The current model
     */
    private _getCurrentModelFromConfig(config: any): string {
        // If we have a session model, use that instead of the config
        if (this._currentSessionModel) {
            return this._currentSessionModel;
        }

        // Check if RAG-only mode is enabled
        if (config.llmProvider === 'none' || config.ragOnlyModeForceEnabled) {
            return 'rag-only';
        }

        // Otherwise use the model from config with provider prefix
        switch (config.llmProvider) {
            case 'ollama':
                return `ollama:${config.ollamaModel}`;
            case 'openai':
                return `openai:${config.openaiModel}`;
            case 'anthropic':
                return `anthropic:${config.anthropicModel}`;
            case 'google':
                return `google:${config.googleModel}`;
            case 'openrouter':
                return `openrouter:${config.openrouterModel}`;
            case 'custom':
                return `custom:${config.customProviderModel}`;
            default:
                return 'rag-only';
        }
    }

    /**
     * Get the HTML for the webview
     * @param _webview The webview (unused)
     */
    private _getHtmlForWebview(_webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PraxCode Chat</title>
            <link rel="stylesheet" href="${_webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css'))}">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    padding: 0;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    background-color: var(--vscode-editor-background);
                }

                /* Header styles removed as per user request */

                .provider-info {
                    font-size: 0.9em;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    margin-right: 10px;
                }

                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                    padding-top: 0; /* Adjusted for removed header */
                    scroll-behavior: smooth;
                }

                .message {
                    margin-bottom: 24px;
                    display: flex;
                    flex-direction: column;
                    max-width: 100%;
                    animation: fadeIn 0.3s ease-in-out;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .message-header {
                    font-weight: bold;
                    margin-bottom: 6px;
                    display: flex;
                    align-items: center;
                }

                .user-message .message-header {
                    color: var(--vscode-terminal-ansiBlue);
                }

                .user-message .message-header::before {
                    content: '$(account)';
                    font-family: 'codicon';
                    margin-right: 6px;
                }

                .assistant-message .message-header {
                    color: var(--vscode-terminal-ansiGreen);
                }

                .assistant-message .message-header::before {
                    content: '$(hubot)';
                    font-family: 'codicon';
                    margin-right: 6px;
                }

                .message-content {
                    white-space: pre-wrap;
                    line-height: 1.6;
                    padding: 8px 12px;
                    border-radius: 8px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                }

                .actionable-items {
                    margin-top: 8px;
                    padding: 8px;
                    border-radius: 6px;
                    background-color: var(--vscode-sideBarSectionHeader-background);
                    border: 1px solid var(--vscode-panel-border);
                }

                .actionable-item {
                    margin-bottom: 8px;
                    padding: 8px;
                    border-radius: 4px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border: 1px solid var(--vscode-panel-border);
                }

                .actionable-item-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 4px;
                }

                .actionable-item-title {
                    font-weight: bold;
                    color: var(--vscode-terminal-ansiCyan);
                }

                .actionable-item-actions {
                    display: flex;
                    gap: 4px;
                }

                .actionable-item-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 2px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 0.9em;
                }

                .actionable-item-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }

                .actionable-item-content {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 0.9em;
                    white-space: pre-wrap;
                    overflow-x: auto;
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 4px;
                    background-color: var(--vscode-textCodeBlock-background);
                    border-radius: 4px;
                }

                .user-message .message-content {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                }

                .assistant-message .message-content {
                    background-color: var(--vscode-sideBarSectionHeader-background);
                }

                .message-content code {
                    font-family: var(--vscode-editor-font-family);
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                }

                .message-content pre {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 12px;
                    border-radius: 6px;
                    overflow-x: auto;
                    margin: 12px 0;
                    border: 1px solid var(--vscode-panel-border);
                }

                .error-message .message-content {
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    color: var(--vscode-inputValidation-errorForeground);
                }

                .input-area {
                    border-top: 1px solid var(--vscode-panel-border);
                    background-color: var(--vscode-editor-background);
                    position: sticky;
                    bottom: 0;
                    padding: 8px;
                }

                .input-container {
                    display: flex;
                    flex-direction: column;
                    background-color: var(--vscode-editor-background);
                    border-radius: 3px;
                }

                .input-row {
                    display: flex;
                    margin-bottom: 6px;
                    align-items: center;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 3px;
                    padding: 2px;
                }

                .model-controls {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .model-selector {
                    display: flex;
                    align-items: center;
                    background-color: var(--vscode-dropdown-background);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 3px;
                    padding: 0 4px;
                    height: 22px;
                    min-width: 140px;
                }

                .toggle-controls {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .model-dropdown {
                    background: transparent;
                    border: none;
                    color: var(--vscode-foreground);
                    font-size: 0.85em;
                    padding: 0 4px;
                    cursor: pointer;
                    outline: none;
                    height: 22px;
                    min-width: 120px;
                    width: 100%;
                    text-transform: lowercase;
                }

                .toggle-button {
                    background: transparent;
                    border: 1px solid var(--vscode-dropdown-border);
                    color: var(--vscode-descriptionForeground);
                    cursor: pointer;
                    padding: 0 8px;
                    font-size: 0.75em;
                    border-radius: 2px;
                    height: 22px;
                    display: flex;
                    align-items: center;
                    text-transform: uppercase;
                }

                .toggle-button.active {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border-color: var(--vscode-button-background);
                }

                .codicon {
                    font-family: 'codicon';
                    font-size: 12px;
                    color: var(--vscode-foreground);
                }

                .agent-mode-option.active, .mcp-option.active {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }

                .model-dropdown:focus {
                    outline: none;
                }

                #message-input {
                    flex: 1;
                    padding: 4px 8px;
                    border: none;
                    background-color: transparent;
                    color: var(--vscode-input-foreground);
                    resize: none;
                    min-height: 22px;
                    max-height: 100px;
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    line-height: 1.4;
                    overflow-y: auto;
                }

                #message-input:focus {
                    outline: none;
                }

                #send-button {
                    background-color: transparent;
                    color: var(--vscode-descriptionForeground);
                    border: none;
                    padding: 4px;
                    cursor: pointer;
                    font-size: 0.9em;
                    transition: color 0.2s;
                    border-radius: 3px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 2px;
                }

                #send-button:hover {
                    color: var(--vscode-button-foreground);
                }

                .input-right-actions {
                    display: flex;
                    align-items: center;
                }



                #send-button:active {
                    transform: translateY(1px);
                }

                .clear-button {
                    background: none;
                    border: none;
                    color: var(--vscode-foreground);
                    opacity: 0.7;
                    cursor: pointer;
                    padding: 4px 8px;
                    border-radius: 4px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                }

                .clear-button::before {
                    content: '$(clear-all)';
                    font-family: 'codicon';
                    margin-right: 4px;
                }

                .clear-button:hover {
                    opacity: 1;
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }

                .typing-indicator {
                    display: inline-block;
                    margin-left: 4px;
                }

                .typing-indicator span {
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    background-color: var(--vscode-terminal-ansiGreen);
                    border-radius: 50%;
                    margin: 0 2px;
                    opacity: 0.6;
                    animation: typing 1s infinite;
                }

                .typing-indicator span:nth-child(2) {
                    animation-delay: 0.2s;
                }

                .typing-indicator span:nth-child(3) {
                    animation-delay: 0.4s;
                }

                @keyframes typing {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                }

                .welcome-message {
                    padding: 16px;
                    background-color: var(--vscode-editor-background);
                    border-radius: 8px;
                    margin-bottom: 24px;
                    animation: fadeIn 0.5s ease-in-out;
                }

                .welcome-message h3 {
                    margin-top: 0;
                    color: var(--vscode-terminal-ansiGreen);
                }

                .welcome-message ul {
                    padding-left: 20px;
                }

                .welcome-message li {
                    margin-bottom: 8px;
                    color: var(--vscode-terminal-ansiBlue);
                    cursor: pointer;
                }

                .welcome-message li:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <!-- Header removed as per user request -->

            <div class="chat-container" id="chat-container">
                <!-- Messages will be added here -->
                <div class="welcome-message" style="text-align: center; padding: 80px 20px; max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; height: calc(100vh - 200px); background-color: var(--vscode-editor-background);">
                    <h3 style="color: var(--vscode-terminal-ansiGreen); margin-bottom: 20px; font-size: 1.4em;">Index Codebase</h3>
                    <p style="margin-bottom: 12px; line-height: 1.5;">Indexing allows PraxCode to make tailored code suggestions and explain common practices or patterns.</p>
                    <p style="margin-bottom: 30px; line-height: 1.5;">Your data always stays secure, private and anonymized.</p>
                    <button id="index-codebase-button" style="background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; border-radius: 6px; font-weight: 500; min-width: 180px;">Index Codebase</button>
                </div>
            </div>

            <div class="input-area">
                <div class="input-container">
                    <div class="input-row">
                        <textarea id="message-input" placeholder="Ask PraxCode..." rows="1"></textarea>
                        <button id="send-button" title="Send message"><span class="codicon codicon-arrow-up"></span></button>
                    </div>
                    <div class="model-controls">
                        <div class="model-selector">
                            <select id="model-select" class="model-dropdown">
                                <option value="loading">Loading models...</option>
                            </select>
                        </div>
                        <div class="toggle-controls">
                            <button class="toggle-button" id="agent-mode-off" data-mode="off">Agent</button>
                            <button class="toggle-button active" id="agent-mode-auto" data-mode="auto">Agent</button>
                            <button class="toggle-button active" id="mcp-off" data-mcp="off">MCP</button>
                            <button class="toggle-button" id="mcp-on" data-mcp="on">MCP</button>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                (function() {
                    // Get elements
                    const vscode = acquireVsCodeApi();
                    const chatContainer = document.getElementById('chat-container');
                    const messageInput = document.getElementById('message-input');
                    const sendButton = document.getElementById('send-button');
                    const agentModeOff = document.getElementById('agent-mode-off');
                    const agentModeAuto = document.getElementById('agent-mode-auto');
                    const mcpOff = document.getElementById('mcp-off');
                    const mcpOn = document.getElementById('mcp-on');
                    // Model selection element
                    const modelSelectElement = document.getElementById('model-select');
                    // Keep track of the last assistant message for updating
                    let lastAssistantMessageElement = null;
                    let lastAssistantHeaderElement = null;
                    let isWaitingForResponse = false;
                    let agentMode = 'auto'; // Default to auto
                    let useMCP = false; // Default to off

                    // Function to send a message
                    function sendMessage() {
                        const text = messageInput.value.trim();
                        if (text && !isWaitingForResponse) {
                            // Set waiting state
                            isWaitingForResponse = true;
                            sendButton.disabled = true;
                            messageInput.disabled = true;

                            vscode.postMessage({
                                command: 'sendMessage',
                                text: text,
                                agentMode: agentMode,
                                model: modelSelectElement.value,
                                useMCP: useMCP
                            });

                            messageInput.value = '';
                        }
                    }

                    // Function to add a message to the chat
                    function addMessage(message) {
                        // Hide welcome message if it exists
                        const welcomeMessage = document.querySelector('.welcome-message');
                        if (welcomeMessage) {
                            welcomeMessage.style.display = 'none';
                        }

                        const messageElement = document.createElement('div');

                        // Check if this is an error message
                        const isError = message.content && message.content.startsWith('Error:');

                        // Set appropriate classes
                        if (isError && message.role === 'assistant') {
                            messageElement.className = \`message \${message.role}-message error-message\`;
                        } else {
                            messageElement.className = \`message \${message.role}-message\`;
                        }

                        const headerElement = document.createElement('div');
                        headerElement.className = 'message-header';

                        // Add name
                        const nameSpan = document.createElement('span');
                        nameSpan.textContent = message.role === 'user' ? 'You' : 'PraxCode';
                        headerElement.appendChild(nameSpan);

                        // Add typing indicator for assistant messages
                        if (message.role === 'assistant' && !message.content) {
                            const typingIndicator = document.createElement('div');
                            typingIndicator.className = 'typing-indicator';
                            typingIndicator.innerHTML = '<span></span><span></span><span></span>';
                            headerElement.appendChild(typingIndicator);
                        }

                        const contentElement = document.createElement('div');
                        contentElement.className = 'message-content';

                        // Store the last assistant message element for updating
                        if (message.role === 'assistant') {
                            lastAssistantMessageElement = contentElement;

                            // Store the header element to update typing indicator
                            lastAssistantHeaderElement = headerElement;
                        }

                        // Convert markdown-style code blocks to HTML
                        let content = message.content || '';

                        // Simple markdown parsing for code blocks and inline code
                        content = parseMarkdown(content);

                        contentElement.innerHTML = content;

                        messageElement.appendChild(headerElement);
                        messageElement.appendChild(contentElement);

                        chatContainer.appendChild(messageElement);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    // Function to parse markdown - simplified version
                    function parseMarkdown(text) {
                        if (!text) return '';

                        // Just return the text as-is for now
                        // We'll implement proper markdown parsing later
                        return text;
                    }

                    // Function to update the last assistant message
                    function updateLastAssistantMessage(content) {
                        if (lastAssistantMessageElement) {
                            // Check if this is an error message
                            const isError = content && content.startsWith('Error:');

                            // Add error class if needed
                            if (isError) {
                                lastAssistantMessageElement.parentElement.classList.add('error-message');
                            }

                            // Convert markdown-style code blocks to HTML
                            const parsedContent = parseMarkdown(content);

                            // Debug the content
                            console.log('Updating message with content length:', content.length);

                            // Set the content
                            lastAssistantMessageElement.innerHTML = parsedContent;

                            // Remove typing indicator when the response is complete
                            if (content && content.trim() && lastAssistantHeaderElement) {
                                const typingIndicator = lastAssistantHeaderElement.querySelector('.typing-indicator');
                                if (typingIndicator) {
                                    typingIndicator.remove();
                                }
                            }

                            // Scroll to the bottom
                            chatContainer.scrollTop = chatContainer.scrollHeight;

                            // Reset waiting state if we have content
                            if (content && content.trim()) {
                                isWaitingForResponse = false;
                                sendButton.disabled = false;
                                messageInput.disabled = false;
                            }
                        } else {
                            console.warn('No assistant message element to update');
                        }
                    }

                    // Function to clear the chat
                    function clearChat() {
                        chatContainer.innerHTML =
                            '<div class="welcome-message" style="text-align: center; padding: 80px 20px; max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; height: calc(100vh - 200px); background-color: var(--vscode-editor-background);">' +
                            '<h3 style="color: var(--vscode-terminal-ansiGreen); margin-bottom: 20px; font-size: 1.4em;">Index Codebase</h3>' +
                            '<p style="margin-bottom: 12px; line-height: 1.5;">Indexing allows PraxCode to make tailored code suggestions and explain common practices or patterns.</p>' +
                            '<p style="margin-bottom: 30px; line-height: 1.5;">Your data always stays secure, private and anonymized.</p>' +
                            '<button id="index-codebase-button" style="background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; border-radius: 6px; font-weight: 500; min-width: 180px;">Index Codebase</button>' +
                            '</div>';

                        // Re-add event listener for the new button
                        const indexButton = document.getElementById('index-codebase-button');
                        if (indexButton) {
                            indexButton.addEventListener('click', indexCodebase);
                        }

                        lastAssistantMessageElement = null;
                        lastAssistantHeaderElement = null;
                        isWaitingForResponse = false;
                        sendButton.disabled = false;
                        messageInput.disabled = false;
                    }

                    // Function to index codebase
                    function indexCodebase() {
                        vscode.postMessage({
                            command: 'indexCodebase'
                        });

                        // Show indexing message
                        chatContainer.innerHTML =
                            '<div class="message assistant-message">' +
                            '<div class="message-header"><span>PraxCode</span></div>' +
                            '<div class="message-content">Indexing your codebase... This may take a few moments.</div>' +
                            '</div>';
                    }

                    // Function to set provider info
                    function setProviderInfo(provider) {
                        console.log('Provider info received:', provider);

                        // Re-enable the model dropdown if it was disabled
                        modelSelectElement.disabled = false;

                        // Update model dropdown if available models are provided
                        if (provider.availableModels && provider.availableModels.length > 0) {
                            // Clear existing options
                            modelSelectElement.innerHTML = '';

                            // Add available models
                            provider.availableModels.forEach(model => {
                                const option = document.createElement('option');
                                option.value = model;
                                option.textContent = model;

                                // Set current model as selected
                                if (model === provider.model) {
                                    option.selected = true;
                                }

                                modelSelectElement.appendChild(option);
                            });

                            // Log models loaded
                            console.log('Models loaded:', provider.availableModels);
                        } else if (provider.model) {
                            // If we have a model but no available models list,
                            // at least make sure the current model is in the dropdown
                            console.warn('No models list available, but current model is:', provider.model);

                            // Check if the current model is already in the dropdown
                            let modelExists = false;
                            for (let i = 0; i < modelSelectElement.options.length; i++) {
                                if (modelSelectElement.options[i].value === provider.model) {
                                    modelSelectElement.options[i].selected = true;
                                    modelExists = true;
                                    break;
                                }
                            }

                            // If not, add it
                            if (!modelExists) {
                                // Clear and add just the current model
                                modelSelectElement.innerHTML = '';
                                const option = document.createElement('option');
                                option.value = provider.model;
                                option.textContent = provider.model;
                                option.selected = true;
                                modelSelectElement.appendChild(option);
                            }
                        } else {
                            console.warn('No models available from provider:', provider);

                            // Add a default option
                            modelSelectElement.innerHTML = '<option value="default">default</option>';
                        }
                    }

                    // Function to change model
                    function changeModel() {
                        const selectedModel = modelSelectElement.value;
                        console.log('Changing model to:', selectedModel);

                        // Store current options in case we need to restore them
                        const currentOptions = Array.from(modelSelectElement.options).map(opt => ({
                            value: opt.value,
                            text: opt.text,
                            selected: opt.selected
                        }));

                        // Show loading state
                        modelSelectElement.disabled = true;

                        vscode.postMessage({
                            command: 'changeModel',
                            model: selectedModel
                        });

                        // Set a timeout to restore options if the server doesn't respond
                        setTimeout(() => {
                            if (modelSelectElement.disabled) {
                                console.warn('Model change taking too long, restoring options');
                                modelSelectElement.disabled = false;

                                // Only restore if we have just one option (likely the default fallback)
                                if (modelSelectElement.options.length <= 1) {
                                    // Restore previous options
                                    modelSelectElement.innerHTML = '';
                                    currentOptions.forEach(opt => {
                                        const option = document.createElement('option');
                                        option.value = opt.value;
                                        option.textContent = opt.text;
                                        option.selected = opt.selected;
                                        modelSelectElement.appendChild(option);
                                    });
                                }
                            }
                        }, 5000);
                    }

                    // Event listeners
                    sendButton.addEventListener('click', sendMessage);

                    messageInput.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            sendMessage();
                        }
                    });

                    // Clear button removed as per user request

                    // Add click handlers for example messages
                    chatContainer.addEventListener('click', (event) => {
                        const listItem = event.target.closest('li');
                        if (listItem && listItem.closest('.welcome-message')) {
                            messageInput.value = listItem.textContent.trim();
                            sendMessage();
                        }
                    });

                    // Add click handlers for agent mode buttons
                    agentModeOff.addEventListener('click', () => {
                        agentMode = 'off';
                        agentModeOff.classList.add('active');
                        agentModeAuto.classList.remove('active');
                        agentModeOff.style.display = 'inline-block';
                        agentModeAuto.style.display = 'none';
                    });

                    agentModeAuto.addEventListener('click', () => {
                        agentMode = 'auto';
                        agentModeAuto.classList.add('active');
                        agentModeOff.classList.remove('active');
                        agentModeAuto.style.display = 'inline-block';
                        agentModeOff.style.display = 'none';
                    });

                    // Add click handlers for MCP toggle buttons
                    mcpOff.addEventListener('click', () => {
                        useMCP = false;
                        mcpOff.classList.add('active');
                        mcpOn.classList.remove('active');
                        mcpOff.style.display = 'inline-block';
                        mcpOn.style.display = 'none';
                    });

                    mcpOn.addEventListener('click', () => {
                        useMCP = true;
                        mcpOn.classList.add('active');
                        mcpOff.classList.remove('active');
                        mcpOn.style.display = 'inline-block';
                        mcpOff.style.display = 'none';
                    });

                    // Initialize toggle button visibility
                    agentModeOff.style.display = 'none';
                    mcpOff.style.display = 'inline-block';
                    mcpOn.style.display = 'none';

                    // Add change handler for model dropdown
                    modelSelectElement.addEventListener('change', changeModel);

                    // Function to handle actionable items
                    function handleActionableItems(items) {
                        if (!lastAssistantMessageElement) {
                            console.warn('No assistant message element to add actionable items to');
                            return;
                        }

                        // Check if we already have an actionable items container
                        let actionableItemsContainer = lastAssistantMessageElement.querySelector('.actionable-items');

                        if (!actionableItemsContainer) {
                            // Create the container
                            actionableItemsContainer = document.createElement('div');
                            actionableItemsContainer.className = 'actionable-items';
                            lastAssistantMessageElement.appendChild(actionableItemsContainer);
                        } else {
                            // Clear existing items
                            actionableItemsContainer.innerHTML = '';
                        }

                        // Add code changes
                        if (items.codeChanges && items.codeChanges.length > 0) {
                            const codeChangesHeader = document.createElement('div');
                            codeChangesHeader.className = 'actionable-items-header';
                            codeChangesHeader.textContent = 'Suggested Code Changes:';
                            actionableItemsContainer.appendChild(codeChangesHeader);

                            items.codeChanges.forEach((codeChange, index) => {
                                const item = document.createElement('div');
                                item.className = 'actionable-item';

                                const header = document.createElement('div');
                                header.className = 'actionable-item-header';

                                const title = document.createElement('div');
                                title.className = 'actionable-item-title';
                                title.textContent = codeChange.filePath
                                    ? \`Code for \${codeChange.filePath}\`
                                    : \`Code Change \${index + 1}\`;
                                header.appendChild(title);

                                const actions = document.createElement('div');
                                actions.className = 'actionable-item-actions';

                                const applyButton = document.createElement('button');
                                applyButton.className = 'actionable-item-button';
                                applyButton.textContent = 'Apply';
                                applyButton.addEventListener('click', () => {
                                    console.log('PraxCode: Apply button clicked for code change', {
                                        filePath: codeChange.filePath,
                                        language: codeChange.language,
                                        codeLength: codeChange.newCode.length
                                    });

                                    const message = {
                                        command: 'applyCodeChange',
                                        codeChange: codeChange
                                    };

                                    console.log('PraxCode: Sending message to extension host:', message);
                                    vscode.postMessage(message);
                                });
                                actions.appendChild(applyButton);

                                header.appendChild(actions);
                                item.appendChild(header);

                                const content = document.createElement('div');
                                content.className = 'actionable-item-content';
                                content.textContent = codeChange.newCode;
                                item.appendChild(content);

                                actionableItemsContainer.appendChild(item);
                            });
                        }

                        // Add commands
                        if (items.commands && items.commands.length > 0) {
                            const commandsHeader = document.createElement('div');
                            commandsHeader.className = 'actionable-items-header';
                            commandsHeader.textContent = 'Suggested Commands:';
                            actionableItemsContainer.appendChild(commandsHeader);

                            items.commands.forEach((command) => {
                                const item = document.createElement('div');
                                item.className = 'actionable-item';

                                const header = document.createElement('div');
                                header.className = 'actionable-item-header';

                                const title = document.createElement('div');
                                title.className = 'actionable-item-title';
                                title.textContent = command.description
                                    ? \`Command to \${command.description}\`
                                    : 'Terminal Command';
                                header.appendChild(title);

                                const actions = document.createElement('div');
                                actions.className = 'actionable-item-actions';

                                const runButton = document.createElement('button');
                                runButton.className = 'actionable-item-button';
                                runButton.textContent = 'Run';
                                runButton.addEventListener('click', () => {
                                    console.log('PraxCode: Run button clicked for command', {
                                        command: command.command,
                                        description: command.description
                                    });

                                    const message = {
                                        command: 'runCommand',
                                        terminalCommand: command
                                    };

                                    console.log('PraxCode: Sending message to extension host:', message);
                                    vscode.postMessage(message);
                                });
                                actions.appendChild(runButton);

                                header.appendChild(actions);
                                item.appendChild(header);

                                const content = document.createElement('div');
                                content.className = 'actionable-item-content';
                                content.textContent = command.command;
                                item.appendChild(content);

                                actionableItemsContainer.appendChild(item);
                            });
                        }

                        // Scroll to the bottom
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    // Handle messages from the extension
                    window.addEventListener('message', (event) => {
                        const message = event.data;

                        switch (message.command) {
                            case 'addMessage':
                                addMessage(message.message);
                                break;
                            case 'updateMessage':
                                updateLastAssistantMessage(message.content);
                                break;
                            case 'clearChat':
                                clearChat();
                                break;
                            case 'setProviderInfo':
                                setProviderInfo(message.provider);
                                break;
                            case 'setActionableItems':
                                handleActionableItems(message.items);
                                break;
                        }
                    });

                    // Add event listener for index codebase button
                    const indexButton = document.getElementById('index-codebase-button');
                    if (indexButton) {
                        indexButton.addEventListener('click', indexCodebase);
                    }

                    // Request provider info on load
                    console.log('Requesting provider info...');
                    vscode.postMessage({
                        command: 'getProviderInfo'
                    });

                    // Add a fallback in case provider info doesn't load
                    setTimeout(() => {
                        if (modelSelectElement.innerHTML === '<option value="loading">Loading models...</option>') {
                            console.warn('Provider info not received after timeout, adding fallback option');
                            modelSelectElement.innerHTML = '<option value="default">default</option>';
                        }
                    }, 5000);
                })();
            </script>
        </body>
        </html>`;
    }
}
