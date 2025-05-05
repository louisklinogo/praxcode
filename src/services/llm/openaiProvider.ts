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
 * OpenAI Provider implementation
 */
export class OpenAIProvider implements LLMService {
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The OpenAI API key
     * @param model The model to use
     * @param baseUrl Optional base URL for the OpenAI API
     */
    constructor(apiKey: string, model: string = 'gpt-3.5-turbo', baseUrl: string = 'https://api.openai.com/v1') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'OpenAI';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // OpenAI doesn't natively support MCP
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
                // Filter for chat models only
                return response.data.data
                    .filter((model: any) =>
                        model.id.includes('gpt') ||
                        model.id.includes('turbo') ||
                        model.id.includes('claude')
                    )
                    .map((model: any) => model.id);
            }

            return [];
        } catch (error) {
            logger.error('Failed to get available models from OpenAI', error);
            throw new Error(`Failed to get available models: ${error}`);
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
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.model,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    temperature: options?.temperature ?? 0.7,
                    max_tokens: options?.maxTokens,
                    stop: options?.stopSequences,
                    stream: false
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = response.data;

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
            logger.error('Failed to get chat completion from OpenAI', error);
            throw new Error(`Failed to get chat completion: ${error}`);
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
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.model,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    temperature: options?.temperature ?? 0.7,
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

            const stream = response.data;
            let buffer = '';
            let contentSoFar = '';

            stream.on('data', (chunk: Buffer) => {
                const chunkStr = chunk.toString();
                buffer += chunkStr;

                // Process complete lines
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex);
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.trim() && line.startsWith('data: ')) {
                        const data = line.substring(6);

                        if (data === '[DONE]') {
                            callback({
                                content: contentSoFar,
                                done: true
                            });
                            return;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.choices && parsed.choices[0]) {
                                const delta = parsed.choices[0].delta;
                                if (delta.content) {
                                    contentSoFar += delta.content;
                                    callback({
                                        content: contentSoFar,
                                        done: false
                                    });
                                }
                            }
                        } catch (error) {
                            logger.error('Failed to parse streaming response', error);
                        }
                    }
                }
            });

            stream.on('end', () => {
                // Ensure we mark the stream as done
                callback({
                    content: contentSoFar,
                    done: true
                });
            });

            stream.on('error', (error: Error) => {
                logger.error('Error in streaming response', error);
                callback({
                    content: `Error: ${error.message}`,
                    done: true
                });
            });
        } catch (error) {
            logger.error('Failed to get streaming chat completion from OpenAI', error);
            callback({
                content: `Error: ${error}`,
                done: true
            });
        }
    }
}
