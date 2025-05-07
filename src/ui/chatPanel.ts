import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { LLMServiceFactory } from '../services/llm/llmServiceFactory';
import { ConfigurationManager } from '../utils/configurationManager';
import { VectorStoreService } from '../services/vectorstore/vectorStoreService';
import { EmbeddingService } from '../services/embedding/embeddingService';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';
import { ChatMessage } from '../services/llm/llmService';
import { diffFormatPrompt } from '../prompts/diffFormatPrompt';

/**
 * Chat Panel for PraxCode
 */
export class ChatPanel {
    public static readonly viewType = 'praxcode.chatPanel';

    private static _panel: vscode.WebviewPanel | undefined;
    private static _extensionUri: vscode.Uri;
    private static _configManager: ConfigurationManager;
    private static _llmServiceFactory: LLMServiceFactory;
    private static _currentSessionModel: string | null = null;
    private static _vectorStore: VectorStoreService;
    private static _embeddingService: EmbeddingService;
    private static _ragOrchestrator: RAGOrchestrator | null = null;

    /**
     * Initialize the chat panel
     * @param extensionUri The extension URI
     * @param configManager The configuration manager
     * @param llmServiceFactory The LLM service factory
     * @param vectorStore The vector store service
     * @param embeddingService The embedding service
     */
    public static initialize(
        extensionUri: vscode.Uri,
        configManager: ConfigurationManager,
        llmServiceFactory: LLMServiceFactory,
        vectorStore: VectorStoreService,
        embeddingService: EmbeddingService
    ): void {
        this._extensionUri = extensionUri;
        this._configManager = configManager;
        this._llmServiceFactory = llmServiceFactory;
        this._vectorStore = vectorStore;
        this._embeddingService = embeddingService;
    }

