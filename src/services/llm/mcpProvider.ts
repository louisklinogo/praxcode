import axios from 'axios';
import {
    LLMService,
    ChatMessage,
    ChatCompletionOptions,
    ChatCompletionResponse,
    StreamingChatCompletionResponse
} from './llmService';
import { logger } from '../../utils/logger';
import { MCPContextItem, MCPRequest, MCPResponse } from '../mcp/modelContextProtocolService';

/**
 * MCP Provider implementation
 * This provider connects to an LLM server that supports the Model Context Protocol
 */
export class MCPProvider implements LLMService {
    private apiKey: string | null;
    private model: string;
    private baseUrl: string;

    /**
     * Constructor
     * @param apiKey The API key for the MCP provider (optional for some endpoints)
     * @param model The model to use
     * @param baseUrl The base URL for the MCP provider API
     */
    constructor(apiKey: string | null = null, model: string = 'default', baseUrl: string = 'http://localhost:8000') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'MCP Provider';
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            // Prepare headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // Add Authorization header only if API key is provided
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await axios.get(
                `${this.baseUrl}/models`,
                { headers }
            );

            return response.data.models || ['default'];
        } catch (error) {
            logger.error('Failed to get available models from MCP provider', error);
            return ['default']; // Return a default model if the API call fails
        }
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return true; // This provider is specifically for MCP
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
            // Format messages for the MCP API
            const mcpMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                context_items: msg.contextItems || []
            }));

            // Prepare the MCP request
            const mcpRequest: MCPRequest = {
                messages: mcpMessages,
                model: this.model,
                temperature: options?.temperature || 0.7,
                max_tokens: options?.maxTokens,
                stop: options?.stopSequences,
                stream: false
            };

            // Prepare headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // Add Authorization header only if API key is provided
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            // Make the API request
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                mcpRequest,
                { headers }
            );

            const data = response.data as MCPResponse;

            // Extract the response content and context items
            return {
                content: data.message.content,
                model: this.model,
                contextItems: data.message.context_items,
                usage: data.usage ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens
                } : undefined
            };
        } catch (error) {
            logger.error('Failed to get chat completion from MCP provider', error);

            if (axios.isAxiosError(error)) {
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    logger.error('MCP provider API error response', {
                        status: error.response.status,
                        data: error.response.data
                    });
                    throw new Error(`MCP provider API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                } else if (error.request) {
                    // The request was made but no response was received
                    logger.error('No response received from MCP provider API');
                    throw new Error('No response received from MCP provider API. Please check your connection and the server status.');
                }
            }

            // Something happened in setting up the request that triggered an Error
            throw new Error(`Failed to get chat completion from MCP provider: ${error instanceof Error ? error.message : String(error)}`);
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
            // Format messages for the MCP API
            const mcpMessages = messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                context_items: msg.contextItems || []
            }));

            // Prepare the MCP request
            const mcpRequest: MCPRequest = {
                messages: mcpMessages,
                model: this.model,
                temperature: options?.temperature || 0.7,
                max_tokens: options?.maxTokens,
                stop: options?.stopSequences,
                stream: true
            };

            // Prepare headers
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // Add Authorization header only if API key is provided
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            // Make the API request
            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                mcpRequest,
                {
                    headers,
                    responseType: 'stream'
                }
            );

            // Process the streaming response
            const stream = response.data;
            let buffer = '';

            stream.on('data', (chunk: Buffer) => {
                const chunkStr = chunk.toString();
                buffer += chunkStr;

                // Process complete JSON objects
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex).trim();
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.startsWith('data: ')) {
                        const jsonStr = line.substring(6).trim();

                        if (jsonStr === '[DONE]') {
                            callback({
                                content: '',
                                done: true
                            });
                            return;
                        }

                        try {
                            const data = JSON.parse(jsonStr) as MCPResponse;
                            callback({
                                content: data.message.content,
                                contextItems: data.message.context_items,
                                done: false
                            });
                        } catch (parseError) {
                            logger.error('Error parsing streaming response from MCP provider', parseError);
                        }
                    }
                }
            });

            stream.on('end', () => {
                callback({
                    content: '',
                    done: true
                });
            });

            stream.on('error', (error: Error) => {
                logger.error('Stream error from MCP provider', error);
                callback({
                    content: `Error: ${error.message}`,
                    done: true
                });
            });
        } catch (error) {
            logger.error('Failed to stream chat completion from MCP provider', error);

            if (axios.isAxiosError(error)) {
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    logger.error('MCP provider API error response', {
                        status: error.response.status,
                        data: error.response.data
                    });
                    callback({
                        content: `MCP provider API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
                        done: true
                    });
                    return;
                } else if (error.request) {
                    // The request was made but no response was received
                    logger.error('No response received from MCP provider API');
                    callback({
                        content: 'No response received from MCP provider API. Please check your connection and the server status.',
                        done: true
                    });
                    return;
                }
            }

            // Something happened in setting up the request that triggered an Error
            callback({
                content: `Failed to stream chat completion from MCP provider: ${error instanceof Error ? error.message : String(error)}`,
                done: true
            });
        }
    }
}
