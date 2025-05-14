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
            logger.debug(`Chat with Google model: ${this.model}`);
            logger.debug(`Using Google API URL: ${this.baseUrl}/models/${this.model}:generateContent`);

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

            // Use fetch instead of axios for consistency
            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: formattedMessages,
                        generationConfig: {
                            temperature: options?.temperature || 0.7,
                            maxOutputTokens: options?.maxTokens || 2048,
                            stopSequences: options?.stopSequences || []
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`Google API error: ${response.status} ${response.statusText}`, errorText);

                if (response.status === 401) {
                    throw new Error('Invalid Google API key. Please check your API key and try again.');
                }

                throw new Error(`Google API error: ${response.status} ${response.statusText}. ${errorText}`);
            }

            const data = await response.json() as GoogleResponse;

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
            logger.debug(`Streaming chat with Google model: ${this.model}`);
            logger.debug(`Using Google API URL: ${this.baseUrl}/models/${this.model}:streamGenerateContent`);

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

            // Use fetch instead of axios for better streaming support
            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: formattedMessages,
                        generationConfig: {
                            temperature: options?.temperature || 0.7,
                            maxOutputTokens: options?.maxTokens || 2048,
                            stopSequences: options?.stopSequences || []
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`Google API error: ${response.status} ${response.statusText}`, errorText);

                if (response.status === 401) {
                    callback({
                        content: 'Invalid Google API key. Please check your API key and try again.',
                        done: true
                    });
                    return;
                }

                callback({
                    content: `Google API error: ${response.status} ${response.statusText}. ${errorText}`,
                    done: true
                });
                return;
            }

            if (!response.body) {
                logger.error('No response body from Google API');
                callback({
                    content: 'No response from Google API. Please try again later.',
                    done: true
                });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let accumulatedContent = '';

            const processChunk = async () => {
                try {
                    const { done, value } = await reader.read();

                    if (done) {
                        // Ensure we send a final done: true message
                        callback({
                            content: accumulatedContent,
                            done: true
                        });
                        return;
                    }

                    // Decode the chunk and add it to our buffer
                    buffer += decoder.decode(value, { stream: true });

                    // Process complete lines
                    const lines = buffer.split('\n');
                    // Keep the last line in the buffer if it's incomplete
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        if (trimmedLine.startsWith('data: ')) {
                            const data = trimmedLine.slice(6).trim();

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
                            } catch (parseError) {
                                logger.error('Error parsing streaming response from Google', parseError);
                            }
                        }
                    }

                    // Continue processing chunks
                    await processChunk();
                } catch (error) {
                    logger.error('Error reading stream from Google', error);
                    callback({
                        content: `Error reading stream: ${error instanceof Error ? error.message : String(error)}`,
                        done: true
                    });
                }
            };

            // Start processing the stream
            await processChunk();
        } catch (error) {
            logger.error('Failed to stream chat completion from Google', error);

            callback({
                content: `Failed to stream chat completion: ${error instanceof Error ? error.message : String(error)}`,
                done: true
            });
        }
    }
}
