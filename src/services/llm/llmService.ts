import { MCPContextItem } from '../mcp/modelContextProtocolService';

/**
 * Interface for chat message
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    contextItems?: MCPContextItem[]; // Optional MCP context items
}

/**
 * Interface for chat completion options
 */
export interface ChatCompletionOptions {
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    stream?: boolean;
    useMCP?: boolean; // Whether to use Model Context Protocol if available
}

/**
 * Interface for chat completion response
 */
export interface ChatCompletionResponse {
    content: string;
    model: string;
    contextItems?: MCPContextItem[]; // Optional MCP context items in response
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Interface for streaming chat completion
 */
export interface StreamingChatCompletionResponse {
    content: string;
    done: boolean;
    contextItems?: MCPContextItem[]; // Optional MCP context items in streaming response
}

/**
 * Abstract LLM Service interface
 */
export abstract class LLMService {
    /**
     * Get the name of the LLM service
     */
    abstract getName(): string;

    /**
     * Get the available models for this service
     */
    abstract getAvailableModels(): Promise<string[]>;

    /**
     * Check if this service supports the Model Context Protocol
     */
    abstract supportsMCP(): boolean;

    /**
     * Send a chat completion request
     * @param messages The messages to send
     * @param options The completion options
     */
    abstract chat(
        messages: ChatMessage[],
        options?: ChatCompletionOptions
    ): Promise<ChatCompletionResponse>;

    /**
     * Send a streaming chat completion request
     * @param messages The messages to send
     * @param callback The callback to receive streaming responses
     * @param options The completion options
     */
    abstract streamChat(
        messages: ChatMessage[],
        callback: (response: StreamingChatCompletionResponse) => void,
        options?: ChatCompletionOptions
    ): Promise<void>;
}
