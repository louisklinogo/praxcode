import { ConfigurationManager, LLMProviderType } from '../../utils/configurationManager';
import { logger } from '../../utils/logger';
import axios from 'axios';

/**
 * Service to check the availability of LLM providers
 */
export class LLMAvailabilityService {
    private configManager: ConfigurationManager;
    private static instance: LLMAvailabilityService;

    /**
     * Constructor
     * @param configManager The configuration manager
     */
    private constructor(configManager: ConfigurationManager) {
        this.configManager = configManager;
    }

    /**
     * Get the singleton instance
     * @param configManager The configuration manager
     */
    public static getInstance(configManager: ConfigurationManager): LLMAvailabilityService {
        if (!LLMAvailabilityService.instance) {
            LLMAvailabilityService.instance = new LLMAvailabilityService(configManager);
        }
        return LLMAvailabilityService.instance;
    }

    /**
     * Check if an LLM provider is available
     * @returns A promise that resolves to a boolean indicating if the LLM provider is available
     */
    public async isLLMAvailable(): Promise<boolean> {
        try {
            const config = this.configManager.getConfiguration();

            // Check if LLM provider is set to "none"
            if (config.llmProvider === LLMProviderType.NONE) {
                logger.info('LLM provider is set to "none"');
                return false;
            }

            // Check if MCP is enabled
            if (config.mcpEnabled) {
                const mcpApiKey = await this.configManager.getSecret('mcp.apiKey');
                if (!mcpApiKey) {
                    logger.warn('MCP API key not found in secret storage');
                    return false;
                }

                // Try to ping the MCP endpoint
                try {
                    await axios.get(`${config.mcpEndpointUrl}/health`, {
                        headers: { 'Authorization': `Bearer ${mcpApiKey}` },
                        timeout: 2000
                    });
                    return true;
                } catch (error) {
                    logger.warn('Failed to connect to MCP endpoint', error);
                    return false;
                }
            }

            // Check availability based on provider type
            switch (config.llmProvider) {
                case LLMProviderType.OLLAMA:
                    return await this.isOllamaAvailable(config.ollamaUrl);

                case LLMProviderType.OPENAI:
                    return await this.isOpenAIAvailable();

                case LLMProviderType.ANTHROPIC:
                    return await this.isAnthropicAvailable();

                case LLMProviderType.GOOGLE:
                    return await this.isGoogleAvailable();

                case LLMProviderType.OPENROUTER:
                    return await this.isOpenRouterAvailable();

                case LLMProviderType.CUSTOM:
                    return await this.isCustomProviderAvailable();

                default:
                    logger.warn(`Unknown LLM provider type: ${config.llmProvider}`);
                    return false;
            }
        } catch (error) {
            logger.error('Error checking LLM availability', error);
            return false;
        }
    }

    /**
     * Check if Ollama is available
     * @param ollamaUrl The Ollama URL
     */
    private async isOllamaAvailable(ollamaUrl: string): Promise<boolean> {
        try {
            logger.debug(`Checking if Ollama is available at ${ollamaUrl}/api/version`);

            // Try to get the Ollama version
            const response = await axios.get(`${ollamaUrl}/api/version`, {
                timeout: 5000,  // Increased timeout for slower connections
                validateStatus: (status) => status < 500 // Accept any status code less than 500
            });

            // If we got a response, log it and return true
            if (response.status === 200) {
                logger.debug(`Ollama is available. Version: ${JSON.stringify(response.data)}`);
                return true;
            } else {
                logger.warn(`Ollama returned non-200 status code: ${response.status}`);
                // Still return true if we got any response
                return true;
            }
        } catch (error) {
            // Log the specific error for debugging
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED') {
                    logger.warn(`Ollama connection refused at ${ollamaUrl}. Is Ollama running?`);
                } else if (error.code === 'ETIMEDOUT') {
                    logger.warn(`Ollama connection timed out at ${ollamaUrl}`);
                } else if (error.response) {
                    logger.warn(`Ollama returned error status: ${error.response.status}`);
                } else {
                    logger.warn(`Ollama connection error: ${error.message}`);
                }
            } else {
                logger.warn(`Ollama is not available: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Return false to indicate Ollama is not available
            return false;
        }
    }

    /**
     * Check if OpenAI is available
     */
    private async isOpenAIAvailable(): Promise<boolean> {
        const apiKey = await this.configManager.getSecret('openai.apiKey');
        return !!apiKey;
    }

    /**
     * Check if Anthropic is available
     */
    private async isAnthropicAvailable(): Promise<boolean> {
        const apiKey = await this.configManager.getSecret('anthropic.apiKey');
        return !!apiKey;
    }

    /**
     * Check if Google is available
     */
    private async isGoogleAvailable(): Promise<boolean> {
        const apiKey = await this.configManager.getSecret('google.apiKey');
        return !!apiKey;
    }

    /**
     * Check if OpenRouter is available
     */
    private async isOpenRouterAvailable(): Promise<boolean> {
        const apiKey = await this.configManager.getSecret('openrouter.apiKey');
        return !!apiKey;
    }

    /**
     * Check if custom provider is available
     */
    private async isCustomProviderAvailable(): Promise<boolean> {
        const apiKey = await this.configManager.getSecret('custom.apiKey');
        return !!apiKey;
    }
}
