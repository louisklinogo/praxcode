import * as path from 'path';
import * as fs from 'fs';
import { LanceDBAdapter } from '../services/vectorstore/lanceDBAdapter';
import { logger, LogLevel } from '../utils/logger';

/**
 * Test the vector store
 */
async function testVectorStore() {
    // Set up logging
    logger.setLogLevel(LogLevel.DEBUG);
    logger.info('Starting vector store test');

    try {
        // Create a test storage directory
        const testStorageDir = path.join(__dirname, '..', '..', 'test-storage');
        logger.info(`Using test storage directory: ${testStorageDir}`);
        
        // Ensure the directory exists
        if (!fs.existsSync(testStorageDir)) {
            fs.mkdirSync(testStorageDir, { recursive: true });
            logger.info(`Created test storage directory at ${testStorageDir}`);
        }
        
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
                    embedding: Array(384).fill(0).map(() => Math.random() * 2 - 1),
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
                    embedding: Array(384).fill(0).map(() => Math.random() * 2 - 1),
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
                    embedding: Array(384).fill(0).map(() => Math.random() * 2 - 1),
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
        
        // Test a search
        const queryEmbedding = Array(384).fill(0).map(() => Math.random() * 2 - 1);
        logger.info(`Testing search with random query embedding`);
        
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
        
        logger.info('Vector store test completed successfully');
    } catch (error) {
        logger.error('Vector store test failed', error);
    }
}

// Run the test
testVectorStore().catch(error => {
    logger.error('Failed to run vector store test', error);
});
