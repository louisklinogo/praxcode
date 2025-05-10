import { logger } from '../../utils/logger';
import { VectorStoreService, SearchResult } from '../vectorstore/vectorStoreService';
import { EmbeddingService } from '../embedding/embeddingService';
import { LLMService, ChatMessage, ChatCompletionOptions } from '../llm/llmService';
import { ModelContextProtocolService } from '../mcp/modelContextProtocolService';
import { MCPActionHandler } from '../action/mcpActionHandler';
import { LLMAvailabilityService } from '../llm/llmAvailabilityService';
import { ConfigurationManager } from '../../utils/configurationManager';
import * as path from 'path';

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
    forceRagOnlyMode?: boolean; // Force RAG-only mode even if LLM is available
}

/**
 * Interface for RAG-only search results
 */
export interface RAGOnlyResults {
    searchResults: SearchResult[];
    query: string;
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
    private llmAvailabilityService: LLMAvailabilityService;
    private configManager: ConfigurationManager;

    /**
     * Constructor
     * @param vectorStore The vector store service
     * @param embeddingService The embedding service
     * @param llmService The LLM service
     * @param configManager The configuration manager
     */
    constructor(
        vectorStore: VectorStoreService,
        embeddingService: EmbeddingService,
        llmService: LLMService,
        configManager: ConfigurationManager
    ) {
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
        this.llmService = llmService;
        this.configManager = configManager;
        this.mcpService = ModelContextProtocolService.getInstance();
        this.mcpActionHandler = MCPActionHandler.getInstance();
        this.llmAvailabilityService = LLMAvailabilityService.getInstance(configManager);
    }

    /**
     * Check if RAG-only mode should be used
     * @param options The RAG options
     * @returns A promise that resolves to a boolean indicating if RAG-only mode should be used
     */
    public async shouldUseRagOnlyMode(options?: RAGOptions): Promise<boolean> {
        try {
            const config = this.configManager.getConfiguration();
            logger.debug(`Checking if RAG-only mode should be used. Current provider: ${config.llmProvider}, model: ${config.llmProvider === 'ollama' ? config.ollamaModel : 'n/a'}`);
            logger.debug(`RAG-only mode enabled: ${config.ragOnlyModeEnabled}, forced: ${config.ragOnlyModeForceEnabled}`);
            logger.debug(`Options: ${JSON.stringify(options)}`);

            // Check if RAG-only mode is explicitly forced in options
            if (options?.forceRagOnlyMode) {
                logger.debug('RAG-only mode forced by options');
                return true;
            }

            // Check if RAG-only mode is forced in configuration
            if (config.ragOnlyModeForceEnabled) {
                logger.debug('RAG-only mode forced by configuration');
                return true;
            }

            // Check if provider is explicitly set to "none"
            if (config.llmProvider === 'none') {
                logger.debug('LLM provider is set to "none", using RAG-only mode');
                return true;
            }

            // IMPORTANT: For Ollama, we NEVER use RAG-only mode unless explicitly forced
            // This allows users to select Ollama models even if Ollama isn't currently running
            if (config.llmProvider === 'ollama') {
                logger.debug(`Ollama provider selected (model: ${config.ollamaModel}), NEVER using RAG-only mode`);

                // Log the current LLM service to help diagnose issues
                logger.debug(`Current LLM service: ${this.llmService.getName()}`);

                // Always return false for Ollama to ensure we try to use it
                // The Ollama provider will handle connection errors gracefully
                return false;
            }

            // For other providers, check if RAG-only mode is enabled and LLM is not available
            if (config.ragOnlyModeEnabled) {
                const llmAvailable = await this.llmAvailabilityService.isLLMAvailable();
                logger.debug(`LLM availability check result: ${llmAvailable}`);
                if (!llmAvailable) {
                    logger.debug('RAG-only mode enabled and LLM is not available');
                    return true;
                }
            }

            logger.debug('Using LLM for query (not in RAG-only mode)');
            return false;
        } catch (error) {
            logger.error('Error checking if RAG-only mode should be used', error);
            return false;
        }
    }

