import { logger } from '../../utils/logger';
import { VectorStoreService, SearchResult } from '../vectorstore/vectorStoreService';
import { EmbeddingService } from '../embedding/embeddingService';
import { LLMService, ChatMessage, ChatCompletionOptions } from '../llm/llmService';
import { ModelContextProtocolService } from '../mcp/modelContextProtocolService';
import { MCPActionHandler } from '../action/mcpActionHandler';

/**
 * Interface for RAG options
 */
export interface RAGOptions {
    maxContextLength?: number;
    maxResults?: number;
    minScore?: number;
    includeSystemPrompt?: boolean;
    systemPrompt?: string;
    useMCP?: boolean; // Whether to use Model Context Protocol if available
}

/**
 * RAG Orchestrator class
 */
export class RAGOrchestrator {
    private vectorStore: VectorStoreService;
    private embeddingService: EmbeddingService;
    private llmService: LLMService;
    private mcpService: ModelContextProtocolService;
    private mcpActionHandler: MCPActionHandler;

    /**
     * Constructor
     * @param vectorStore The vector store service
     * @param embeddingService The embedding service
     * @param llmService The LLM service
     */
    constructor(
        vectorStore: VectorStoreService,
        embeddingService: EmbeddingService,
        llmService: LLMService
    ) {
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
        this.llmService = llmService;
        this.mcpService = ModelContextProtocolService.getInstance();
        this.mcpActionHandler = MCPActionHandler.getInstance();
    }

    /**
     * Query the LLM with RAG
     * @param query The query
     * @param options The RAG options
     */
    async query(query: string, options?: RAGOptions): Promise<string> {
        try {
            // Generate embedding for the query
            const [queryEmbedding] = await this.embeddingService.generateEmbeddings([query]);

            // Search for relevant documents
            const searchResults = await this.vectorStore.similaritySearch(queryEmbedding, {
                limit: options?.maxResults || 5,
                minScore: options?.minScore || 0.1  // Lower threshold to get more results
            });

            logger.debug(`Found ${searchResults.length} relevant documents for query`, {
                query: query.substring(0, 100),
                resultCount: searchResults.length
            });

            // Check if we should use MCP and if the LLM service supports it
            const useMCP = options?.useMCP && this.llmService.supportsMCP();

            if (useMCP) {
                // Create MCP context items from search results
                const contextItems = this.mcpService.createContextItemsFromRAGResults(searchResults);

                // Create messages with context items
                const messages: ChatMessage[] = [];

                // Add system prompt if enabled
                if (options?.includeSystemPrompt !== false) {
                    const systemPrompt = options?.systemPrompt ||
                        'You are PraxCode, a helpful AI coding assistant. Use the provided context to provide accurate and helpful responses.';

                    messages.push({
                        role: 'system',
                        content: systemPrompt
                    });
                }

                // Add user message with query
                messages.push({
                    role: 'user',
                    content: query,
                    contextItems: contextItems
                });

                // Query the LLM with MCP
                const chatOptions: ChatCompletionOptions = {
                    ...options,
                    useMCP: true
                };

                const response = await this.llmService.chat(messages, chatOptions);

                return response.content;
            } else {
                // Use traditional text-based approach
                // Assemble the prompt
                const messages = this.assemblePrompt(query, searchResults, options);

                // Query the LLM
                const response = await this.llmService.chat(messages);

                return response.content;
            }
        } catch (error) {
            logger.error('Failed to query with RAG', error);
            throw new Error(`Failed to query with RAG: ${error}`);
        }
    }

