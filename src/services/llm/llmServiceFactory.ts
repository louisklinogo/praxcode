import { LLMService } from './llmService';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GoogleProvider } from './googleProvider';
import { OpenRouterProvider } from './openRouterProvider';
import { CustomProvider } from './customProvider';
import { MCPProvider } from './mcpProvider';
import { ConfigurationManager, LLMProviderType } from '../../utils/configurationManager';
import { logger } from '../../utils/logger';

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
            this.activeService = await this.createService();
        }
        return this.activeService;
    }

    /**
     * Create a new LLM service based on configuration
     */
    public async createService(): Promise<LLMService> {
        const config = this.configManager.getConfiguration();

        // Check if MCP is enabled and create an MCP provider if so
        if (config.mcpEnabled) {
            const mcpApiKey = await this.configManager.getSecret('mcp.apiKey');
            if (!mcpApiKey) {
                logger.error('MCP API key not found in secret storage');
                throw new Error('MCP API key not found. Please set it in the settings.');
            }
            logger.info(`Creating MCP provider with URL: ${config.mcpEndpointUrl} and model: ${config.mcpEndpointModel}`);
            return new MCPProvider(mcpApiKey, config.mcpEndpointModel, config.mcpEndpointUrl);
        }

        // Otherwise, create a provider based on the selected LLM provider
        switch (config.llmProvider) {
            case LLMProviderType.OLLAMA:
                logger.info(`Creating Ollama provider with URL: ${config.ollamaUrl} and model: ${config.ollamaModel}`);
                return new OllamaProvider(config.ollamaUrl, config.ollamaModel);

            case LLMProviderType.OPENAI:
                const openaiApiKey = await this.configManager.getSecret('openai.apiKey');
                if (!openaiApiKey) {
                    logger.error('OpenAI API key not found in secret storage');
                    throw new Error('OpenAI API key not found. Please set it in the settings.');
                }
                logger.info(`Creating OpenAI provider with model: ${config.openaiModel}`);
                return new OpenAIProvider(openaiApiKey, config.openaiModel);

            case LLMProviderType.ANTHROPIC:
                const anthropicApiKey = await this.configManager.getSecret('anthropic.apiKey');
                if (!anthropicApiKey) {
                    logger.error('Anthropic API key not found in secret storage');
                    throw new Error('Anthropic API key not found. Please set it in the settings.');
                }
                logger.info(`Creating Anthropic provider with model: ${config.anthropicModel}`);
                return new AnthropicProvider(anthropicApiKey, config.anthropicModel);

            case LLMProviderType.GOOGLE:
                const googleApiKey = await this.configManager.getSecret('google.apiKey');
                if (!googleApiKey) {
                    logger.error('Google API key not found in secret storage');
                    throw new Error('Google API key not found. Please set it in the settings.');
                }
                logger.info(`Creating Google provider with model: ${config.googleModel}`);
                return new GoogleProvider(googleApiKey, config.googleModel);

            case LLMProviderType.OPENROUTER:
                const openrouterApiKey = await this.configManager.getSecret('openrouter.apiKey');
                if (!openrouterApiKey) {
                    logger.error('OpenRouter API key not found in secret storage');
                    throw new Error('OpenRouter API key not found. Please set it in the settings.');
                }
                logger.info(`Creating OpenRouter provider with model: ${config.openrouterModel}`);
                return new OpenRouterProvider(openrouterApiKey, config.openrouterModel);

            case LLMProviderType.CUSTOM:
                const customApiKey = await this.configManager.getSecret('custom.apiKey');
                if (!customApiKey) {
                    logger.error('Custom provider API key not found in secret storage');
                    throw new Error('Custom provider API key not found. Please set it in the settings.');
                }
                logger.info(`Creating Custom provider with URL: ${config.customProviderUrl} and model: ${config.customProviderModel}`);
                return new CustomProvider(customApiKey, config.customProviderModel, config.customProviderUrl);

            default:
                logger.error(`Unsupported LLM provider: ${config.llmProvider}`);
                throw new Error(`Unsupported LLM provider: ${config.llmProvider}`);
        }
    }

    /**
     * Reset the active service (e.g., after configuration changes)
     */
    public resetService(): void {
        this.activeService = null;
    }
}
