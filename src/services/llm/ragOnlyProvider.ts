import {
    LLMService,
    ChatMessage,
    ChatCompletionOptions,
    ChatCompletionResponse,
    StreamingChatCompletionResponse
} from './llmService';
import { logger } from '../../utils/logger';

/**
 * RAG-Only Provider implementation
 * This provider doesn't actually connect to an LLM but serves as a placeholder
 * for the RAG-only mode where only vector search results are shown
 */
export class RAGOnlyProvider implements LLMService {
    private model: string;

    /**
     * Constructor
     * @param model The model name to display
     */
    constructor(model: string = 'rag-only') {
        this.model = model;
    }

    /**
     * Get the name of the LLM service
     */
    getName(): string {
        return 'RAG-Only Mode';
    }

    /**
     * Check if this service supports the Model Context Protocol
     */
    supportsMCP(): boolean {
        return false;
    }

    /**
     * Get the available models for this service
     */
    async getAvailableModels(): Promise<string[]> {
        // Only one model for RAG-only mode
        return ['rag-only'];
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
        // This provider doesn't actually send requests to an LLM
        // It's just a placeholder for RAG-only mode
        return {
            content: "RAG-Only mode is active. No LLM is being used. Please check the RAG results instead.",
            model: this.model
        };
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
        // This provider doesn't actually send requests to an LLM
        // It's just a placeholder for RAG-only mode
        callback({
            content: "RAG-Only mode is active. No LLM is being used. Please check the RAG results instead.",
            done: true
        });
    }
}
