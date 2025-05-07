// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import * as path from 'path';
import { logger, LogLevel } from './utils/logger';
import { ConfigurationManager, LLMProviderType } from './utils/configurationManager';
import { LLMServiceFactory } from './services/llm/llmServiceFactory';
import { ChatWebviewProvider } from './ui/chatWebviewProvider';
import { LanceDBAdapter } from './services/vectorstore/lanceDBAdapter';
import { EmbeddingService } from './services/embedding/embeddingService';
import { IndexingService } from './services/indexing/indexingService';
import { RAGOrchestrator } from './services/rag/ragOrchestrator';
import { ExplainCodeCommand } from './commands/explainCodeCommand';
import { GenerateDocsCommand } from './commands/generateDocsCommand';
import { GenerateTestsCommand } from './commands/generateTestsCommand';
import { RefactorCodeCommand } from './commands/refactorCodeCommand';
import { GenerateCommitMessageCommand } from './commands/generateCommitMessageCommand';
import { ToggleMCPCommand } from './commands/toggleMCPCommand';
import { ChatPanel } from './ui/chatPanel';
import { InlineCompletionProvider } from './features/inlineCompletion/inlineCompletionProvider';
import { CacheService } from './services/cache/cacheService';
import { ActionExecutionService } from './services/action/actionExecutionService';
import { ModelContextProtocolService } from './services/mcp/modelContextProtocolService';
import { MCPActionHandler } from './services/action/mcpActionHandler';

/**
 * This method is called when the extension is activated
 * @param context The extension context
 */
