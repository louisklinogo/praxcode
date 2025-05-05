import axios from 'axios';
import {
    LLMService,
    ChatMessage,
    ChatCompletionOptions,
    ChatCompletionResponse,
    StreamingChatCompletionResponse
} from './llmService';
import { logger } from '../../utils/logger';

/**
 * Custom Provider implementation
 * This provider allows users to connect to their own API endpoints
 * that follow the OpenAI-compatible API format
 */
export class CustomProvider implements LLMService {
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The API key for the custom provider
     * @param model The model to use
     * @param baseUrl The base URL for the custom provider API
     */
    constructor(apiKey: string, model: string = 'default', baseUrl: string = 'http://localhost:8000') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'Custom Provider';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // Custom provider doesn't natively support MCP
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            // Try to get models from the custom provider
            // Assuming it follows OpenAI-compatible API
            const response = await axios.get(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.data) {
                return response.data.data.map((model: any) => model.id);
            }

            return [this.model]; // Return the current model if we can't get a list
        } catch (error) {
            logger.warn('Failed to get available models from custom provider', error);
            return [this.model]; // Return the current model if the API call fails
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
            // Format messages for the API (OpenAI format)
            const formattedMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            // Make the API request
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.model,
                    messages: formattedMessages,
                    temperature: options?.temperature || 0.7,
                    max_tokens: options?.maxTokens,
                    stop: options?.stopSequences
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Handle different response formats
            let content = '';
            let usage = {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0
            };

            if (response.data.choices && response.data.choices[0].message) {
                // OpenAI-like format
                content = response.data.choices[0].message.content;

                if (response.data.usage) {
                    usage = {
                        promptTokens: response.data.usage.prompt_tokens || 0,
                        completionTokens: response.data.usage.completion_tokens || 0,
                        totalTokens: response.data.usage.total_tokens || 0
                    };
                }
            } else if (response.data.content) {
                // Simple format
                content = response.data.content;
            } else {
                // Try to extract content from the response
                content = JSON.stringify(response.data);
            }

            return {
                content,
                model: this.model,
                usage
            };
        } catch (error) {
            logger.error('Failed to get chat completion from custom provider', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid API key for custom provider. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`Custom provider API error: ${JSON.stringify(error.response.data)}`);
                }
            }

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
            // Format messages for the API (OpenAI format)
            const formattedMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));

            // Try streaming first
            try {
                // Make the streaming API request
                const response = await axios.post(
                    `${this.baseUrl}/chat/completions`,
                    {
                        model: this.model,
                        messages: formattedMessages,
                        temperature: options?.temperature || 0.7,
                        max_tokens: options?.maxTokens,
                        stop: options?.stopSequences,
                        stream: true
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        responseType: 'stream'
                    }
                );

                let accumulatedContent = '';

                // Process the streaming response
                response.data.on('data', (chunk: Buffer) => {
                    const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);

                            if (data === '[DONE]') {
                                callback({
                                    content: accumulatedContent,
                                    done: true
                                });
                                return;
                            }

                            try {
                                const parsedData = JSON.parse(data);

                                if (parsedData.choices && parsedData.choices[0].delta && parsedData.choices[0].delta.content) {
                                    accumulatedContent += parsedData.choices[0].delta.content;

                                    callback({
                                        content: accumulatedContent,
                                        done: false
                                    });
                                }
                            } catch (e) {
                                logger.error('Error parsing streaming response', e);
                            }
                        }
                    }
                });

                response.data.on('end', () => {
                    callback({
                        content: accumulatedContent,
                        done: true
                    });
                });

                response.data.on('error', (err: Error) => {
                    logger.error('Error in streaming response', err);
                    throw err;
                });

                return;
            } catch (streamError) {
                // If streaming fails, fall back to non-streaming
                logger.warn('Streaming not supported by custom provider, falling back to non-streaming', streamError);

                // Make a non-streaming request instead
                const response = await this.chat(messages, options);

                // Simulate streaming with the full response
                callback({
                    content: response.content,
                    done: true
                });
            }
        } catch (error) {
            logger.error('Failed to stream chat completion from custom provider', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid API key for custom provider. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`Custom provider API error: ${JSON.stringify(error.response.data)}`);
                }
            }

            throw new Error(`Failed to stream chat completion: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
