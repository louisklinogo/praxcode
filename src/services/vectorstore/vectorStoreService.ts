/**
 * Interface for a document to be stored in the vector store
 */
export interface Document {
    id: string;
    text: string;
    metadata: {
        filePath: string;
        startLine?: number;
        endLine?: number;
        language?: string;
        [key: string]: any;
    };
}

/**
 * Interface for a document with embedding
 */
export interface DocumentWithEmbedding extends Document {
    embedding: number[];
}

/**
 * Interface for search results
 */
export interface SearchResult {
    document: Document;
    score: number;
}

/**
 * Interface for search options
 */
export interface SearchOptions {
    limit?: number;
    minScore?: number;
    filter?: Record<string, any>;
}

/**
 * Abstract Vector Store Service interface
 */
export abstract class VectorStoreService {
    /**
     * Initialize the vector store
     */
    abstract initialize(): Promise<void>;
    
    /**
     * Add documents to the vector store
     * @param documents The documents to add
     */
    abstract addDocuments(documents: DocumentWithEmbedding[]): Promise<void>;
    
    /**
     * Search for similar documents
     * @param embedding The embedding to search for
     * @param options The search options
     */
    abstract similaritySearch(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
    
    /**
     * Delete documents from the vector store
     * @param filter The filter to match documents to delete
     */
    abstract deleteDocuments(filter: Record<string, any>): Promise<void>;
    
    /**
     * Get the total number of documents in the vector store
     */
    abstract getDocumentCount(): Promise<number>;
    
    /**
     * Close the vector store
     */
    abstract close(): Promise<void>;
}
