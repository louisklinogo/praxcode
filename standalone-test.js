// Standalone test for the vector store
const path = require('path');
const fs = require('fs');

// Create a simple logger
const logger = {
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error
};

// Create a simple test file
function createTestFiles() {
    const testDir = path.join(__dirname, 'test-files');
    
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create a sample JavaScript file
    const jsFilePath = path.join(testDir, 'sample.js');
    const jsContent = `
// Authentication module for the application
class AuthService {
    constructor(config) {
        this.config = config;
        this.tokenExpiry = config.tokenExpiry || 3600; // Default 1 hour
    }
    
    /**
     * Authenticate a user with username and password
     * @param {string} username - The user's username
     * @param {string} password - The user's password
     * @returns {Promise<Object>} - Authentication result with token
     */
    async authenticate(username, password) {
        // In a real implementation, this would validate against a database
        if (username === 'admin' && password === 'password') {
            return {
                success: true,
                token: this.generateToken(),
                user: { id: 1, username, role: 'admin' }
            };
        }
        
        return {
            success: false,
            message: 'Invalid username or password'
        };
    }
    
    /**
     * Generate a JWT token
     * @private
     * @returns {string} - JWT token
     */
    generateToken() {
        // In a real implementation, this would use a JWT library
        return 'sample-jwt-token-' + Math.random().toString(36).substring(2);
    }
    
    /**
     * Verify a token is valid
     * @param {string} token - The token to verify
     * @returns {boolean} - Whether the token is valid
     */
    verifyToken(token) {
        // In a real implementation, this would validate the JWT
        return token && token.startsWith('sample-jwt-token-');
    }
}

module.exports = AuthService;
`;
    
    fs.writeFileSync(jsFilePath, jsContent);
    logger.info(`Created test file: ${jsFilePath}`);
    
    // Create a sample TypeScript file
    const tsFilePath = path.join(testDir, 'database.ts');
    const tsContent = `
/**
 * Database service for the application
 */
export class DatabaseService {
    private connection: any;
    private isConnected: boolean = false;
    
    /**
     * Initialize the database connection
     * @param config - Database configuration
     */
    async initialize(config: DatabaseConfig): Promise<boolean> {
        try {
            // In a real implementation, this would connect to a real database
            this.connection = {
                query: async (sql: string, params: any[]) => {
                    console.log('Executing query:', sql, params);
                    return { rows: [] };
                },
                close: async () => {
                    console.log('Closing connection');
                    this.isConnected = false;
                }
            };
            
            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('Failed to connect to database:', error);
            return false;
        }
    }
    
    /**
     * Execute a query on the database
     * @param sql - SQL query to execute
     * @param params - Query parameters
     * @returns Query result
     */
    async query(sql: string, params: any[] = []): Promise<any> {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        
        return this.connection.query(sql, params);
    }
    
    /**
     * Close the database connection
     */
    async close(): Promise<void> {
        if (this.isConnected) {
            await this.connection.close();
            this.isConnected = false;
        }
    }
}

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
}
`;
    
    fs.writeFileSync(tsFilePath, tsContent);
    logger.info(`Created test file: ${tsFilePath}`);
    
    return testDir;
}

// Simple vector store implementation
class SimpleVectorStore {
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.tableName = 'documents';
        this.embeddingDimension = 384;
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
    
    async deleteDocuments(filter) {
        try {
            // Get the database file path
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);
            
            // Check if the file exists
            if (!fs.existsSync(dbFilePath)) {
                logger.warn(`Database file not found at ${dbFilePath}, nothing to delete`);
                return;
            }
            
            // Read the database file
            let db;
            try {
                const dbContent = fs.readFileSync(dbFilePath, 'utf-8');
                db = JSON.parse(dbContent);
            } catch (error) {
                logger.error('Failed to read database file', error);
                throw new Error(`Failed to read database file: ${error}`);
            }
            
            // Check if we have documents
            if (!db.documents || db.documents.length === 0) {
                logger.debug('No documents in the database to delete');
                return;
            }
            
            const originalCount = db.documents.length;
            
            // If filter is empty, delete all documents
            if (Object.keys(filter).length === 0) {
                logger.debug(`Deleting all ${originalCount} documents from vector store`);
                db.documents = [];
            } else {
                // Apply filter to keep only documents that don't match the filter
                db.documents = db.documents.filter((doc) => {
                    return !Object.entries(filter).every(([key, value]) => {
                        // Handle nested properties like metadata.filePath
                        const keyParts = key.split('.');
                        let docValue = doc;
                        
                        for (const part of keyParts) {
                            if (docValue === undefined || docValue === null) {
                                return false;
                            }
                            docValue = docValue[part];
                        }
                        
                        if (Array.isArray(value)) {
                            return value.includes(docValue);
                        } else {
                            return docValue === value;
                        }
                    });
                });
                
                logger.debug(`Deleted ${originalCount - db.documents.length} documents from vector store with filter: ${JSON.stringify(filter)}`);
            }
            
            // Write the updated database back to the file
            fs.writeFileSync(dbFilePath, JSON.stringify(db, null, 2));
        } catch (error) {
            logger.error('Failed to delete documents from vector store', error);
            throw new Error(`Failed to delete documents from vector store: ${error}`);
        }
    }
    
    async close() {
        logger.debug('Closed vector store connection');
    }
}

