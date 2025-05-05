// Test the full RAG system
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

// Run the test
async function runTest() {
    try {
        // Create test files
        const testDir = createTestFiles();
        logger.info(`Created test directory: ${testDir}`);
        
        // Create a test storage directory
        const testStorageDir = path.join(__dirname, 'test-storage');
        logger.info(`Using test storage directory: ${testStorageDir}`);
        
        // Load the LanceDBAdapter
        const { LanceDBAdapter } = require('./out/services/vectorstore/lanceDBAdapter');
        
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
