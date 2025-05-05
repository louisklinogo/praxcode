import * as path from 'path';
import * as fs from 'fs';

// Mock the vscode module
jest.mock('vscode', () => {
    return {
        workspace: {
            getConfiguration: () => ({
                get: (key: string, defaultValue: any) => {
                    const config: any = {
                        'llmProvider': 'ollama',
                        'ollamaUrl': 'http://localhost:11434',
                        'ollamaModel': 'llama3',
                        'vectorStore.enabled': true,
                        'vectorStore.embeddingModel': 'nomic-embed-text',
                        'indexing.includePatterns': ['**/*.{js,ts,jsx,tsx,py,java,c,cpp,cs,go,rb,php,html,css,md}'],
                        'indexing.excludePatterns': ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
                        'ui.showStatusBarItem': true,
                        'logging.logLevel': 'debug'
                    };
                    return config[key] || defaultValue;
                }
            })
        }
    };
});

import { LanceDBAdapter } from '../services/vectorstore/lanceDBAdapter';
import { EmbeddingService } from '../services/embedding/embeddingService';
import { RAGOrchestrator } from '../services/rag/ragOrchestrator';
import { logger, LogLevel } from '../utils/logger';

// Create a simple mock for the ConfigurationManager
class MockConfigManager {
    getConfiguration() {
        return {
            llmProvider: 'ollama',
            ollamaUrl: 'http://localhost:11434',
            ollamaModel: 'llama3',
            vectorStoreEnabled: true,
            embeddingModel: 'nomic-embed-text',
            includePatterns: ['**/*.{js,ts,jsx,tsx,py,java,c,cpp,cs,go,rb,php,html,css,md}'],
            excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
            showStatusBarItem: true,
            logLevel: 'debug'
        };
    }
}

/**
 * Test the RAG system
 */
async function testRag() {
    // Set up logging
    logger.setLogLevel(LogLevel.DEBUG);
    logger.info('Starting RAG test');

    try {
        // Create a test storage directory
        const testStorageDir = path.join(__dirname, '..', '..', 'test-storage');

        // Initialize the configuration manager
        const configManager = new MockConfigManager();
        logger.info('Mock configuration manager initialized');

        // Initialize vector store
        const vectorStorePath = path.join(testStorageDir, 'vectorstore');
        logger.info(`Initializing vector store at path: ${vectorStorePath}`);

        // Ensure the directory exists
        if (!fs.existsSync(vectorStorePath)) {
            fs.mkdirSync(vectorStorePath, { recursive: true });
            logger.info(`Created vector store directory at ${vectorStorePath}`);
        }

        const vectorStore = new LanceDBAdapter(vectorStorePath);
        logger.info('Vector store adapter created');

        // Initialize the embedding service
        const embeddingService = new EmbeddingService(configManager);
        logger.info('Embedding service created');

        // Initialize the vector store
        await vectorStore.initialize();
        logger.info('Vector store initialized');

        // Check if we have any documents
        const initialCount = await vectorStore.getDocumentCount();
        logger.info(`Vector store contains ${initialCount} documents initially`);

        // Add some test documents if none exist
        if (initialCount === 0) {
            logger.info('Adding test documents to vector store');

            // Create some test documents
            const testDocuments = [
                {
                    id: 'doc1',
                    text: 'This is a test document about TypeScript programming.',
                    embedding: embeddingService.generateRandomEmbedding(384),
                    metadata: {
                        filePath: 'test/file1.ts',
                        startLine: 1,
                        endLine: 10,
                        language: 'typescript'
                    }
                },
                {
                    id: 'doc2',
                    text: 'React is a JavaScript library for building user interfaces.',
                    embedding: embeddingService.generateRandomEmbedding(384),
                    metadata: {
                        filePath: 'test/file2.tsx',
                        startLine: 1,
                        endLine: 15,
                        language: 'typescriptreact'
                    }
                },
                {
                    id: 'doc3',
                    text: 'Node.js is a JavaScript runtime built on Chrome\'s V8 JavaScript engine.',
                    embedding: embeddingService.generateRandomEmbedding(384),
                    metadata: {
                        filePath: 'test/file3.js',
                        startLine: 1,
                        endLine: 20,
                        language: 'javascript'
                    }
                }
            ];

            // Add the documents to the vector store
            await vectorStore.addDocuments(testDocuments);

            // Check the document count again
            const newCount = await vectorStore.getDocumentCount();
            logger.info(`Vector store now contains ${newCount} documents`);
        }

        // Create a mock LLM service
        const mockLLMService = {
            chat: async (messages: any[]) => {
                return { content: 'This is a mock response from the LLM service.' };
            },
            streamChat: async (messages: any[], callback: (response: any) => void) => {
                callback({ content: 'This is a mock streaming response from the LLM service.', done: true });
            }
        };
        logger.info('Mock LLM service created');

        // Create the RAG orchestrator
        const ragOrchestrator = new RAGOrchestrator(vectorStore, embeddingService, mockLLMService);
        logger.info('RAG orchestrator created');

        // Test a query
        const query = 'Tell me about TypeScript';
        logger.info(`Testing query: "${query}"`);

        // Generate embedding for the query
        const [queryEmbedding] = await embeddingService.generateEmbeddings([query]);
        logger.info(`Generated query embedding with dimension: ${queryEmbedding.length}`);

        // Search for relevant documents
        const searchResults = await vectorStore.similaritySearch(queryEmbedding, {
            limit: 5,
            minScore: 0.5
        });

        logger.info(`Found ${searchResults.length} relevant documents for query`);

        // Log the search results
        for (const result of searchResults) {
            logger.info(`Document: ${result.document.id}, Score: ${result.score}`);
            logger.info(`Text: ${result.document.text}`);
            logger.info(`File: ${result.document.metadata.filePath}`);
            logger.info('---');
        }

        // Close the vector store
        await vectorStore.close();
        logger.info('Vector store closed');

        logger.info('RAG test completed successfully');
    } catch (error) {
        logger.error('RAG test failed', error);
    }
}

// Run the test
testRag().catch(error => {
    logger.error('Failed to run RAG test', error);
});
