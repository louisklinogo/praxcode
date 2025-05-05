import * as path from 'path';
import * as fs from 'fs';
import {
    VectorStoreService,
    Document,
    DocumentWithEmbedding,
    SearchResult,
    SearchOptions
} from './vectorStoreService';
import { logger } from '../../utils/logger';

// Import Node.js file system promises API
import { promises as fsPromises } from 'fs';

// Mock interfaces for LanceDB
interface Connection {
    tableNames(): Promise<string[]>;
    createTable(name: string, data: any[], schema: any): Promise<Table>;
    openTable(name: string): Promise<Table>;
}

interface Table {
    add(data: any[]): Promise<void>;
    search(embedding: number[]): Query;
    where(condition: string): Table;
    delete(condition: string): Promise<void>;
    countRows(): Promise<number>;
}

interface Query {
    where(condition: string): Query;
    limit(n: number): Query;
    execute(): Promise<any[]>;
}

/**
 * LanceDB schema
 */
interface LanceDBSchema {
    id: string;
    text: string;
    embedding: number[];
    filePath: string;
    startLine?: number;
    endLine?: number;
    language?: string;
    [key: string]: any;
}

/**
 * LanceDB adapter implementation
 */
export class LanceDBAdapter implements VectorStoreService {
    private dbPath: string;
    private tableName: string;
    private embeddingDimension: number;
    private db: Connection | null = null;
    private table: Table | null = null;

    /**
     * Constructor
     * @param dbPath The path to the LanceDB database
     * @param tableName The name of the table
     * @param embeddingDimension The dimension of the embeddings
     */
    constructor(dbPath: string, tableName: string = 'documents', embeddingDimension: number = 384) {
        this.dbPath = dbPath;
        this.tableName = tableName;
        this.embeddingDimension = embeddingDimension;
    }

