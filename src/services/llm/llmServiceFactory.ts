import { LLMService } from './llmService';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GoogleProvider } from './googleProvider';
import { OpenRouterProvider } from './openRouterProvider';
import { CustomProvider } from './customProvider';
import { MCPProvider } from './mcpProvider';
import { RAGOnlyProvider } from './ragOnlyProvider';
import { ConfigurationManager, LLMProviderType } from '../../utils/configurationManager';
import { logger } from '../../utils/logger';
import * as vscode from 'vscode';

/**
 * Factory class for creating LLM service instances
 */
export class LLMServiceFactory {
    private static instance: LLMServiceFactory;
    private configManager: ConfigurationManager;
    private activeService: LLMService | null = null;

    private constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
    }

    /**
     * Get the factory instance (singleton)
     * @param configManager The configuration manager
     */
    public static getInstance(configManager: ConfigurationManager): LLMServiceFactory {
        if (!LLMServiceFactory.instance) {
            LLMServiceFactory.instance = new LLMServiceFactory(configManager);
        }
        return LLMServiceFactory.instance;
    }

    /**
     * Get the active LLM service
     */
    public async getService(): Promise<LLMService> {
        if (!this.activeService) {
            logger.debug('No active LLM service, creating a new one');
            this.activeService = await this.createService();
            logger.debug(`Created new LLM service: ${this.activeService.getName()}`);
        } else {
            logger.debug(`Using existing LLM service: ${this.activeService.getName()}`);

            // Check if the service is still valid for the current configuration
            const config = this.configManager.getConfiguration();
            logger.debug(`Current configuration: provider=${config.llmProvider}, ollamaModel=${config.ollamaModel}`);

            // If the service is a RAG-Only provider but the config is set to Ollama, recreate it
            if (this.activeService.getName() === 'RAG-Only Mode' && config.llmProvider === 'ollama') {
                logger.debug('Service is RAG-Only but config is set to Ollama, recreating service');
                this.activeService = await this.createService();
                logger.debug(`Created new LLM service: ${this.activeService.getName()}`);
            }
        }
        return this.activeService;
    }

    /**
     * Prompt the user for an API key
     * @param provider The provider name
     * @param secretKey The secret key to store the API key under
     * @returns A promise that resolves to the API key or undefined if the user cancels
     */
    private async promptForApiKey(provider: string, secretKey: string): Promise<string | undefined> {
        const result = await vscode.window.showInputBox({
            prompt: `Please enter your ${provider} API key`,
            password: true,
            ignoreFocusOut: true,
            placeHolder: `Enter your ${provider} API key here...`,
            title: `${provider} API Key Required`
        });

        if (result) {
            // Store the API key in secret storage
            await this.configManager.setSecret(secretKey, result);
            return result;
        }

        return undefined;
    }

    /**
     * Create a new LLM service based on configuration
     */
    public async createService(): Promise<LLMService> {
        // Force reload configuration to ensure we have the latest values
        this.configManager.reloadConfiguration();
        const config = this.configManager.getConfiguration();

        logger.debug(`Creating LLM service with provider: ${config.llmProvider}`);

        // Check if RAG-only mode is forced
        if (config.llmProvider === LLMProviderType.NONE || config.ragOnlyModeForceEnabled) {
            logger.info('Creating RAG-Only provider (no LLM will be used)');
            logger.debug(`RAG-only mode reason: provider=${config.llmProvider}, ragOnlyModeForceEnabled=${config.ragOnlyModeForceEnabled}`);
            return new RAGOnlyProvider();
        }

        // Log the current configuration
        logger.debug(`LLM provider: ${config.llmProvider}`);
        logger.debug(`Ollama settings: url=${config.ollamaUrl}, model=${config.ollamaModel}`);
        logger.debug(`RAG settings: enabled=${config.ragOnlyModeEnabled}, forced=${config.ragOnlyModeForceEnabled}`);

        // Check if MCP is enabled and create an MCP provider if so
        if (config.mcpEnabled) {
            // For Ollama with MCP, we don't need an API key
            if (config.llmProvider === LLMProviderType.OLLAMA) {
                logger.info(`Creating MCP provider for Ollama with URL: ${config.mcpEndpointUrl} and model: ${config.mcpEndpointModel}`);
                return new MCPProvider(null, config.mcpEndpointModel, config.mcpEndpointUrl);
            } else {
                // For other providers, we still need an API key
                let mcpApiKey = await this.configManager.getSecret('mcp.apiKey');
                if (!mcpApiKey) {
                    logger.warn('MCP API key not found in secret storage, prompting user');
                    mcpApiKey = await this.promptForApiKey('MCP', 'mcp.apiKey');

                    if (!mcpApiKey) {
                        logger.info('User cancelled MCP API key input, falling back to RAG-Only mode');
                        return new RAGOnlyProvider();
                    }
                }
                logger.info(`Creating MCP provider with URL: ${config.mcpEndpointUrl} and model: ${config.mcpEndpointModel}`);
                return new MCPProvider(mcpApiKey, config.mcpEndpointModel, config.mcpEndpointUrl);
            }
        }

        // Otherwise, create a provider based on the selected LLM provider
        switch (config.llmProvider) {
            case LLMProviderType.OLLAMA:
                logger.info(`Creating Ollama provider with URL: ${config.ollamaUrl} and model: ${config.ollamaModel}`);
                try {
                    // Create the Ollama provider without checking availability first
                    // This allows users to select Ollama models even if Ollama isn't currently running
                    // The provider will handle connection errors gracefully when used
                    return new OllamaProvider(config.ollamaUrl, config.ollamaModel);
                } catch (error) {
                    // Log the error but don't fall back to RAG-only mode
                    // This allows the user to start Ollama later without having to change the model again
                    logger.error(`Error creating Ollama provider: ${error instanceof Error ? error.message : String(error)}`);
                    logger.info('Continuing with Ollama provider despite error');
                    return new OllamaProvider(config.ollamaUrl, config.ollamaModel);
                }

            case LLMProviderType.OPENAI:
                let openaiApiKey = await this.configManager.getSecret('openai.apiKey');
                if (!openaiApiKey) {
                    logger.warn('OpenAI API key not found in secret storage, prompting user');
                    openaiApiKey = await this.promptForApiKey('OpenAI', 'openai.apiKey');

                    if (!openaiApiKey) {
                        logger.info('User cancelled OpenAI API key input, falling back to RAG-Only mode');
                        return new RAGOnlyProvider();
                    }
                }
                logger.info(`Creating OpenAI provider with model: ${config.openaiModel}`);
                return new OpenAIProvider(openaiApiKey, config.openaiModel);

            case LLMProviderType.ANTHROPIC:
                let anthropicApiKey = await this.configManager.getSecret('anthropic.apiKey');
                if (!anthropicApiKey) {
                    logger.warn('Anthropic API key not found in secret storage, prompting user');
                    anthropicApiKey = await this.promptForApiKey('Anthropic', 'anthropic.apiKey');

                    if (!anthropicApiKey) {
                        logger.info('User cancelled Anthropic API key input, falling back to RAG-Only mode');
                        return new RAGOnlyProvider();
                    }
                }
                logger.info(`Creating Anthropic provider with model: ${config.anthropicModel}`);
                return new AnthropicProvider(anthropicApiKey, config.anthropicModel);

            case LLMProviderType.GOOGLE:
                let googleApiKey = await this.configManager.getSecret('google.apiKey');
                if (!googleApiKey) {
                    logger.warn('Google API key not found in secret storage, prompting user');
                    googleApiKey = await this.promptForApiKey('Google', 'google.apiKey');

                    if (!googleApiKey) {
                        logger.info('User cancelled Google API key input, falling back to RAG-Only mode');
                        return new RAGOnlyProvider();
                    }
                }
                logger.info(`Creating Google provider with model: ${config.googleModel}`);
                return new GoogleProvider(googleApiKey, config.googleModel);

            case LLMProviderType.OPENROUTER:
                let openrouterApiKey = await this.configManager.getSecret('openrouter.apiKey');
                if (!openrouterApiKey) {
                    logger.warn('OpenRouter API key not found in secret storage, prompting user');
                    openrouterApiKey = await this.promptForApiKey('OpenRouter', 'openrouter.apiKey');

                    if (!openrouterApiKey) {
                        logger.info('User cancelled OpenRouter API key input, falling back to RAG-Only mode');
                        return new RAGOnlyProvider();
                    }
                }
                logger.info(`Creating OpenRouter provider with model: ${config.openrouterModel}`);
                return new OpenRouterProvider(openrouterApiKey, config.openrouterModel);

            case LLMProviderType.CUSTOM:
                let customApiKey = await this.configManager.getSecret('custom.apiKey');
                if (!customApiKey) {
                    logger.warn('Custom provider API key not found in secret storage, prompting user');
                    customApiKey = await this.promptForApiKey('Custom Provider', 'custom.apiKey');

                    if (!customApiKey) {
                        logger.info('User cancelled Custom provider API key input, falling back to RAG-Only mode');
                        return new RAGOnlyProvider();
                    }
                }
                logger.info(`Creating Custom provider with URL: ${config.customProviderUrl} and model: ${config.customProviderModel}`);
                return new CustomProvider(customApiKey, config.customProviderModel, config.customProviderUrl);

            default:
                logger.warn(`Unsupported LLM provider: ${config.llmProvider}, falling back to RAG-Only mode`);
                return new RAGOnlyProvider();
        }
    }

    /**
     * Reset the active service (e.g., after configuration changes)
     */
    public resetService(): void {
        logger.debug(`Resetting active LLM service: ${this.activeService ? this.activeService.getName() : 'none'}`);
        this.activeService = null;

        // Force reload configuration to ensure we have the latest values
        this.configManager.reloadConfiguration();
        const config = this.configManager.getConfiguration();
        logger.debug(`Current configuration after reset: provider=${config.llmProvider}, ollamaModel=${config.ollamaModel}`);
    }

    /**
     * Get all available providers and their models
     * This is used to populate the model dropdown in the UI
     * @returns A promise that resolves to an array of provider objects with their models
     */
    public async getAllProviders(): Promise<{provider: string, models: string[]}[]> {
        const providers: {provider: string, models: string[]}[] = [];
        const config = this.configManager.getConfiguration();

        try {
            // Add RAG-Only provider
            providers.push({
                provider: 'RAG-Only',
                models: ['rag-only']
            });

            // Add Ollama provider
            try {
                logger.debug(`Attempting to get Ollama models from ${config.ollamaUrl}`);
                const ollamaProvider = new OllamaProvider(config.ollamaUrl, config.ollamaModel);
                const ollamaModels = await ollamaProvider.getAvailableModels();
                logger.debug(`Successfully retrieved ${ollamaModels.length} Ollama models`);

                // If we got models, add them to the providers list
                if (ollamaModels.length > 0) {
                    providers.push({
                        provider: 'Ollama',
                        models: ollamaModels
                    });
                } else {
                    // If no models were found, add the configured model as a fallback
                    logger.debug(`No Ollama models found, using configured model: ${config.ollamaModel}`);
                    providers.push({
                        provider: 'Ollama',
                        models: [config.ollamaModel]
                    });
                }
            } catch (error) {
                // Log the error and add the configured model as a fallback
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`Failed to get Ollama models: ${errorMessage}`);
                logger.debug(`Using configured Ollama model as fallback: ${config.ollamaModel}`);
                providers.push({
                    provider: 'Ollama',
                    models: [config.ollamaModel]
                });
            }

            // Add OpenAI provider
            const openaiApiKey = await this.configManager.getSecret('openai.apiKey');
            if (openaiApiKey) {
                try {
                    const openaiProvider = new OpenAIProvider(openaiApiKey, config.openaiModel);
                    const openaiModels = await openaiProvider.getAvailableModels();
                    providers.push({
                        provider: 'OpenAI',
                        models: openaiModels
                    });
                } catch (error) {
                    logger.warn('Failed to get OpenAI models', error);
                    providers.push({
                        provider: 'OpenAI',
                        models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']
                    });
                }
            } else {
                providers.push({
                    provider: 'OpenAI',
                    models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']
                });
            }

            // Add Anthropic provider
            const anthropicApiKey = await this.configManager.getSecret('anthropic.apiKey');
            if (anthropicApiKey) {
                try {
                    const anthropicProvider = new AnthropicProvider(anthropicApiKey, config.anthropicModel);
                    const anthropicModels = await anthropicProvider.getAvailableModels();
                    providers.push({
                        provider: 'Anthropic',
                        models: anthropicModels
                    });
                } catch (error) {
                    logger.warn('Failed to get Anthropic models', error);
                    providers.push({
                        provider: 'Anthropic',
                        models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307']
                    });
                }
            } else {
                providers.push({
                    provider: 'Anthropic',
                    models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307']
                });
            }

            // Add Google provider
            providers.push({
                provider: 'Google',
                models: ['gemini-pro', 'gemini-pro-vision', 'gemini-ultra']
            });

            // Add OpenRouter provider
            const openrouterApiKey = await this.configManager.getSecret('openrouter.apiKey');
            if (openrouterApiKey) {
                try {
                    const openrouterProvider = new OpenRouterProvider(openrouterApiKey, config.openrouterModel);
                    const openrouterModels = await openrouterProvider.getAvailableModels();
                    providers.push({
                        provider: 'OpenRouter',
                        models: openrouterModels
                    });
                } catch (error) {
                    logger.warn('Failed to get OpenRouter models', error);
                    providers.push({
                        provider: 'OpenRouter',
                        models: ['openai/gpt-3.5-turbo', 'openai/gpt-4', 'anthropic/claude-3-opus']
                    });
                }
            } else {
                providers.push({
                    provider: 'OpenRouter',
                    models: ['openai/gpt-3.5-turbo', 'openai/gpt-4', 'anthropic/claude-3-opus']
                });
            }

            return providers;
        } catch (error) {
            logger.error('Failed to get all providers', error);
            return [
                {
                    provider: 'RAG-Only',
                    models: ['rag-only']
                },
                {
                    provider: 'Ollama',
                    models: [config.ollamaModel]
                }
            ];
        }
    }
}
