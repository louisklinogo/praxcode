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
 * Anthropic API response interface
 */
interface AnthropicResponse {
    id: string;
    type: string;
    model: string;
    content: Array<{
        type: string;
        text: string;
    }>;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

/**
 * Anthropic Provider implementation
 */
export class AnthropicProvider implements LLMService {
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The Anthropic API key
     * @param model The model to use
     * @param baseUrl Optional base URL for the Anthropic API
     */
    constructor(apiKey: string, model: string = 'claude-3-haiku-20240307', baseUrl: string = 'https://api.anthropic.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'Anthropic';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // Anthropic doesn't natively support MCP
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        // Anthropic doesn't have a models endpoint, so we return a static list
        return [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-2.1',
            'claude-2.0',
            'claude-instant-1.2'
        ];
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
            // Convert messages to Anthropic format
            const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
            const userMessages = messages.filter(m => m.role !== 'system');

            // Format messages for Anthropic API
            const formattedMessages = userMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: [{ type: 'text', text: msg.content }]
            }));

            // Make the API request
            const response = await axios.post(
                `${this.baseUrl}/messages`,
                {
                    model: this.model,
                    messages: formattedMessages,
                    system: systemPrompt,
                    max_tokens: options?.maxTokens || 4096,
                    temperature: options?.temperature || 0.7,
                    stop_sequences: options?.stopSequences || []
                },
                {
                    headers: {
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = response.data as AnthropicResponse;

            // Extract the text content from the response
            const content = data.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('');

            return {
                content,
                model: data.model,
                usage: {
                    promptTokens: data.usage.input_tokens,
                    completionTokens: data.usage.output_tokens,
                    totalTokens: data.usage.input_tokens + data.usage.output_tokens
                }
            };
        } catch (error) {
            logger.error('Failed to get chat completion from Anthropic', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid Anthropic API key. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`Anthropic API error: ${JSON.stringify(error.response.data)}`);
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
            // Convert messages to Anthropic format
            const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
            const userMessages = messages.filter(m => m.role !== 'system');

            // Format messages for Anthropic API
            const formattedMessages = userMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: [{ type: 'text', text: msg.content }]
            }));

            // Make the streaming API request
            const response = await axios.post(
                `${this.baseUrl}/messages`,
                {
                    model: this.model,
                    messages: formattedMessages,
                    system: systemPrompt,
                    max_tokens: options?.maxTokens || 4096,
                    temperature: options?.temperature || 0.7,
                    stop_sequences: options?.stopSequences || [],
                    stream: true
                },
                {
                    headers: {
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01',
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

                            if (parsedData.type === 'content_block_delta' && parsedData.delta.type === 'text_delta') {
                                accumulatedContent += parsedData.delta.text;

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
            logger.error('Failed to stream chat completion from Anthropic', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid Anthropic API key. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`Anthropic API error: ${JSON.stringify(error.response.data)}`);
                }
            }

            throw new Error(`Failed to stream chat completion: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