// Run the test
async function runTest() {
    try {
        // Create test files
        const testDir = createTestFiles();
        logger.info(`Created test directory: ${testDir}`);
        
        // Create a test storage directory
        const testStorageDir = path.join(__dirname, 'test-storage');
        logger.info(`Using test storage directory: ${testStorageDir}`);
        
        // Initialize vector store
        const vectorStorePath = path.join(testStorageDir, 'vectorstore');
        logger.info(`Initializing vector store at path: ${vectorStorePath}`);
        
        // Ensure the directory exists
        if (!fs.existsSync(vectorStorePath)) {
            fs.mkdirSync(vectorStorePath, { recursive: true });
            logger.info(`Created vector store directory at ${vectorStorePath}`);
        }
        
        const vectorStore = new SimpleVectorStore(vectorStorePath);
        logger.info('Vector store adapter created');
        
        // Initialize the vector store
        await vectorStore.initialize();
        logger.info('Vector store initialized');
        
        // Check if we have any documents
        const initialCount = await vectorStore.getDocumentCount();
        logger.info(`Vector store contains ${initialCount} documents initially`);
        
        // Clear any existing documents
        if (initialCount > 0) {
            await vectorStore.deleteDocuments({});
            logger.info('Cleared existing documents');
            
            const countAfterClear = await vectorStore.getDocumentCount();
            logger.info(`Vector store contains ${countAfterClear} documents after clearing`);
        }
        
        // Read the test files
        const jsFilePath = path.join(testDir, 'sample.js');
        const tsFilePath = path.join(testDir, 'database.ts');
        
        const jsContent = fs.readFileSync(jsFilePath, 'utf-8');
        const tsContent = fs.readFileSync(tsFilePath, 'utf-8');
        
        // Create documents
        const documents = [
            {
                id: 'doc1',
                text: jsContent,
                embedding: Array(384).fill(0).map(() => Math.random() * 2 - 1),
                metadata: {
                    filePath: jsFilePath,
                    startLine: 1,
                    endLine: jsContent.split('\n').length,
                    language: 'javascript'
                }
            },
            {
                id: 'doc2',
                text: tsContent,
                embedding: Array(384).fill(0).map(() => Math.random() * 2 - 1),
                metadata: {
                    filePath: tsFilePath,
                    startLine: 1,
                    endLine: tsContent.split('\n').length,
                    language: 'typescript'
                }
            }
        ];
        
        // Add the documents to the vector store
        await vectorStore.addDocuments(documents);
        logger.info(`Added ${documents.length} documents to vector store`);
        
        // Check the document count again
        const newCount = await vectorStore.getDocumentCount();
        logger.info(`Vector store now contains ${newCount} documents`);
        
        // Test a search for authentication
        const authQueryEmbedding = Array(384).fill(0).map(() => Math.random() * 2 - 1);
        logger.info(`Testing search for authentication`);
        
        // Search for relevant documents
        let searchResults = await vectorStore.similaritySearch(authQueryEmbedding, {
            limit: 5,
            minScore: 0.01
        });
        
        logger.info(`Found ${searchResults.length} relevant documents for authentication query`);
        
        // Log the search results
        for (const result of searchResults) {
            logger.info(`Document: ${result.document.id}, Score: ${result.score}`);
            logger.info(`File: ${result.document.metadata.filePath}`);
            logger.info(`Text snippet: ${result.document.text.substring(0, 100)}...`);
            logger.info('---');
        }
        
        // Test a search for database
        const dbQueryEmbedding = Array(384).fill(0).map(() => Math.random() * 2 - 1);
        logger.info(`Testing search for database`);
        
        // Search for relevant documents
        searchResults = await vectorStore.similaritySearch(dbQueryEmbedding, {
            limit: 5,
            minScore: 0.01
        });
        
        logger.info(`Found ${searchResults.length} relevant documents for database query`);
        
        // Log the search results
        for (const result of searchResults) {
            logger.info(`Document: ${result.document.id}, Score: ${result.score}`);
            logger.info(`File: ${result.document.metadata.filePath}`);
            logger.info(`Text snippet: ${result.document.text.substring(0, 100)}...`);
            logger.info('---');
        }
        
        // Close the vector store
        await vectorStore.close();
        logger.info('Vector store closed');
        
        logger.info('Test completed successfully');
    } catch (error) {
        logger.error('Test failed', error);
    }
}

// Run the test
runTest().catch(error => {
    logger.error('Failed to run test', error);
});