    /**
     * Get RAG-only results for a query
     * @param query The query
     * @param options The RAG options
     * @returns A promise that resolves to the RAG-only results
     */
    public async getRagOnlyResults(query: string, options?: RAGOptions): Promise<RAGOnlyResults> {
        try {
            // Generate embedding for the query
            const [queryEmbedding] = await this.embeddingService.generateEmbeddings([query]);

            // Get the configured minimum relevance score
            const config = this.configManager.getConfiguration();
            const minRelevanceScore = options?.minScore || config.ragMinRelevanceScore;

            // Search for relevant documents with the configured minimum score threshold
            const searchResults = await this.vectorStore.similaritySearch(queryEmbedding, {
                limit: options?.maxResults || 5,
                minScore: minRelevanceScore
            });

            logger.debug(`Found ${searchResults.length} relevant documents for RAG-only query`, {
                query: query.substring(0, 100),
                resultCount: searchResults.length
            });

            // If we have too few results with the higher threshold, try again with a lower one
            if (searchResults.length < 2) {
                logger.debug('Few results with high threshold, trying with lower threshold');
                const moreResults = await this.vectorStore.similaritySearch(queryEmbedding, {
                    limit: options?.maxResults || 5,
                    minScore: 0.1  // Lower threshold as fallback
                });

                logger.debug(`Found ${moreResults.length} documents with lower threshold`);

                // Only return the results if we found more than before
                if (moreResults.length > searchResults.length) {
                    return {
                        searchResults: moreResults,
                        query
                    };
                }
            }

            return {
                searchResults,
                query
            };
        } catch (error) {
            logger.error('Failed to get RAG-only results', error);
            throw new Error(`Failed to get RAG-only results: ${error}`);
        }
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

            // Log the current LLM service and configuration
            const config = this.configManager.getConfiguration();
            logger.debug(`Current LLM provider: ${config.llmProvider}, model: ${config.llmProvider === 'ollama' ? config.ollamaModel : 'n/a'}`);
            logger.debug(`Current LLM service: ${this.llmService.getName()}`);
            logger.debug(`RAG options: ${JSON.stringify(options)}`);

            // Check if the query is empty
            if (!query.trim()) {
                callback("Please provide a query to search for relevant code.", true);
                return;
            }

            // Check if we should use RAG-only mode
            const useRagOnlyMode = await this.shouldUseRagOnlyMode(options);
            logger.debug(`Should use RAG-only mode: ${useRagOnlyMode}`);
            if (useRagOnlyMode) {
                logger.info('Using RAG-only mode for query');

                try {
                    // Get RAG-only results
                    const ragOnlyResults = await this.getRagOnlyResults(query, options);

                    // Check if we have any results
                    if (ragOnlyResults.searchResults.length === 0) {
                        const noResultsMessage = `## No Relevant Code Found

I searched for code related to: **${query}**

No code snippets with sufficient relevance were found in the indexed codebase. This could be because:

1. The code you're looking for might not exist in the indexed files
2. The query terms might not match the terminology used in the code
3. The workspace might not be fully indexed

### Suggestions:
- Try using different search terms
- Make sure your workspace is indexed using the 'PraxCode: Index Workspace' command
- Check if the file you're looking for is included in the indexing patterns in settings`;

                        callback(noResultsMessage, true);
                        return;
                    }

                    // Format the results as a response with better context
                    let response = "";

                    // Check the provider type to give a more specific message
                    const config = this.configManager.getConfiguration();
                    if (config.llmProvider === 'ollama') {
                        // For Ollama, we'll try to use it even if it's not currently available
                        // But we'll still show a warning if we're in RAG-only mode
                        try {
                            // Try to connect to Ollama to see if it's running
                            const ollamaAvailable = await this.llmAvailabilityService.isLLMAvailable();
                            if (!ollamaAvailable) {
                                response = "## ⚠️ Ollama Connection Error\n\n";
                                response += "Cannot connect to Ollama at " + config.ollamaUrl + "\n\n";
                                response += "Please make sure:\n";
                                response += "1. Ollama is installed and running\n";
                                response += "2. The URL in settings is correct\n";
                                response += "3. No firewall is blocking the connection\n\n";
                                response += "Showing relevant codebase context for your query: **" + query + "**\n\n";
                            } else {
                                // This shouldn't happen since we're in RAG-only mode
                                response = "RAG-Only mode is active. Showing relevant codebase context for your query: **" + query + "**\n\n";
                            }
                        } catch (error) {
                            // If we can't even check availability, just show a generic message
                            response = "## ⚠️ Ollama Connection Error\n\n";
                            response += "Error connecting to Ollama. Please make sure Ollama is running.\n\n";
                            response += "Showing relevant codebase context for your query: **" + query + "**\n\n";
                        }
                    } else if (config.llmProvider === 'none') {
                        response = "RAG-Only mode is active. Showing relevant codebase context for your query: **" + query + "**\n\n";
                    } else {
                        response = "No LLM available. Showing relevant codebase context for your query: **" + query + "**\n\n";
                    }

                    // Add explanation about what the user is seeing
                    response += "The following code snippets were found based on semantic similarity to your query. ";
                    response += "They are ranked by relevance score (higher is better).\n\n";

                    // Sort results by score (highest first) to show most relevant first
                    const sortedResults = [...ragOnlyResults.searchResults].sort((a, b) => b.score - a.score);

                    // Add a summary of what was found
                    response += "### Summary of Results\n\n";
                    for (let i = 0; i < sortedResults.length; i++) {
                        const result = sortedResults[i];
                        const doc = result.document;
                        const filePath = path.basename(doc.metadata.filePath); // Just the filename for the summary
                        const score = result.score.toFixed(2);

                        response += `${i+1}. **${filePath}** - Relevance: ${score}\n`;
                    }

                    response += "\n### Detailed Results\n\n";

                    // Add the detailed results
                    for (const result of sortedResults) {
                        const doc = result.document;
                        const filePath = doc.metadata.filePath;
                        const startLine = doc.metadata.startLine;
                        const endLine = doc.metadata.endLine;
                        const language = doc.metadata.language || 'text';
                        const score = result.score.toFixed(2);

                        // Add more context about the file
                        response += `#### File: ${filePath}${startLine ? ` (Lines ${startLine}-${endLine})` : ''}\n`;
                        response += `Relevance Score: ${score}\n\n`;

                        // Add the code snippet
                        response += '```' + language + '\n';
                        response += doc.text + '\n';
                        response += '```\n\n';

                        // Add a separator between results for better readability
                        response += "---\n\n";
                    }

                    // Add a note about how to use this information
                    response += "**Note:** To get AI-powered explanations of this code, please configure a valid LLM provider in the settings.\n";

                    // Send the response
                    callback(response, true);
                    return;
                } catch (ragOnlyError) {
                    logger.error('Failed to get RAG-only results', ragOnlyError);
                    callback(`Error retrieving code context: ${ragOnlyError instanceof Error ? ragOnlyError.message : String(ragOnlyError)}. Please ensure your workspace is indexed.`, true);
                    return;
                }
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

                try {
                    // Check if we're using Ollama and log additional information
                    const config = this.configManager.getConfiguration();
                    if (config.llmProvider === 'ollama') {
                        logger.debug(`Using Ollama provider with model: ${config.ollamaModel}`);
                        logger.debug(`Ollama URL: ${config.ollamaUrl}`);
                        logger.debug(`LLM service name: ${this.llmService.getName()}`);
                    }

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
                } catch (streamError) {
                    logger.error('Error streaming chat with MCP', streamError);

                    // Check if we're using Ollama and provide a more helpful error message
                    const config = this.configManager.getConfiguration();
                    if (config.llmProvider === 'ollama') {
                        logger.error(`Ollama error: ${streamError instanceof Error ? streamError.message : String(streamError)}`);
                        callback(`## ⚠️ Ollama Connection Error\n\nCannot connect to Ollama at ${config.ollamaUrl}.\n\nPlease make sure:\n1. Ollama is installed and running\n2. The URL in settings is correct (${config.ollamaUrl})\n3. The model "${config.ollamaModel}" is available (run \`ollama pull ${config.ollamaModel}\`)\n\nError details: ${streamError instanceof Error ? streamError.message : String(streamError)}`, true);
                    } else {
                        callback(`Error streaming response: ${streamError instanceof Error ? streamError.message : String(streamError)}`, true);
                    }
                }
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
                try {
                    // Check if we're using Ollama and log additional information
                    const config = this.configManager.getConfiguration();
                    if (config.llmProvider === 'ollama') {
                        logger.debug(`Using Ollama provider with model: ${config.ollamaModel}`);
                        logger.debug(`Ollama URL: ${config.ollamaUrl}`);
                        logger.debug(`LLM service name: ${this.llmService.getName()}`);
                    }

                    await this.llmService.streamChat(
                        messages,
                        (response) => {
                            callback(response.content, response.done);

                            if (response.done) {
                                logger.debug("Completed streaming response from LLM");
                            }
                        }
                    );
                } catch (streamError) {
                    logger.error('Error streaming chat', streamError);

                    // Check if we're using Ollama and provide a more helpful error message
                    const config = this.configManager.getConfiguration();
                    if (config.llmProvider === 'ollama') {
                        logger.error(`Ollama error: ${streamError instanceof Error ? streamError.message : String(streamError)}`);
                        callback(`## ⚠️ Ollama Connection Error\n\nCannot connect to Ollama at ${config.ollamaUrl}.\n\nPlease make sure:\n1. Ollama is installed and running\n2. The URL in settings is correct (${config.ollamaUrl})\n3. The model "${config.ollamaModel}" is available (run \`ollama pull ${config.ollamaModel}\`)\n\nError details: ${streamError instanceof Error ? streamError.message : String(streamError)}`, true);
                    } else {
                        callback(`Error streaming response: ${streamError instanceof Error ? streamError.message : String(streamError)}`, true);
                    }
                }
            }
        } catch (error) {
            logger.error('Failed to stream query with RAG', error);

            // Check if we're using Ollama and provide a more helpful error message
            const config = this.configManager.getConfiguration();
            if (config.llmProvider === 'ollama') {
                logger.error(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
                callback(`## ⚠️ Ollama Connection Error\n\nCannot connect to Ollama at ${config.ollamaUrl}.\n\nPlease make sure:\n1. Ollama is installed and running\n2. The URL in settings is correct (${config.ollamaUrl})\n3. The model "${config.ollamaModel}" is available (run \`ollama pull ${config.ollamaModel}\`)\n\nError details: ${error instanceof Error ? error.message : String(error)}`, true);
            } else {
                callback(`I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}. Please try again or check the logs for more details.`, true);
            }
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