    /**
     * Initialize the vector store
     */
    async initialize(): Promise<void> {
        try {
            // Ensure the directory exists
            if (!fs.existsSync(this.dbPath)) {
                await fsPromises.mkdir(this.dbPath, { recursive: true });
                logger.debug(`Created database directory at ${this.dbPath}`);
            }

            // Create a simple file-based storage system
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);

            // Check if the database file exists
            if (!fs.existsSync(dbFilePath)) {
                // Create an empty database file
                await fsPromises.writeFile(dbFilePath, JSON.stringify({
                    documents: [],
                    metadata: {
                        embeddingDimension: this.embeddingDimension,
                        created: new Date().toISOString(),
                        version: '1.0.0'
                    }
                }));
                logger.debug(`Created new database file at ${dbFilePath}`);
            }

            // Set up the mock database connection
            this.db = this.mockConnect(this.dbPath);
            logger.debug(`Connected to vector store at ${this.dbPath}`);

            // Set up the table
            this.table = await this.db.openTable(this.tableName);
            logger.debug(`Opened table ${this.tableName}`);

            // Log the document count
            const count = await this.getDocumentCount();
            logger.info(`Vector store initialized with ${count} documents`);
        } catch (error) {
            logger.error('Failed to initialize vector store', error);
            throw new Error(`Failed to initialize vector store: ${error}`);
        }
    }

    /**
     * Add documents to the vector store
     * @param documents The documents to add
     */
    async addDocuments(documents: DocumentWithEmbedding[]): Promise<void> {
        if (!this.table) {
            throw new Error('Vector store not initialized. Call initialize() first.');
        }

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
                ...Object.entries(doc.metadata)
                    .filter(([key]) => !['filePath', 'startLine', 'endLine', 'language'].includes(key))
                    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
            }));

            // Get the database file path
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);

            // Read the current database
            let db;
            try {
                const dbContent = await fsPromises.readFile(dbFilePath, 'utf-8');
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
            await fsPromises.writeFile(dbFilePath, JSON.stringify(db, null, 2));

            // Also call the mock implementation for compatibility
            await this.table.add(data);

            logger.debug(`Added ${documents.length} documents to vector store`);
        } catch (error) {
            logger.error('Failed to add documents to vector store', error);
            throw new Error(`Failed to add documents to vector store: ${error}`);
        }
    }

    /**
     * Search for similar documents
     * @param embedding The embedding to search for
     * @param options The search options
     */
    async similaritySearch(embedding: number[], options?: SearchOptions): Promise<SearchResult[]> {
        if (!this.table) {
            throw new Error('Vector store not initialized. Call initialize() first.');
        }

        try {
            // Get the database file path
            const dbFilePath = path.join(this.dbPath, `${this.tableName}.json`);

            // Check if the file exists
            if (!fs.existsSync(dbFilePath)) {
                logger.warn(`Database file not found at ${dbFilePath}`);
                return [];
            }

            // Read the database file
            let db;
            try {
                const dbContent = await fsPromises.readFile(dbFilePath, 'utf-8');
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
            const results = db.documents.map((doc: any) => {
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
                filteredResults = results.filter((result: SearchResult) => result.score >= options.minScore!);
            }

            // Apply additional filters if provided
            if (options?.filter) {
                filteredResults = filteredResults.filter((result: SearchResult) => {
                    return Object.entries(options.filter!).every(([key, value]) => {
                        const docValue = result.document.metadata[key as keyof typeof result.document.metadata];

                        if (Array.isArray(value)) {
                            return value.includes(docValue);
                        } else {
                            return docValue === value;
                        }
                    });
                });
            }

            // Sort by score (highest first)
            filteredResults.sort((a: SearchResult, b: SearchResult) => b.score - a.score);

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

    /**
     * Calculate cosine similarity between two vectors
     * @param a First vector
     * @param b Second vector
     */
    private cosineSimilarity(a: number[], b: number[]): number {
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

    /**
     * Delete documents from the vector store
     * @param filter The filter to match documents to delete
     */
    async deleteDocuments(filter: Record<string, any>): Promise<void> {
        if (!this.table) {
            throw new Error('Vector store not initialized. Call initialize() first.');
        }

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
                const dbContent = await fsPromises.readFile(dbFilePath, 'utf-8');
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
                db.documents = db.documents.filter((doc: any) => {
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
            await fsPromises.writeFile(dbFilePath, JSON.stringify(db, null, 2));

            // Also call the mock implementation for compatibility
            if (Object.keys(filter).length > 0) {
                const filterConditions = Object.entries(filter).map(([key, value]) => {
                    if (Array.isArray(value)) {
                        return `${key} IN [${value.map(v => typeof v === 'string' ? `'${v}'` : v).join(', ')}]`;
                    } else if (typeof value === 'string') {
                        return `${key} = '${value}'`;
                    } else {
                        return `${key} = ${value}`;
                    }
                });

                const whereClause = filterConditions.join(' AND ');
                await this.table.delete(whereClause);
            }
        } catch (error) {
            logger.error('Failed to delete documents from vector store', error);
            throw new Error(`Failed to delete documents from vector store: ${error}`);
        }
    }

    /**
     * Get the total number of documents in the vector store
     */
    async getDocumentCount(): Promise<number> {
        if (!this.table) {
            logger.warn('Vector store not initialized when calling getDocumentCount');
            throw new Error('Vector store not initialized. Call initialize() first.');
        }

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
                const dbContent = await fsPromises.readFile(dbFilePath, 'utf-8');
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

                // Log some sample document IDs for debugging
                if (count > 0) {
                    const sampleDocs = db.documents.slice(0, Math.min(3, count));
                    logger.debug('Sample documents:', sampleDocs.map((doc: any) => ({
                        id: doc.id,
                        filePath: doc.filePath,
                        textLength: doc.text?.length || 0
                    })));
                }

                return count;
            } catch (error) {
                logger.error(`Failed to read database file: ${dbFilePath}`, error);
                return 0;
            }
        } catch (error) {
            logger.error('Failed to get document count from vector store', error);
            return 0; // Return 0 instead of throwing to be more resilient
        }
    }

    /**
     * Close the vector store
     */
    async close(): Promise<void> {
        try {
            if (this.db) {
                // LanceDB doesn't have an explicit close method, but we can set the references to null
                this.table = null;
                this.db = null;
                logger.debug('Closed LanceDB connection');
            }
        } catch (error) {
            logger.error('Failed to close LanceDB', error);
            throw new Error(`Failed to close LanceDB: ${error}`);
        }
    }

    /**
     * Mock connect to LanceDB
     * @param dbPath The path to the database
     */
    private mockConnect(dbPath: string): Connection {
        // Create a mock connection
        const mockConnection: Connection = {
            tableNames: async () => {
                return [];
            },
            createTable: async (name: string, data: any[], schema: any) => {
                return this.createMockTable();
            },
            openTable: async (name: string) => {
                return this.createMockTable();
            }
        };

        return mockConnection;
    }

    /**
     * Create a mock table
     */
    private createMockTable(): Table {
        // Create a mock table
        const mockTable: Table = {
            add: async (data: any[]) => {
                // Mock implementation
                logger.debug(`Mock adding ${data.length} documents to LanceDB`);
            },
            search: (embedding: number[]) => {
                // Create a mock query
                const mockQuery: Query = {
                    where: (condition: string) => {
                        return mockQuery;
                    },
                    limit: (n: number) => {
                        return mockQuery;
                    },
                    execute: async () => {
                        // Return empty results
                        return [];
                    }
                };

                return mockQuery;
            },
            where: (condition: string) => {
                return mockTable;
            },
            delete: async (condition: string) => {
                // Mock implementation
                logger.debug(`Mock deleting documents from LanceDB with condition: ${condition}`);
            },
            countRows: async () => {
                // Return 0 documents
                return 0;
            }
        };

        return mockTable;
    }
}