    /**
     * Stream query results from the LLM with RAG
     * @param query The query
     * @param callback The callback to receive streaming responses
     * @param options The RAG options
     */
    async streamQuery(
        query: string,
        callback: (content: string, done: boolean) => void,
        options?: RAGOptions
    ): Promise<void> {
        try {
            logger.debug(`Starting RAG query: "${query.substring(0, 100)}..."`);

            // Check if the query is empty
            if (!query.trim()) {
                callback("Please provide a query to search for relevant code.", true);
                return;
            }

            // Generate embedding for the query
            logger.debug("Generating embedding for query");
            let queryEmbedding: number[];
            try {
                [queryEmbedding] = await this.embeddingService.generateEmbeddings([query]);
                logger.debug(`Generated embedding with dimension: ${queryEmbedding.length}`);
            } catch (embeddingError) {
                logger.error('Failed to generate embedding for query', embeddingError);
                callback(`I'm having trouble processing your query. Please try again or check if Ollama is running properly.`, true);
                return;
            }

            // Search for relevant documents
            logger.debug("Searching for relevant documents");
            let searchResults: SearchResult[] = [];
            try {
                searchResults = await this.vectorStore.similaritySearch(queryEmbedding, {
                    limit: options?.maxResults || 5,
                    minScore: options?.minScore || 0.1  // Lower threshold to get more results
                });

                logger.debug(`Found ${searchResults.length} relevant documents for query`, {
                    resultCount: searchResults.length
                });

                // Log some details about the search results
                if (searchResults.length > 0) {
                    const sampleResults = searchResults.slice(0, Math.min(3, searchResults.length));
                    logger.debug("Sample search results:",
                        sampleResults.map(r => ({
                            filePath: r.document.metadata.filePath,
                            score: r.score,
                            textLength: r.document.text.length
                        }))
                    );
                } else {
                    logger.warn("No relevant documents found for query");
                    // We'll continue with just the query, but log a warning
                }
            } catch (searchError) {
                logger.error('Failed to search for relevant documents', searchError);
                // Continue with empty results rather than failing
                searchResults = [];
            }

            // Check if we should use MCP and if the LLM service supports it
            const useMCP = options?.useMCP && this.llmService.supportsMCP();
            logger.debug(`Using MCP: ${useMCP}`);

            // If we have no context, inform the user
            if (searchResults.length === 0) {
                callback("I don't have any specific context about your codebase yet. Please make sure you've indexed your workspace using the 'PraxCode: Index Workspace' command. I'll try to help with general knowledge.", false);
            }

            if (useMCP) {
                // Create MCP context items from search results
                logger.debug("Creating MCP context items from search results");
                const contextItems = this.mcpService.createContextItemsFromRAGResults(searchResults);
                logger.debug(`Created ${contextItems.length} MCP context items`);

                // Create messages with context items
                const messages: ChatMessage[] = [];

                // Add system prompt if enabled
                if (options?.includeSystemPrompt !== false) {
                    const systemPrompt = options?.systemPrompt ||
                        'You are PraxCode, a helpful AI coding assistant. Use the provided context to provide accurate and helpful responses.';

                    messages.push({
                        role: 'system',
                        content: systemPrompt
                    });
                }

                // Add user message with query
                messages.push({
                    role: 'user',
                    content: query,
                    contextItems: contextItems
                });

                logger.debug(`Assembled ${messages.length} messages with MCP context items`, {
                    roles: messages.map(m => m.role),
                    contextItemCount: contextItems.length
                });

                // Stream the response from the LLM with MCP
                logger.debug("Streaming response from LLM with MCP");
                const chatOptions: ChatCompletionOptions = {
                    ...options,
                    useMCP: true,
                    stream: true
                };

                await this.llmService.streamChat(
                    messages,
                    (response) => {
                        callback(response.content, response.done);

                        // Process any context items in the response if needed
                        if (response.contextItems && response.contextItems.length > 0) {
                            logger.debug(`Received ${response.contextItems.length} context items in response`);

                            // Process actions from context items
                            this.mcpActionHandler.processContextItems(response.contextItems)
                                .then(actionsProcessed => {
                                    if (actionsProcessed) {
                                        logger.info('Processed actions from MCP response');
                                    }
                                })
                                .catch(error => {
                                    logger.error('Error processing MCP actions', error);
                                });
                        }

                        if (response.done) {
                            logger.debug("Completed streaming response from LLM with MCP");
                        }
                    },
                    chatOptions
                );
            } else {
                // Use traditional text-based approach
                // Assemble the prompt
                logger.debug("Assembling prompt with context");
                const messages = this.assemblePrompt(query, searchResults, options);

                // Log the number of messages and their roles
                logger.debug(`Assembled ${messages.length} messages for the prompt`, {
                    roles: messages.map(m => m.role)
                });

                // Stream the response from the LLM
                logger.debug("Streaming response from LLM");
                await this.llmService.streamChat(
                    messages,
                    (response) => {
                        callback(response.content, response.done);

                        if (response.done) {
                            logger.debug("Completed streaming response from LLM");
                        }
                    }
                );
            }
        } catch (error) {
            logger.error('Failed to stream query with RAG', error);
            callback(`I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}. Please try again or check the logs for more details.`, true);
        }
    }

    /**
     * Assemble the prompt with retrieved context
     * @param query The query
     * @param searchResults The search results
     * @param options The RAG options
     */
    private assemblePrompt(query: string, searchResults: SearchResult[], options?: RAGOptions): ChatMessage[] {
        const messages: ChatMessage[] = [];

        // Add system prompt if enabled
        if (options?.includeSystemPrompt !== false) {
            const systemPrompt = options?.systemPrompt ||
                'You are PraxCode, a helpful AI coding assistant. Use the following code context to provide accurate and helpful responses. When referencing code from the context, cite the file path. If no context is provided or the context is insufficient, acknowledge this and provide the best general guidance you can.';

            messages.push({
                role: 'system',
                content: systemPrompt
            });
        }

        // Add context from search results
        if (searchResults.length > 0) {
            let contextContent = 'Here is relevant code from the workspace:\n\n';

            for (const result of searchResults) {
                const doc = result.document;
                const filePath = doc.metadata.filePath;
                const startLine = doc.metadata.startLine;
                const endLine = doc.metadata.endLine;
                const language = doc.metadata.language || 'text';
                const score = result.score.toFixed(2); // Format score to 2 decimal places

                contextContent += `File: ${filePath}${startLine ? ` (Lines ${startLine}-${endLine})` : ''} [Relevance: ${score}]\n`;
                contextContent += '```' + language + '\n';
                contextContent += doc.text + '\n';
                contextContent += '```\n\n';
            }

            // Add a separator between context and query
            contextContent += "-----\n\n";

            messages.push({
                role: 'user',
                content: contextContent + `User query: ${query}`
            });
        } else {
            // No context found, just use the query but add a note
            messages.push({
                role: 'system',
                content: 'Note: No relevant code context was found in the workspace for this query. Please provide a general response based on your knowledge.'
            });

            messages.push({
                role: 'user',
                content: query
            });
        }

        return messages;
    }
}
