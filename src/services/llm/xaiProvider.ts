import axios from 'axios';
import { logger } from '../../utils/logger';
import {
    ChatCompletionOptions,
    ChatCompletionResponse,
    ChatMessage,
    LLMService,
    StreamingChatCompletionResponse
} from './llmService';

/**
 * x.ai Provider implementation
 * This provider connects to the x.ai API for Grok-3 models
 */
export class XAIProvider implements LLMService {
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The x.ai API key
     * @param model The model to use (e.g., 'grok-3', 'grok-3-latest')
     * @param baseUrl Optional base URL for the x.ai API
     */
    constructor(apiKey: string, model: string = 'grok-3', baseUrl: string = 'https://api.x.ai/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'x.ai';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // x.ai doesn't natively support MCP
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            logger.debug(`Getting available models from x.ai API: ${this.baseUrl}/models`);

            // Use fetch instead of axios for consistency
            const response = await fetch(`${this.baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`x.ai API error when getting models: ${response.status} ${response.statusText}`, errorText);
                // Return a default list of models if the API call fails
                return ['grok-3', 'grok-3-latest', 'grok-3-fast-beta'];
            }

            const data = await response.json() as { data?: Array<{ id: string }> };

            if (data && data.data && Array.isArray(data.data)) {
                // Filter for Grok models only
                const grokModels = data.data
                    .filter((model) => model.id && model.id.includes('grok'))
                    .map((model) => model.id);

                logger.debug(`Found ${grokModels.length} Grok models from x.ai API`);

                if (grokModels.length > 0) {
                    return grokModels;
                }
            }

            // If we can't get the models from the API, return a default list
            logger.debug('No Grok models found, returning default list');
            return ['grok-3', 'grok-3-latest', 'grok-3-fast-beta'];
        } catch (error) {
            logger.error('Failed to get available models from x.ai', error);
            // Return a default list of models if the API call fails
            return ['grok-3', 'grok-3-latest', 'grok-3-fast-beta'];
        }
    }

    /**
     * Send a chat completion request
     * @param messages The messages to send
     * @param options The completion options
     */
    async chat(
        messages: ChatMessage[],
        options?: ChatCompletionOptions
    ): Promise<ChatCompletionResponse> {
        try {
            logger.debug(`Chat with x.ai model: ${this.model}`);
            logger.debug(`Using x.ai API URL: ${this.baseUrl}/chat/completions`);

            // Use fetch instead of axios for consistency
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    temperature: options?.temperature ?? 0.7,
                    max_tokens: options?.maxTokens,
                    stop: options?.stopSequences,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`x.ai API error: ${response.status} ${response.statusText}`, errorText);

                if (response.status === 401) {
                    throw new Error('Invalid x.ai API key. Please check your API key and try again.');
                }

                throw new Error(`x.ai API error: ${response.status} ${response.statusText}. ${errorText}`);
            }

            // Define the expected response type
            interface XAIResponse {
                choices: Array<{
                    message: {
                        content: string;
                    };
                }>;
                model: string;
                usage: {
                    prompt_tokens: number;
                    completion_tokens: number;
                    total_tokens: number;
                };
            }

            const data = await response.json() as XAIResponse;

            return {
                content: data.choices[0].message.content,
                model: data.model,
                usage: {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens
                }
            };
        } catch (error) {
            logger.error('Failed to get chat completion from x.ai', error);
            throw new Error(`Failed to get chat completion: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Send a streaming chat completion request
     * @param messages The messages to send
     * @param callback The callback to receive streaming responses
     * @param options The completion options
     */
    async streamChat(
        messages: ChatMessage[],
        callback: (response: StreamingChatCompletionResponse) => void,
        options?: ChatCompletionOptions
    ): Promise<void> {
        try {
            logger.debug(`Streaming chat with x.ai model: ${this.model}`);
            logger.debug(`Using x.ai API URL: ${this.baseUrl}/chat/completions`);

            // Use fetch instead of axios for better streaming support
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    temperature: options?.temperature ?? 0.7,
                    max_tokens: options?.maxTokens,
                    stop: options?.stopSequences,
                    stream: true
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`x.ai API error: ${response.status} ${response.statusText}`, errorText);

                if (response.status === 401) {
                    callback({
                        content: 'Invalid x.ai API key. Please check your API key and try again.',
                        done: true
                    });
                    return;
                }

                callback({
                    content: `x.ai API error: ${response.status} ${response.statusText}. ${errorText}`,
                    done: true
                });
                return;
            }

            if (!response.body) {
                logger.error('No response body from x.ai API');
                callback({
                    content: 'No response from x.ai API. Please try again later.',
                    done: true
                });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let content = '';

            const processChunk = async () => {
                try {
                    const { done, value } = await reader.read();

                    if (done) {
                        // Ensure we send a final done: true message
                        callback({
                            content,
                            done: true
                        });
                        return;
                    }

                    // Decode the chunk and add it to our buffer
                    buffer += decoder.decode(value, { stream: true });

                    // Process complete lines
                    let newlineIndex;
                    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.substring(0, newlineIndex).trim();
                        buffer = buffer.substring(newlineIndex + 1);

                        if (line.startsWith('data: ')) {
                            const jsonStr = line.substring(6).trim();

                            if (jsonStr === '[DONE]') {
                                callback({
                                    content,
                                    done: true
                                });
                                return;
                            }

                            try {
                                const data = JSON.parse(jsonStr);
                                if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                                    const delta = data.choices[0].delta.content;
                                    content += delta;
                                    callback({
                                        content,
                                        done: false
                                    });
                                }
                            } catch (parseError) {
                                logger.error('Error parsing streaming response from x.ai', parseError);
                            }
                        }
                    }

                    // Continue processing chunks
                    await processChunk();
                } catch (error) {
                    logger.error('Error reading stream from x.ai', error);
                    callback({
                        content: `Error reading stream: ${error instanceof Error ? error.message : String(error)}`,
                        done: true
                    });
                }
            };

            // Start processing the stream
            await processChunk();
        } catch (error) {
            logger.error('Failed to stream chat completion from x.ai', error);

            callback({
                content: `Failed to stream chat completion: ${error instanceof Error ? error.message : String(error)}`,
                done: true
            });
        }
    }
}