    /**
     * Create or show the chat panel
     */
    public static createOrShow(): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (this._panel) {
            this._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        this._panel = vscode.window.createWebviewPanel(
            this.viewType,
            'PraxCode Chat',
            column || vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        // Set the webview's html content
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await this._handleSendMessage(message.text, message.agentMode);
                    break;
                case 'clearChat':
                    this._handleClearChat();
                    break;
                case 'getProviderInfo':
                    await this._handleGetProviderInfo();
                    break;
                case 'changeModel':
                    await this._handleChangeModel(message.model);
                    break;
                case 'attachFile':
                    await this._handleAttachFile();
                    break;
            }
        });

        // Reset when the panel is disposed
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        }, null, []);

        // Send initial provider info
        this._handleGetProviderInfo();
    }

    /**
     * Handle sending a message
     * @param text The message text
     * @param agentMode The agent mode (auto or off)
     */
    private static async _handleSendMessage(text: string, agentMode: string = 'auto'): Promise<void> {
        if (!this._panel) {
            return;
        }

        try {
            // Add user message to UI
            this._panel.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'user',
                    content: text
                }
            });

            // Add initial assistant message
            this._panel.webview.postMessage({
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
            logger.info(`Agent mode: ${agentMode}`);

            // Debug the vector store path
            if (this._vectorStore instanceof Object && 'dbPath' in this._vectorStore) {
                logger.info(`Vector store path: ${(this._vectorStore as any).dbPath}`);
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

Always explain what you're doing and why. Be thorough but concise.`;
            }

            // Use RAG if vector store is enabled and has documents
            if (config.vectorStoreEnabled && documentCount > 0) {
                logger.info(`Using RAG for query: "${text.substring(0, 50)}..."`);

                // Initialize RAG orchestrator if needed
                if (!this._ragOrchestrator) {
                    const llmService = await this._llmServiceFactory.getService();
                    this._ragOrchestrator = new RAGOrchestrator(
                        this._vectorStore,
                        this._embeddingService,
                        llmService,
                        this._configManager
                    );
                    logger.info('RAG orchestrator initialized');
                }

                // Stream the response using RAG
                await this._ragOrchestrator.streamQuery(
                    text,
                    (content, done) => {
                        // Update the message content
                        this._panel?.webview.postMessage({
                            command: 'updateMessage',
                            content: content
                        });

                        // Log the content for debugging
                        if (done) {
                            logger.info('RAG response completed', { contentLength: content.length });
                        }
                    },
                    {
                        systemPrompt: systemMessage
                    }
                );

                logger.info('RAG chat response completed');
            } else {
                logger.info(`Falling back to direct LLM service. Vector store has ${documentCount} documents.`);

                // Fallback to direct LLM service if RAG is not available
                const llmService = await this._llmServiceFactory.getService();

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
                logger.debug('Starting direct LLM request to Ollama');

                // Stream the response
                await llmService.streamChat(
                    messages,
                    (response) => {
                        // Update the message content
                        this._panel?.webview.postMessage({
                            command: 'updateMessage',
                            content: response.content
                        });

                        // Log the content for debugging
                        if (response.done) {
                            logger.debug('Direct response completed', { contentLength: response.content.length });
                        }
                    }
                );

                logger.debug('Direct chat response completed');
            }
        } catch (error) {
            logger.error('Error sending message', error);

            // Show error in chat
            this._panel.webview.postMessage({
                command: 'updateMessage',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /**
     * Handle clearing the chat
     */
    private static _handleClearChat(): void {
        if (!this._panel) {
            return;
        }

        this._panel.webview.postMessage({
            command: 'clearChat'
        });
    }

    /**
     * Handle getting provider info
     */
    private static async _handleGetProviderInfo(): Promise<void> {
        if (!this._panel) {
            return;
        }

        try {
            const llmService = await this._llmServiceFactory.getService();
            const config = this._configManager.getConfiguration();

            // Try to get available models
            let availableModels: string[] = [];
            try {
                availableModels = await llmService.getAvailableModels();
            } catch (error) {
                logger.warn('Could not fetch available models', error);
                // Continue even if we can't get models
            }

            // Get the current model - use session model if available
            let currentModel = '';

            if (this._currentSessionModel) {
                // Use the session model if we have one
                currentModel = this._currentSessionModel;
                logger.info(`Using session model: ${currentModel}`);
            } else {
                // Otherwise get from config based on provider type
                switch (config.llmProvider) {
                    case 'ollama':
                        currentModel = config.ollamaModel;
                        break;
                    case 'openai':
                        currentModel = config.openaiModel;
                        break;
                    case 'anthropic':
                        currentModel = config.anthropicModel;
                        break;
                    case 'google':
                        currentModel = config.googleModel;
                        break;
                    case 'openrouter':
                        currentModel = config.openrouterModel;
                        break;
                    case 'custom':
                        currentModel = config.customProviderModel;
                        break;
                    default:
                        currentModel = 'default';
                }
            }

            this._panel.webview.postMessage({
                command: 'setProviderInfo',
                provider: {
                    name: llmService.getName(),
                    model: currentModel,
                    availableModels: availableModels
                }
            });
        } catch (error) {
            logger.error('Error getting provider info', error);
        }
    }

    /**
     * Handle attaching a file
     */
    private static async _handleAttachFile(): Promise<void> {
        if (!this._panel) {
            return;
        }

        try {
            // Show file picker
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Attach File'
            });

            if (fileUri && fileUri.length > 0) {
                const filePath = fileUri[0].fsPath;

                // Send the file path back to the webview
                this._panel.webview.postMessage({
                    command: 'fileAttached',
                    filePath: filePath
                });

                logger.info(`File attached: ${filePath}`);
            }
        } catch (error) {
            logger.error('Error attaching file', error);
        }
    }

    /**
     * Handle changing the model
     * @param model The model to change to
     */
    private static async _handleChangeModel(model: string): Promise<void> {
        if (!this._panel) {
            return;
        }

        try {
            // Update the configuration
            const config = this._configManager.getConfiguration();

            // Update the appropriate model setting based on provider type
            const settingKey = `${config.llmProvider}Model`;

            // We need to update the VS Code settings
            // Use ConfigurationTarget.Workspace instead of Global to avoid file save dialog
            try {
                await vscode.workspace.getConfiguration('praxcode').update(settingKey, model, vscode.ConfigurationTarget.Workspace);
                logger.info(`Updated model setting ${settingKey} to ${model} at workspace level`);
            } catch (configError) {
                logger.warn(`Failed to update at workspace level, falling back to memory-only: ${configError}`);
                // If workspace update fails, we'll just keep the setting in memory for this session
                // This avoids the file save dialog but won't persist the setting between sessions
            }

            // Store the model in memory for this session
            this._currentSessionModel = model;
            logger.info(`Using model ${model} for current session`);

            // Reset the LLM service to use the new model
            this._llmServiceFactory.resetService();

            // Update the UI
            this._panel.webview.postMessage({
                command: 'setProviderInfo',
                provider: {
                    name: config.llmProvider,
                    model: model
                }
            });

            // Show a confirmation message
            this._panel.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Model changed to ${model}. You can now start a new conversation.`
                }
            });
        } catch (error) {
            logger.error('Error changing model', error);

            // Show error in chat
            this._panel.webview.postMessage({
                command: 'addMessage',
                message: {
                    role: 'assistant',
                    content: `Error: Failed to change model: ${error instanceof Error ? error.message : String(error)}`
                }
            });
        }
    }

    /**
     * Get the HTML for the webview
     * @param webview The webview
     */
    private static _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PraxCode Chat</title>
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

                .header {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background-color: var(--vscode-sideBar-background);
                }

                .title {
                    font-size: 1.1em;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                }

                .title::before {
                    content: '$(comment-discussion)';
                    font-family: 'codicon';
                    margin-right: 8px;
                    font-size: 16px;
                }

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
                    background-color: var(--vscode-sideBar-background);
                }

                .input-container {
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    background-color: var(--vscode-sideBar-background);
                }

                .input-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 8px;
                    width: 100%;
                }

                .input-actions {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    width: 100%;
                    padding: 4px 0;
                }

                .input-left-actions {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                }

                .input-right-actions {
                    display: flex;
                    align-items: center;
                }

                .model-selector {
                    display: flex;
                    align-items: center;
                    font-size: 0.85em;
                    margin-right: 8px;
                    height: 24px;
                }

                .model-dropdown {
                    background-color: var(--vscode-dropdown-background);
                    color: var(--vscode-dropdown-foreground);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 3px;
                    padding: 2px 6px;
                    font-size: 0.9em;
                    cursor: pointer;
                    margin-left: 4px;
                    height: 24px;
                }

                .model-dropdown:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }

                .agent-mode-selector {
                    display: flex;
                    align-items: center;
                    margin-right: 8px;
                    height: 24px;
                }

                .agent-mode-label {
                    margin-right: 4px;
                    font-size: 0.85em;
                }

                .agent-mode-options {
                    display: flex;
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 3px;
                    overflow: hidden;
                    height: 24px;
                }

                .agent-mode-option {
                    padding: 2px 8px;
                    font-size: 0.85em;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    cursor: pointer;
                    height: 100%;
                    display: flex;
                    align-items: center;
                }

                .agent-mode-option.active {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }

                .agent-mode-option:hover:not(.active) {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }

                .attachment-button {
                    background: none;
                    border: none;
                    color: var(--vscode-foreground);
                    opacity: 0.7;
                    cursor: pointer;
                    padding: 2px 6px;
                    border-radius: 3px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    margin-right: 8px;
                    height: 24px;
                }

                .attachment-button::before {
                    content: '$(paperclip)';
                    font-family: 'codicon';
                    font-size: 14px;
                }

                .attachment-button:hover {
                    opacity: 1;
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }

                #message-input {
                    flex: 1;
                    padding: 8px 10px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 4px;
                    resize: none;
                    min-height: 50px;
                    max-height: 150px;
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    line-height: 1.5;
                    transition: border-color 0.2s;
                }

                #message-input:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }

                #send-button {
                    margin-left: 8px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 0 12px;
                    height: 28px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-weight: 500;
                    font-size: 0.9em;
                    transition: background-color 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                #send-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
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
            <div class="header">
                <div class="title">PraxCode Chat</div>
                <button class="clear-button" id="clear-button">Clear Chat</button>
            </div>

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
                        <textarea id="message-input" placeholder="Type your message here..." rows="3"></textarea>
                    </div>
                    <div class="input-actions">
                        <div class="input-left-actions">
                            <button class="attachment-button" id="attachment-button" title="Attach file"></button>

                            <div class="model-selector">
                                <span>Model:</span>
                                <select id="model-select" class="model-dropdown">
                                    <option value="loading">Loading models...</option>
                                </select>
                            </div>

                            <div class="agent-mode-selector">
                                <span class="agent-mode-label">Agent mode:</span>
                                <div class="agent-mode-options">
                                    <button class="agent-mode-option" id="agent-mode-off" data-mode="off">Off</button>
                                    <button class="agent-mode-option active" id="agent-mode-auto" data-mode="auto">Auto</button>
                                </div>
                            </div>
                        </div>
                        <div class="input-right-actions">
                            <button id="send-button">Send</button>
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
                    const clearButton = document.getElementById('clear-button');
                    const attachmentButton = document.getElementById('attachment-button');
                    const modelSelectElement = document.getElementById('model-select');
                    const agentModeOff = document.getElementById('agent-mode-off');
                    const agentModeAuto = document.getElementById('agent-mode-auto');

                    // Keep track of the last assistant message for updating
                    let lastAssistantMessageElement = null;
                    let lastAssistantHeaderElement = null;
                    let isWaitingForResponse = false;
                    let agentMode = 'auto'; // Default to auto

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
                                agentMode: agentMode
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
                            indexButton.addEventListener('click', () => {
                                // Show indexing message
                                chatContainer.innerHTML =
                                    '<div class="message assistant-message">' +
                                    '<div class="message-header"><span>PraxCode</span></div>' +
                                    '<div class="message-content">Indexing your codebase... This may take a few moments.</div>' +
                                    '</div>';

                                // You can add actual indexing functionality here when needed
                            });
                        }

                        lastAssistantMessageElement = null;
                        lastAssistantHeaderElement = null;
                        isWaitingForResponse = false;
                        sendButton.disabled = false;
                        messageInput.disabled = false;
                    }

                    // Function to set provider info
                    function setProviderInfo(provider) {
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
                        }
                    }

                    // Function to change model
                    function changeModel() {
                        const selectedModel = modelSelectElement.value;

                        vscode.postMessage({
                            command: 'changeModel',
                            model: selectedModel
                        });
                    }

                    // Event listeners
                    sendButton.addEventListener('click', sendMessage);

                    messageInput.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            sendMessage();
                        }
                    });

                    clearButton.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'clearChat'
                        });
                    });

                    // Add click handlers for example messages
                    chatContainer.addEventListener('click', (event) => {
                        const listItem = event.target.closest('li');
                        if (listItem && listItem.closest('.welcome-message')) {
                            messageInput.value = listItem.textContent.trim();
                            sendMessage();
                        }
                    });

                    // Add change handler for model dropdown
                    modelSelectElement.addEventListener('change', changeModel);

                    // Add click handlers for agent mode buttons
                    agentModeOff.addEventListener('click', () => {
                        agentMode = 'off';
                        agentModeOff.classList.add('active');
                        agentModeAuto.classList.remove('active');
                    });

                    agentModeAuto.addEventListener('click', () => {
                        agentMode = 'auto';
                        agentModeAuto.classList.add('active');
                        agentModeOff.classList.remove('active');
                    });

                    // Add click handler for attachment button
                    attachmentButton.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'attachFile'
                        });
                    });

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
                            case 'fileAttached':
                                // Add the file path to the input
                                messageInput.value += "\n[Attached file: " + message.filePath + "]";
                                messageInput.focus();
                                break;
                        }
                    });

                    // Add event listener for index codebase button
                    const indexButton = document.getElementById('index-codebase-button');
                    if (indexButton) {
                        indexButton.addEventListener('click', () => {
                            // Show indexing message
                            chatContainer.innerHTML =
                                '<div class="message assistant-message">' +
                                '<div class="message-header"><span>PraxCode</span></div>' +
                                '<div class="message-content">Indexing your codebase... This may take a few moments.</div>' +
                                '</div>';

                            // You can add actual indexing functionality here when needed
                        });
                    }

                    // Request provider info on load
                    vscode.postMessage({
                        command: 'getProviderInfo'
                    });
                })();
            </script>
        </body>
        </html>`;
    }
}