export async function activate(context: vscode.ExtensionContext) {
    // Initialize the configuration manager
    const configManager = ConfigurationManager.getInstance(context);
    const config = configManager.getConfiguration();

    // Set up logging
    const logLevelMap: Record<string, LogLevel> = {
        'debug': LogLevel.DEBUG,
        'info': LogLevel.INFO,
        'warn': LogLevel.WARN,
        'error': LogLevel.ERROR
    };

    logger.setLogLevel(logLevelMap[config.logLevel] || LogLevel.INFO);
    logger.info('PraxCode extension is now active!');
    logger.debug('Configuration loaded', config);

    // Initialize LLM service factory
    const llmServiceFactory = LLMServiceFactory.getInstance(configManager);

    // Initialize vector store and indexing services
    const storageDir = path.join(context.globalStorageUri.fsPath, 'vectorstore');
    logger.info(`Initializing vector store at path: ${storageDir}`);

    // Ensure the directory exists
    try {
        const fs = require('fs');
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
            logger.info(`Created vector store directory at ${storageDir}`);
        } else {
            logger.info(`Vector store directory already exists at ${storageDir}`);
        }
    } catch (dirError) {
        logger.error(`Failed to create vector store directory: ${storageDir}`, dirError);
    }

    const vectorStore = new LanceDBAdapter(storageDir);
    logger.info('Vector store adapter created');

    // Initialize the cache service
    const cacheService = CacheService.getInstance(context);
    logger.info('Cache service initialized');

    const embeddingService = new EmbeddingService(configManager, cacheService);
    embeddingService.setCacheEnabled(config.cacheEnabled);
    embeddingService.setCacheTTL(config.cacheTTL);
    logger.info(`Embedding service created with cache ${config.cacheEnabled ? 'enabled' : 'disabled'}`);

    const indexingService = new IndexingService(configManager, vectorStore, embeddingService);
    logger.info('Indexing service created');

    // Initialize the indexing service
    try {
        await indexingService.initialize();
        logger.info('Vector store initialized successfully');

        // Check if we have any documents
        const documentCount = await vectorStore.getDocumentCount();
        logger.info(`Vector store contains ${documentCount} documents after initialization`);
    } catch (error) {
        logger.error('Failed to initialize vector store', error);
        vscode.window.showErrorMessage('Failed to initialize vector store. Some features may not work correctly.');
    }

    // Register commands
    const helloWorldCommand = vscode.commands.registerCommand('praxcode.helloWorld', () => {
        logger.info('Hello World command executed');
        vscode.window.showInformationMessage('Hello from PraxCode!');
    });

    // Register show menu command
    const showMenuCommand = vscode.commands.registerCommand('praxcode.showMenu', async () => {
        logger.info('Show menu command executed');

        // Create quick pick items
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(rocket) Index Workspace',
                description: 'Index your workspace for context-aware responses',
                detail: 'Scans and indexes your code files for better AI assistance'
            },
            {
                label: '$(settings-gear) Settings',
                description: 'Configure PraxCode settings',
                detail: 'Change LLM provider, models, and other options'
            },
            {
                label: '$(info) About',
                description: 'About PraxCode',
                detail: 'Information about the extension'
            }
        ];

        // Show quick pick
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an action',
            title: 'PraxCode Menu'
        });

        // Handle selection
        if (selected) {
            if (selected.label.includes('Index Workspace')) {
                vscode.commands.executeCommand('praxcode.indexWorkspace');
            } else if (selected.label.includes('Settings')) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'praxcode');
            } else if (selected.label.includes('About')) {
                vscode.window.showInformationMessage(
                    'PraxCode: A flexible and context-aware AI code assistant for VS Code',
                    'View Documentation'
                ).then(selection => {
                    if (selection === 'View Documentation') {
                        vscode.env.openExternal(vscode.Uri.parse('https://github.com/yourusername/praxcode'));
                    }
                });
            }
        }
    });

    // Register indexing command
    const indexWorkspaceCommand = vscode.commands.registerCommand('praxcode.indexWorkspace', async () => {
        if (indexingService.isIndexingInProgress()) {
            vscode.window.showInformationMessage('Indexing is already in progress');
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'PraxCode: Indexing Workspace',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Starting indexing...' });
                    await indexingService.indexWorkspace(progress);

                    const count = await indexingService.getDocumentCount();
                    vscode.window.showInformationMessage(`Indexing completed. ${count} documents indexed.`);
                }
            );
        } catch (error) {
            logger.error('Failed to index workspace', error);
            vscode.window.showErrorMessage(`Failed to index workspace: ${error}`);
        }
    });

    // Register explain code command
    const explainCodeCommand = vscode.commands.registerCommand('praxcode.explainCode', async () => {
        try {
            // Get the LLM service
            const llmService = await llmServiceFactory.getService();

            // Create RAG orchestrator
            const ragOrchestrator = new RAGOrchestrator(
                vectorStore,
                embeddingService,
                llmService,
                configManager
            );

            // Create and execute the explain code command
            const command = new ExplainCodeCommand(ragOrchestrator);
            await command.execute();
        } catch (error) {
            logger.error('Failed to execute explain code command', error);
            vscode.window.showErrorMessage(`Failed to explain code: ${error}`);
        }
    });

    // Register generate docs command
    const generateDocsCommand = vscode.commands.registerCommand('praxcode.generateDocs', async () => {
        try {
            // Get the LLM service
            const llmService = await llmServiceFactory.getService();

            // Create RAG orchestrator
            const ragOrchestrator = new RAGOrchestrator(
                vectorStore,
                embeddingService,
                llmService,
                configManager
            );

            // Create and execute the generate docs command
            const command = new GenerateDocsCommand(ragOrchestrator);
            await command.execute();
        } catch (error) {
            logger.error('Failed to execute generate docs command', error);
            vscode.window.showErrorMessage(`Failed to generate documentation: ${error}`);
        }
    });

    // Register generate tests command
    const generateTestsCommand = vscode.commands.registerCommand('praxcode.generateTests', async () => {
        try {
            // Get the LLM service
            const llmService = await llmServiceFactory.getService();

            // Create RAG orchestrator
            const ragOrchestrator = new RAGOrchestrator(
                vectorStore,
                embeddingService,
                llmService,
                configManager
            );

            // Create and execute the generate tests command
            const command = new GenerateTestsCommand(ragOrchestrator);
            await command.execute();
        } catch (error) {
            logger.error('Failed to execute generate tests command', error);
            vscode.window.showErrorMessage(`Failed to generate tests: ${error}`);
        }
    });

    // Register refactor code command
    const refactorCodeCommand = vscode.commands.registerCommand('praxcode.refactorCode', async () => {
        try {
            // Get the LLM service
            const llmService = await llmServiceFactory.getService();

            // Create RAG orchestrator
            const ragOrchestrator = new RAGOrchestrator(
                vectorStore,
                embeddingService,
                llmService,
                configManager
            );

            // Create and execute the refactor code command
            const command = new RefactorCodeCommand(ragOrchestrator);
            await command.execute();
        } catch (error) {
            logger.error('Failed to execute refactor code command', error);
            vscode.window.showErrorMessage(`Failed to refactor code: ${error}`);
        }
    });

    // Register generate commit message command
    const generateCommitMessageCommand = vscode.commands.registerCommand('praxcode.generateCommitMessage', async () => {
        try {
            // Create and execute the generate commit message command
            const command = new GenerateCommitMessageCommand(llmServiceFactory);
            await command.execute();
        } catch (error) {
            logger.error('Failed to execute generate commit message command', error);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${error}`);
        }
    });

    // Register toggle MCP command
    const toggleMCPCommand = new ToggleMCPCommand(configManager);
    toggleMCPCommand.register(context);

    // Register open chat panel command
    const openChatPanelCommand = vscode.commands.registerCommand('praxcode.openChatPanel', () => {
        try {
            logger.info('Open chat panel command executed');
            // Initialize the chat panel with required dependencies
            ChatPanel.initialize(
                context.extensionUri,
                configManager,
                llmServiceFactory,
                vectorStore,
                embeddingService
            );
            // Create or show the chat panel
            ChatPanel.createOrShow();
        } catch (error) {
            logger.error('Failed to execute open chat panel command', error);
            vscode.window.showErrorMessage(`Failed to open chat panel: ${error}`);
        }
    });

    // Register the chat webview provider
    const chatWebviewProvider = new ChatWebviewProvider(
        context.extensionUri,
        configManager,
        llmServiceFactory,
        vectorStore,
        embeddingService
    );

    // Register the chat view provider for the explorer (secondary sidebar)
    const sidebarChatViewRegistration = vscode.window.registerWebviewViewProvider(
        ChatWebviewProvider.sidebarChatViewType,
        chatWebviewProvider
    );

    // Register inline completion provider if enabled
    let inlineCompletionRegistration: vscode.Disposable | undefined;
    if (config.enableInlineCompletion) {
        const inlineCompletionProvider = new InlineCompletionProvider(llmServiceFactory, configManager);
        inlineCompletionRegistration = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' }, // All files
            inlineCompletionProvider
        );
        logger.info('Inline completion provider registered');
    }

    // Status bar item disabled as per user request
    let statusBarItem: vscode.StatusBarItem | undefined;
    // Status bar item is disabled to avoid duplicate chat windows
    logger.debug('Status bar item disabled as per user request');

    // Listen for configuration changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('praxcode')) {
            logger.info('PraxCode configuration changed, updating services');

            // Get the new configuration
            const newConfig = configManager.getConfiguration();

            // Update log level
            const logLevelMap: Record<string, LogLevel> = {
                'debug': LogLevel.DEBUG,
                'info': LogLevel.INFO,
                'warn': LogLevel.WARN,
                'error': LogLevel.ERROR
            };
            logger.setLogLevel(logLevelMap[newConfig.logLevel] || LogLevel.INFO);

            // Update LLM service
            llmServiceFactory.resetService();

            // Update indexing service
            indexingService.updateConfiguration();

            // Update embedding service cache settings
            embeddingService.setCacheEnabled(newConfig.cacheEnabled);
            embeddingService.setCacheTTL(newConfig.cacheTTL);

            // Status bar item is disabled
            // No need to update it

            logger.info('Services updated with new configuration');
        }
    });

    // Add all disposables to the context subscriptions
    context.subscriptions.push(
        helloWorldCommand,
        showMenuCommand,
        indexWorkspaceCommand,
        explainCodeCommand,
        generateDocsCommand,
        generateTestsCommand,
        refactorCodeCommand,
        generateCommitMessageCommand,
        openChatPanelCommand,
        sidebarChatViewRegistration,
        configChangeListener,
        { dispose: () => logger.dispose() },
        { dispose: () => indexingService.dispose() },
        { dispose: () => cacheService.dispose() },
        { dispose: () => ActionExecutionService.dispose() },
        { dispose: () => ModelContextProtocolService.getInstance().dispose() },
        { dispose: () => MCPActionHandler.getInstance().dispose() },
        { dispose: async () => await vectorStore.close() }
    );

    if (statusBarItem) {
        context.subscriptions.push(statusBarItem);
    }

    if (inlineCompletionRegistration) {
        context.subscriptions.push(inlineCompletionRegistration);
    }

    logger.info('PraxCode extension activated successfully');
}

/**
 * This method is called when the extension is deactivated
 */
export function deactivate() {
    logger.info('PraxCode extension is being deactivated');
}
