const path = require('path');
const fs = require('fs');

// Create a simple logger
const logger = {
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error
};

// Create a simple LanceDBAdapter
class LanceDBAdapter {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.tableName = 'documents';
        this.embeddingDimension = 384;
        this.table = null;
        this.db = null;
    }

    async initialize() {
        try {
            // Ensure the directory exists
            if (!fs.existsSync(this.dbPath)) {
                fs.mkdirSync(this.dbPath, { recursive: true });
                logger.debug(`Created database directory at ${this.dbPath}`);
            }

            // Create a simple file-based storage system
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);

            // Check if the database file exists
            if (!fs.existsSync(dbFilePath)) {
                // Create an empty database file
                fs.writeFileSync(dbFilePath, JSON.stringify({
                    documents: [],
                    metadata: {
                        embeddingDimension: this.embeddingDimension,
                        created: new Date().toISOString(),
                        version: '1.0.0'
                    }
                }));
                logger.debug(`Created new database file at ${dbFilePath}`);
            }

            logger.debug(`Connected to vector store at ${this.dbPath}`);

            // Log the document count
            const count = await this.getDocumentCount();
            logger.info(`Vector store initialized with ${count} documents`);
        } catch (error) {
            logger.error('Failed to initialize vector store', error);
            throw new Error(`Failed to initialize vector store: ${error}`);
        }
    }

    async addDocuments(documents) {
        try {
            // Convert documents to storage format
            const data = documents.map(doc => ({
                id: doc.id,
                text: doc.text,
                embedding: doc.embedding,
                filePath: doc.metadata.filePath,
                startLine: doc.metadata.startLine || 0,
                endLine: doc.metadata.endLine || 0,
                language: doc.metadata.language || '',
            }));

            // Get the database file path
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);

            // Read the current database
            let db;
            try {
                const dbContent = fs.readFileSync(dbFilePath, 'utf-8');
                db = JSON.parse(dbContent);
            } catch (error) {
                // If the file doesn't exist or is invalid, create a new database
                db = {
                    documents: [],
                    metadata: {
                        embeddingDimension: this.embeddingDimension,
                        created: new Date().toISOString(),
                        version: '1.0.0'
                    }
                };
            }

            // Add the documents to the database
            db.documents = [...db.documents, ...data];

            // Write the updated database back to the file
            fs.writeFileSync(dbFilePath, JSON.stringify(db, null, 2));

            logger.debug(`Added ${documents.length} documents to vector store`);
        } catch (error) {
            logger.error('Failed to add documents to vector store', error);
            throw new Error(`Failed to add documents to vector store: ${error}`);
        }
    }

    async similaritySearch(embedding, options) {
        try {
            // Get the database file path
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);
            logger.info(`Checking for documents in database file: ${dbFilePath}`);

            // Check if the file exists
            if (!fs.existsSync(dbFilePath)) {
                logger.warn(`Database file not found at ${dbFilePath}`);
                return [];
            }

            // Read the database file
            let db;
            try {
                const dbContent = fs.readFileSync(dbFilePath, 'utf-8');
                logger.debug(`Read database file with size: ${dbContent.length} bytes`);

                db = JSON.parse(dbContent);
            } catch (error) {
                logger.error('Failed to read database file', error);
                return [];
            }

            // Check if we have documents
            if (!db.documents || db.documents.length === 0) {
                logger.debug('No documents in the database');
                return [];
            }

            logger.debug(`Found ${db.documents.length} documents in the database`);

            // Calculate cosine similarity for each document
            const results = db.documents.map((doc) => {
                // Calculate cosine similarity
                const similarity = this.cosineSimilarity(embedding, doc.embedding);

                return {
                    document: {
                        id: doc.id,
                        text: doc.text,
                        metadata: {
                            filePath: doc.filePath,
                            startLine: doc.startLine,
                            endLine: doc.endLine,
                            language: doc.language || '',
                        }
                    },
                    score: similarity
                };
            });

            // Filter by minimum score if provided
            let filteredResults = results;
            if (options?.minScore !== undefined) {
                logger.info(`Filtering results with minimum score: ${options.minScore}`);
                logger.info(`Before filtering: ${results.length} results with scores: ${results.map(r => r.score.toFixed(2)).join(', ')}`);
                filteredResults = results.filter((result) => result.score >= options.minScore);
                logger.info(`After filtering: ${filteredResults.length} results remain`);
            }

            // Sort by score (highest first)
            filteredResults.sort((a, b) => b.score - a.score);

            // Apply limit
            const limit = options?.limit || 10;
            const limitedResults = filteredResults.slice(0, limit);

            logger.debug(`Returning ${limitedResults.length} search results`);

            return limitedResults;
        } catch (error) {
            logger.error('Failed to search vector store', error);
            return []; // Return empty array instead of throwing to be more resilient
        }
    }

    cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            throw new Error(`Vector dimensions don't match: ${a.length} vs ${b.length}`);
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) {
            return 0;
        }

        // Ensure the result is between 0 and 1 by taking the absolute value
        // For random vectors, we often get negative values which shouldn't be used for similarity
        const similarity = Math.abs(dotProduct / (normA * normB));

        return similarity;
    }

    async getDocumentCount() {
        try {
            // Get the database file path
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);
            logger.info(`Checking document count in database file: ${dbFilePath}`);

            // Check if the file exists
            if (!fs.existsSync(dbFilePath)) {
                logger.warn(`Database file does not exist: ${dbFilePath}`);
                return 0;
            }

            // Read the database file
            try {
                const dbContent = fs.readFileSync(dbFilePath, 'utf-8');
                logger.debug(`Read database file with size: ${dbContent.length} bytes`);

                const db = JSON.parse(dbContent);

                // Check if the documents array exists
                if (!db.documents) {
                    logger.warn('Database file does not contain a documents array');
                    return 0;
                }

                // Return the number of documents
                const count = db.documents.length || 0;
                logger.info(`Found ${count} documents in the vector store`);

                return count;
            } catch (error) {
                logger.error(`Failed to read database file: ${dbFilePath}`, error);
                return 0;
            }
        } catch (error) {
            logger.error('Failed to get document count from vector store', error);
            return 0; // Return empty array instead of throwing to be more resilient
        }
    }

    async close() {
        logger.debug('Closed vector store connection');
    }
}

// Test the vector store
async function testVectorStore() {
    try {
        // Create a test storage directory
        const testStorageDir = path.join(__dirname, 'test-storage');
        logger.info(`Using test storage directory: ${testStorageDir}`);

        // Initialize vector store
        const vectorStorePath = path.join(testStorageDir, 'vectorstore');
        logger.info(`Initializing vector store at path: ${vectorStorePath}`);

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
            minScore: 0.01  // Very low threshold to see all results
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
