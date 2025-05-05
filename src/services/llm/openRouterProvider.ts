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
 * OpenRouter API response interface
 */
interface OpenRouterResponse {
    id: string;
    model: string;
    choices: Array<{
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
        index: number;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * OpenRouter Provider implementation
 */
export class OpenRouterProvider implements LLMService {
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The OpenRouter API key
     * @param model The model to use
     * @param baseUrl Optional base URL for the OpenRouter API
     */
    constructor(apiKey: string, model: string = 'openai/gpt-3.5-turbo', baseUrl: string = 'https://openrouter.ai/api/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'OpenRouter';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // OpenRouter doesn't natively support MCP
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            const response = await axios.get(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.data) {
                return response.data.data.map((model: any) => model.id);
            }

            return [];
        } catch (error) {
            logger.error('Failed to get available models from OpenRouter', error);

            if (axios.isAxiosError(error) && error.response?.status === 401) {
                throw new Error('Invalid OpenRouter API key. Please check your API key and try again.');
            }

            throw new Error(`Failed to get available models: ${error instanceof Error ? error.message : String(error)}`);
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
            // Format messages for OpenRouter API (same format as OpenAI)
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
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/praxcode/praxcode', // Identify the client
                        'X-Title': 'PraxCode VS Code Extension' // Identify the client
                    }
                }
            );

            const data = response.data as OpenRouterResponse;

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
            logger.error('Failed to get chat completion from OpenRouter', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid OpenRouter API key. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`OpenRouter API error: ${JSON.stringify(error.response.data)}`);
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
            // Format messages for OpenRouter API (same format as OpenAI)
            const formattedMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));

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
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://github.com/praxcode/praxcode', // Identify the client
                        'X-Title': 'PraxCode VS Code Extension' // Identify the client
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
        } catch (error) {
            logger.error('Failed to stream chat completion from OpenRouter', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid OpenRouter API key. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`OpenRouter API error: ${JSON.stringify(error.response.data)}`);
                }
            }

            throw new Error(`Failed to stream chat completion: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
