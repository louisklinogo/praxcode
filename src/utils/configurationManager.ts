import * as vscode from 'vscode';
import { logger } from './logger';

/**
 * LLM Provider types supported by the extension
 */
export enum LLMProviderType {
    OLLAMA = 'ollama',
    OPENAI = 'openai',
    ANTHROPIC = 'anthropic',
    GOOGLE = 'google',
    OPENROUTER = 'openrouter',
    XAI = 'xai',
    CUSTOM = 'custom',
    NONE = 'none'
}

/**
 * Configuration interface for the extension
 */
export interface PraxCodeConfiguration {
    // LLM Provider settings
    llmProvider: LLMProviderType;

    // Ollama settings
    ollamaUrl: string;
    ollamaModel: string;

    // OpenAI settings
    openaiModel: string;

    // Anthropic settings
    anthropicModel: string;

    // Google settings
    googleModel: string;

    // OpenRouter settings
    openrouterModel: string;

    // x.ai settings
    xaiModel: string;

    // Custom provider settings
    customProviderUrl: string;
    customProviderModel: string;

    // Model Context Protocol settings
    mcpEnabled: boolean;
    mcpEndpointUrl: string;
    mcpEndpointModel: string;

    // Vector store settings
    vectorStoreEnabled: boolean;
    embeddingModel: string;

    // RAG settings
    ragOnlyModeEnabled: boolean;
    ragOnlyModeForceEnabled: boolean;
    ragMinRelevanceScore: number;

    // Indexing settings
    includePatterns: string[];
    excludePatterns: string[];
    autoReindexOnSave: boolean;

    // UI settings
    showStatusBarItem: boolean;

    // Code completion settings
    enableInlineCompletion: boolean;

    // Cache settings
    cacheEnabled: boolean;
    cacheTTL: number;

    // Logging settings
    logLevel: string;
}

/**
 * Configuration manager for the extension
 */
export class ConfigurationManager {
    private static instance: ConfigurationManager;
    private context: vscode.ExtensionContext;
    private secretStorage: vscode.SecretStorage;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.secretStorage = context.secrets;
    }

    /**
     * Get the configuration manager instance (singleton)
     * @param context The extension context
     */
    public static getInstance(context: vscode.ExtensionContext): ConfigurationManager {
        if (!ConfigurationManager.instance) {
            ConfigurationManager.instance = new ConfigurationManager(context);
        }
        return ConfigurationManager.instance;
    }

    /**
     * Get the configuration for the extension
     */
    public getConfiguration(): PraxCodeConfiguration {
        const config = vscode.workspace.getConfiguration('praxcode');

        return {
            // LLM Provider settings
            llmProvider: config.get<LLMProviderType>('llmProvider', LLMProviderType.OLLAMA),

            // Ollama settings
            ollamaUrl: config.get<string>('ollamaUrl', 'http://localhost:11434'),
            ollamaModel: config.get<string>('ollamaModel', 'llama3'),

            // OpenAI settings
            openaiModel: config.get<string>('openaiModel', 'gpt-3.5-turbo'),

            // Anthropic settings
            anthropicModel: config.get<string>('anthropicModel', 'claude-3-haiku-20240307'),

            // Google settings
            googleModel: config.get<string>('googleModel', 'gemini-pro'),

            // OpenRouter settings
            openrouterModel: config.get<string>('openrouterModel', 'openai/gpt-3.5-turbo'),

            // x.ai settings
            xaiModel: config.get<string>('xaiModel', 'grok-3'),

            // Custom provider settings
            customProviderUrl: config.get<string>('customProviderUrl', 'http://localhost:8000'),
            customProviderModel: config.get<string>('customProviderModel', 'default'),

            // Model Context Protocol settings
            mcpEnabled: config.get<boolean>('mcp.enabled', false),
            mcpEndpointUrl: config.get<string>('mcp.endpointUrl', 'http://localhost:8000'),
            mcpEndpointModel: config.get<string>('mcp.endpointModel', 'default'),

            // Vector store settings
            vectorStoreEnabled: config.get<boolean>('vectorStore.enabled', true),
            embeddingModel: config.get<string>('vectorStore.embeddingModel', 'nomic-embed-text'),

            // RAG settings
            ragOnlyModeEnabled: config.get<boolean>('rag.onlyModeEnabled', true),
            ragOnlyModeForceEnabled: config.get<boolean>('rag.onlyModeForceEnabled', false),
            ragMinRelevanceScore: config.get<number>('rag.minRelevanceScore', 0.3),

            // Indexing settings
            includePatterns: config.get<string[]>('indexing.includePatterns', ['**/*.{js,ts,jsx,tsx,py,java,c,cpp,cs,go,rb,php,html,css,md}']),
            excludePatterns: config.get<string[]>('indexing.excludePatterns', ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**']),
            autoReindexOnSave: config.get<boolean>('indexing.autoReindexOnSave', false),

            // UI settings
            showStatusBarItem: config.get<boolean>('ui.showStatusBarItem', true),

            // Code completion settings
            enableInlineCompletion: config.get<boolean>('codeCompletion.enableInlineCompletion', false),

            // Cache settings
            cacheEnabled: config.get<boolean>('cache.enabled', true),
            cacheTTL: config.get<number>('cache.ttl', 86400000), // 24 hours

            // Logging settings
            logLevel: config.get<string>('logging.logLevel', 'info')
        };
    }

    /**
     * Store a secret in the secret storage
     * @param key The key to store
     * @param value The value to store
     */
    public async storeSecret(key: string, value: string): Promise<void> {
        try {
            await this.secretStorage.store(key, value);
            logger.debug(`Secret stored: ${key}`);
        } catch (error) {
            logger.error(`Failed to store secret: ${key}`, error);
            throw error;
        }
    }

    /**
     * Get a secret from the secret storage
     * @param key The key to retrieve
     */
    public async getSecret(key: string): Promise<string | undefined> {
        try {
            return await this.secretStorage.get(key);
        } catch (error) {
            logger.error(`Failed to retrieve secret: ${key}`, error);
            throw error;
        }
    }

    /**
     * Delete a secret from the secret storage
     * @param key The key to delete
     */
    public async deleteSecret(key: string): Promise<void> {
        try {
            await this.secretStorage.delete(key);
            logger.debug(`Secret deleted: ${key}`);
        } catch (error) {
            logger.error(`Failed to delete secret: ${key}`, error);
            throw error;
        }
    }

    /**
     * Set a secret in the secret storage
     * @param key The key to store
     * @param value The value to store
     */
    public async setSecret(key: string, value: string): Promise<void> {
        try {
            await this.secretStorage.store(key, value);
            logger.debug(`Secret stored: ${key}`);
        } catch (error) {
            logger.error(`Failed to store secret: ${key}`, error);
            throw error;
        }
    }

    /**
     * Force reload the configuration from VS Code settings
     * This is useful when settings have been updated programmatically
     * and we need to ensure we have the latest values
     */
    public reloadConfiguration(): void {
        // VS Code's getConfiguration() always returns the latest values,
        // so we don't need to do anything special here.
        // Just log that we're reloading for debugging purposes.
        logger.debug('Reloading configuration from VS Code settings');
        const config = this.getConfiguration();
        logger.debug(`Current LLM provider: ${config.llmProvider}`);
    }
}
