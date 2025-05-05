import axios from 'axios';
import {
    LLMService,
    ChatMessage,
    ChatCompletionOptions,
    ChatCompletionResponse,
    StreamingChatCompletionResponse
} from './llmService';
import { logger } from '../../utils/logger';
import { MCPContextItem } from '../mcp/modelContextProtocolService';

/**
 * Ollama API response interface
 */
interface OllamaResponse {
    model: string;
    created_at: string;
    message: {
        role: string;
        content: string;
    };
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

/**
 * Ollama Provider implementation
 */
export class OllamaProvider implements LLMService {
    private baseUrl: string;
    private model: string;

    /**
     * Constructor
     * @param baseUrl The base URL for the Ollama API
     * @param model The model to use
     */
    constructor(baseUrl: string, model: string) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.model = model;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'Ollama';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false; // Ollama doesn't natively support MCP
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            // First check if Ollama is running by making a simple request
            await axios.get(`${this.baseUrl}/api/version`, { timeout: 2000 });

            const response = await axios.get(`${this.baseUrl}/api/tags`);
            if (response.data && response.data.models) {
                return response.data.models.map((model: any) => model.name);
            }
            return [];
        } catch (error) {
            logger.error('Failed to get available models from Ollama', error);

            // Provide a more user-friendly error message
            if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
                throw new Error(`Cannot connect to Ollama at ${this.baseUrl}. Please make sure Ollama is running.`);
            } else if (axios.isAxiosError(error) && error.response?.status === 404) {
                throw new Error(`Ollama API endpoint not found. Please check your Ollama installation and URL (${this.baseUrl}).`);
            } else {
                throw new Error(`Failed to get available models: ${error instanceof Error ? error.message : String(error)}`);
            }
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
            // Check if Ollama is running first
            try {
                await axios.get(`${this.baseUrl}/api/version`, { timeout: 2000 });
            } catch (connError) {
                if (axios.isAxiosError(connError)) {
                    if (connError.code === 'ECONNREFUSED') {
                        throw new Error(`Cannot connect to Ollama at ${this.baseUrl}. Please make sure Ollama is running.`);
                    } else if (connError.response?.status === 404) {
                        throw new Error(`Ollama API endpoint not found. Please check your Ollama installation and URL (${this.baseUrl}).`);
                    }
                }
                throw connError;
            }

            // Check if MCP is requested, but since Ollama doesn't support it natively,
            // we'll just log a warning and proceed with the standard approach
            if (options?.useMCP) {
                logger.warn('MCP requested but Ollama does not support it natively. Proceeding with standard text-based approach.');

                // If there are context items, we'll need to convert them to text
                const messagesWithContextAsText = this.convertMCPContextToText(messages);

                // Now try to make the actual chat request with the converted messages
                const response = await axios.post(`${this.baseUrl}/api/chat`, {
                    model: this.model,
                    messages: messagesWithContextAsText.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    options: {
                        temperature: options?.temperature ?? 0.7,
                        num_predict: options?.maxTokens,
                        stop: options?.stopSequences
                    }
                });

                // Process the response
                const responseData = response.data;

                return {
                    content: responseData.message?.content || '',
                    model: this.model
                };
            }

            // Standard approach without MCP
            const response = await axios.post(`${this.baseUrl}/api/chat`, {
                model: this.model,
                messages: messages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                options: {
                    temperature: options?.temperature ?? 0.7,
                    num_predict: options?.maxTokens,
                    stop: options?.stopSequences
                }
            });

            const data = response.data;

