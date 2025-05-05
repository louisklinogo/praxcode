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
 * Google API response interface
 */
interface GoogleResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
            role: string;
        };
        finishReason: string;
        index: number;
        safetyRatings: Array<any>;
    }>;
    promptFeedback: {
        blockReason?: string;
        safetyRatings: Array<any>;
    };
    usageMetadata: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

/**
 * Google Provider implementation
 */
export class GoogleProvider implements LLMService {
    private apiKey: string;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The Google API key
     * @param model The model to use
     * @param baseUrl Optional base URL for the Google API
     */
    constructor(apiKey: string, model: string = 'gemini-pro', baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'Google';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // Google doesn't natively support MCP
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        // Google doesn't have a models endpoint in the same way, so we return a static list
        return [
            'gemini-pro',
            'gemini-pro-vision',
            'gemini-ultra'
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
            // Convert messages to Google format
            const formattedMessages = messages.map(msg => ({
                role: msg.role === 'system' ? 'user' : msg.role,
                parts: [{ text: msg.content }]
            }));

            // If there's a system message, prepend it to the first user message
            const systemMessage = messages.find(m => m.role === 'system');
            if (systemMessage) {
                // Find the first user message
                const firstUserMessageIndex = messages.findIndex(m => m.role === 'user');
                if (firstUserMessageIndex >= 0) {
                    // Prepend system message to user message
                    formattedMessages[firstUserMessageIndex].parts[0].text =
                        `${systemMessage.content}\n\n${formattedMessages[firstUserMessageIndex].parts[0].text}`;
                }

                // Remove the system message from the array
                formattedMessages.splice(messages.findIndex(m => m.role === 'system'), 1);
            }

            // Make the API request
            const response = await axios.post(
                `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    contents: formattedMessages,
                    generationConfig: {
                        temperature: options?.temperature || 0.7,
                        maxOutputTokens: options?.maxTokens || 2048,
                        stopSequences: options?.stopSequences || []
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = response.data as GoogleResponse;

            // Extract the text content from the response
            const content = data.candidates[0].content.parts
                .map(part => part.text)
                .join('');

            return {
                content,
                model: this.model,
                usage: {
                    promptTokens: data.usageMetadata.promptTokenCount,
                    completionTokens: data.usageMetadata.candidatesTokenCount,
                    totalTokens: data.usageMetadata.totalTokenCount
                }
            };
        } catch (error) {
            logger.error('Failed to get chat completion from Google', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid Google API key. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`Google API error: ${JSON.stringify(error.response.data)}`);
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
            // Convert messages to Google format
            const formattedMessages = messages.map(msg => ({
                role: msg.role === 'system' ? 'user' : msg.role,
                parts: [{ text: msg.content }]
            }));

            // If there's a system message, prepend it to the first user message
            const systemMessage = messages.find(m => m.role === 'system');
            if (systemMessage) {
                // Find the first user message
                const firstUserMessageIndex = messages.findIndex(m => m.role === 'user');
                if (firstUserMessageIndex >= 0) {
                    // Prepend system message to user message
                    formattedMessages[firstUserMessageIndex].parts[0].text =
                        `${systemMessage.content}\n\n${formattedMessages[firstUserMessageIndex].parts[0].text}`;
                }

                // Remove the system message from the array
                formattedMessages.splice(messages.findIndex(m => m.role === 'system'), 1);
            }

            // Make the streaming API request
            const response = await axios.post(
                `${this.baseUrl}/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
                {
                    contents: formattedMessages,
                    generationConfig: {
                        temperature: options?.temperature || 0.7,
                        maxOutputTokens: options?.maxTokens || 2048,
                        stopSequences: options?.stopSequences || []
                    }
                },
                {
                    headers: {
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

                            if (parsedData.candidates && parsedData.candidates[0].content) {
                                const newContent = parsedData.candidates[0].content.parts
                                    .map((part: any) => part.text)
                                    .join('');

                                accumulatedContent += newContent;

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
            logger.error('Failed to stream chat completion from Google', error);

            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid Google API key. Please check your API key and try again.');
                } else if (error.response?.data) {
                    throw new Error(`Google API error: ${JSON.stringify(error.response.data)}`);
                }
            }

            throw new Error(`Failed to stream chat completion: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