            return {
                content: data.message.content,
                model: data.model,
                usage: {
                    promptTokens: data.prompt_eval_count || 0,
                    completionTokens: data.eval_count || 0,
                    totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                }
            };
        } catch (error) {
            logger.error('Failed to get chat completion from Ollama', error);

            // Provide more user-friendly error messages
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED') {
                    throw new Error(`Cannot connect to Ollama at ${this.baseUrl}. Please make sure Ollama is running.`);
                } else if (error.response?.status === 404) {
                    if (error.config?.url?.includes('/api/chat')) {
                        throw new Error(`Model "${this.model}" not found. Please make sure you have pulled this model with "ollama pull ${this.model}".`);
                    } else {
                        throw new Error(`Ollama API endpoint not found. Please check your Ollama installation and URL (${this.baseUrl}).`);
                    }
                } else if (error.response?.status === 500) {
                    throw new Error(`Ollama server error. Please check the Ollama logs for more details.`);
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
            // Check if Ollama is running first
            try {
                await axios.get(`${this.baseUrl}/api/version`, { timeout: 2000 });
            } catch (connError) {
                if (axios.isAxiosError(connError)) {
                    if (connError.code === 'ECONNREFUSED') {
                        callback({
                            content: `Cannot connect to Ollama at ${this.baseUrl}. Please make sure Ollama is running.`,
                            done: true
                        });
                        return;
                    } else if (connError.response?.status === 404) {
                        callback({
                            content: `Ollama API endpoint not found. Please check your Ollama installation and URL (${this.baseUrl}).`,
                            done: true
                        });
                        return;
                    }
                }
                callback({
                    content: `Error connecting to Ollama: ${connError instanceof Error ? connError.message : String(connError)}`,
                    done: true
                });
                return;
            }

            // Check if MCP is requested, but since Ollama doesn't support it natively,
            // we'll just log a warning and proceed with the standard approach
            if (options?.useMCP) {
                logger.warn('MCP requested but Ollama does not support it natively. Proceeding with standard text-based approach.');

                // If there are context items, we'll need to convert them to text
                const messagesWithContextAsText = this.convertMCPContextToText(messages);

                // Now try to make the actual chat request with the converted messages
                const response = await axios.post(
                    `${this.baseUrl}/api/chat`,
                    {
                        model: this.model,
                        messages: messagesWithContextAsText.map(msg => ({
                            role: msg.role,
                            content: msg.content
                        })),
                        options: {
                            temperature: options?.temperature ?? 0.7,
                            num_predict: options?.maxTokens,
                            stop: options?.stopSequences
                        },
                        stream: true
                    },
                    {
                        responseType: 'stream'
                    }
                );

                // This is a streaming response, so we don't need to return anything
                // The callback will be called with the streaming data
                return;
            }

            // Standard approach without MCP
            const response = await axios.post(
                `${this.baseUrl}/api/chat`,
                {
                    model: this.model,
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    options: {
                        temperature: options?.temperature ?? 0.7,
                        num_predict: options?.maxTokens,
                        stop: options?.stopSequences
                    },
                    stream: true
                },
                {
                    responseType: 'stream'
                }
            );

            const stream = response.data;
            let buffer = '';

            // Track the accumulated content
            let accumulatedContent = '';

            stream.on('data', (chunk: Buffer) => {
                const chunkStr = chunk.toString();
                buffer += chunkStr;

                // Process complete JSON objects
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex);
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line.trim()) {
                        try {
                            const data = JSON.parse(line) as OllamaResponse;

                            // Accumulate content instead of just sending the current chunk
                            if (data.message && data.message.content) {
                                accumulatedContent += data.message.content;

                                // Send the accumulated content so far
                                callback({
                                    content: accumulatedContent,
                                    done: data.done
                                });
                            }
                        } catch (error) {
                            logger.error('Failed to parse streaming response', error);
                        }
                    }
                }
            });

            stream.on('end', () => {
                // Process any remaining data
                if (buffer.trim()) {
                    try {
                        const data = JSON.parse(buffer) as OllamaResponse;
                        if (data.message && data.message.content) {
                            accumulatedContent += data.message.content;
                        }
                    } catch (error) {
                        logger.error('Failed to parse final streaming response', error);
                    }
                }

                // Ensure we mark the stream as done with the final accumulated content
                if (accumulatedContent) {
                    callback({
                        content: accumulatedContent,
                        done: true
                    });
                } else {
                    callback({
                        content: 'No response received from the model. Please try again.',
                        done: true
                    });
                }
            });

            stream.on('error', (error: Error) => {
                logger.error('Error in streaming response', error);

                // If we have accumulated content, send that with the error appended
                if (accumulatedContent) {
                    callback({
                        content: `${accumulatedContent}\n\nError: ${error.message}`,
                        done: true
                    });
                } else {
                    callback({
                        content: `Error: ${error.message}`,
                        done: true
                    });
                }
            });
        } catch (error) {
            logger.error('Failed to get streaming chat completion from Ollama', error);

            // Provide more user-friendly error messages
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED') {
                    callback({
                        content: `Cannot connect to Ollama at ${this.baseUrl}. Please make sure Ollama is running.`,
                        done: true
                    });
                } else if (error.response?.status === 404) {
                    if (error.config?.url?.includes('/api/chat')) {
                        callback({
                            content: `Model "${this.model}" not found. Please make sure you have pulled this model with "ollama pull ${this.model}".`,
                            done: true
                        });
                    } else {
                        callback({
                            content: `Ollama API endpoint not found. Please check your Ollama installation and URL (${this.baseUrl}).`,
                            done: true
                        });
                    }
                } else if (error.response?.status === 500) {
                    callback({
                        content: `Ollama server error. Please check the Ollama logs for more details.`,
                        done: true
                    });
                } else {
                    callback({
                        content: `Error: ${error.message || 'Unknown error'}`,
                        done: true
                    });
                }
            } else {
                callback({
                    content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    done: true
                });
            }
        }
    }

    /**
     * Convert MCP context items to text format for providers that don't support MCP natively
     * @param messages The messages with potential MCP context items
     * @returns Messages with context items converted to text
     */
    private convertMCPContextToText(messages: ChatMessage[]): ChatMessage[] {
        return messages.map(msg => {
            if (!msg.contextItems || msg.contextItems.length === 0) {
                return msg; // No context items, return as is
            }

            // Convert context items to text
            let contextText = '\n\nContext Information:\n\n';

            for (const item of msg.contextItems) {
                const type = item.type;
                const content = item.content;
                const metadata = item.metadata || {};

                // Format based on type
                switch (type) {
                    case 'code':
                        const language = metadata.language || 'text';
                        const filePath = metadata.filePath || 'unknown';
                        const startLine = metadata.startLine;
                        const endLine = metadata.endLine;

                        contextText += `File: ${filePath}${startLine ? ` (Lines ${startLine}-${endLine})` : ''}\n`;
                        contextText += '```' + language + '\n';
                        contextText += content + '\n';
                        contextText += '```\n\n';
                        break;

                    case 'file':
                        const fileLanguage = metadata.language || 'text';
                        const path = metadata.filePath || 'unknown';

                        contextText += `File: ${path}\n`;
                        contextText += '```' + fileLanguage + '\n';
                        contextText += content + '\n';
                        contextText += '```\n\n';
                        break;

                    case 'diagnostic':
                        contextText += `Diagnostics for ${metadata.filePath || 'unknown'}:\n`;
                        contextText += content + '\n\n';
                        break;

                    case 'terminal':
                        contextText += `Terminal Output (${metadata.terminalName || 'unknown'}):\n`;
                        contextText += '```\n';
                        contextText += content + '\n';
                        contextText += '```\n\n';
                        break;

                    case 'diff':
                        contextText += `Diff for ${metadata.filePath || 'unknown'}:\n`;
                        contextText += '```diff\n';
                        contextText += content + '\n';
                        contextText += '```\n\n';
                        break;

                    default:
                        contextText += `${type.charAt(0).toUpperCase() + type.slice(1)}:\n`;
                        contextText += content + '\n\n';
                }
            }

            // Return a new message with the context appended to the content
            return {
                role: msg.role,
                content: msg.content + contextText
            };
        });
    }
}
