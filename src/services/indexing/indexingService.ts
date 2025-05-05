import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { ConfigurationManager } from '../../utils/configurationManager';
import { VectorStoreService, Document, DocumentWithEmbedding } from '../vectorstore/vectorStoreService';
import { EmbeddingService } from '../embedding/embeddingService';

/**
 * Interface for chunking options
 */
export interface ChunkingOptions {
    chunkSize: number;
    chunkOverlap: number;
    minChunkSize: number;
}

/**
 * Interface for indexing options
 */
export interface IndexingOptions {
    includePatterns: string[];
    excludePatterns: string[];
    chunking: ChunkingOptions;
}

/**
 * Indexing Service class
 */
export class IndexingService {
    private configManager: ConfigurationManager;
    private vectorStore: VectorStoreService;
    private embeddingService: EmbeddingService;
    private isIndexing: boolean = false;
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    /**
     * Constructor
     * @param configManager The configuration manager
     * @param vectorStore The vector store service
     * @param embeddingService The embedding service
     */
    constructor(
        configManager: ConfigurationManager,
        vectorStore: VectorStoreService,
        embeddingService: EmbeddingService
    ) {
        this.configManager = configManager;
        this.vectorStore = vectorStore;
        this.embeddingService = embeddingService;
    }

    /**
     * Initialize the indexing service
     */
    async initialize(): Promise<void> {
        try {
            await this.vectorStore.initialize();
            logger.info('Indexing service initialized');

            // Set up file watcher if auto-reindexing is enabled
            this.setupFileWatcher();
        } catch (error) {
            logger.error('Failed to initialize indexing service', error);
            throw error;
        }
    }

    /**
     * Set up file watcher for auto-reindexing
     */
    private setupFileWatcher(): void {
        const config = this.configManager.getConfiguration();

        // Clean up existing watcher if any
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }

        // Only set up watcher if auto-reindexing is enabled
        if (config.autoReindexOnSave) {
            logger.info('Setting up file watcher for auto-reindexing');

            // Create a file system watcher for all files matching the include patterns
            const includePatterns = config.includePatterns.join(',');
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(includePatterns);

            // Handle file changes
            this.fileWatcher.onDidChange(this.handleFileChange.bind(this));
            this.fileWatcher.onDidCreate(this.handleFileChange.bind(this));
            this.fileWatcher.onDidDelete(this.handleFileDelete.bind(this));

            logger.info('File watcher set up successfully');
        } else {
            logger.info('Auto-reindexing is disabled, file watcher not set up');
        }
    }

    /**
     * Handle file change (create or modify)
     * @param uri The file URI
     */
    private async handleFileChange(uri: vscode.Uri): Promise<void> {
        try {
            const config = this.configManager.getConfiguration();

            // Skip if auto-reindexing is disabled
            if (!config.autoReindexOnSave) {
                return;
            }

            // Skip if indexing is already in progress
            if (this.isIndexing) {
                logger.debug(`Skipping auto-reindex for ${uri.fsPath} because indexing is already in progress`);
                return;
            }

            logger.info(`Auto-reindexing file: ${uri.fsPath}`);

            // Check if the file matches the exclude patterns
            for (const pattern of config.excludePatterns) {
                if (new RegExp(pattern.replace(/\*/g, '.*')).test(uri.fsPath)) {
                    logger.debug(`Skipping excluded file: ${uri.fsPath}`);
                    return;
                }
            }

            // Delete existing documents for this file
            await this.vectorStore.deleteDocuments({
                'metadata.filePath': uri.fsPath
            });

            // Process the file
            const chunking: ChunkingOptions = {
                chunkSize: 1000,
                chunkOverlap: 200,
                minChunkSize: 100
            };

            const documents = await this.processFile(uri, chunking);

            if (documents.length > 0) {
                // Generate embeddings
                const texts = documents.map(doc => doc.text);
                const embeddings = await this.embeddingService.generateEmbeddings(texts);

                // Combine documents with embeddings
                const documentsWithEmbeddings: DocumentWithEmbedding[] = documents.map((doc, index) => ({
                    ...doc,
                    embedding: embeddings[index]
                }));

                // Add to vector store
                await this.vectorStore.addDocuments(documentsWithEmbeddings);

                logger.info(`Auto-reindexed file with ${documents.length} chunks: ${uri.fsPath}`);
            } else {
                logger.debug(`No chunks generated for file: ${uri.fsPath}`);
            }
        } catch (error) {
            logger.error(`Failed to auto-reindex file: ${uri.fsPath}`, error);
        }
    }

    /**
     * Handle file deletion
     * @param uri The file URI
     */
    private async handleFileDelete(uri: vscode.Uri): Promise<void> {
        try {
            const config = this.configManager.getConfiguration();

            // Skip if auto-reindexing is disabled
            if (!config.autoReindexOnSave) {
                return;
            }

            logger.info(`Removing deleted file from index: ${uri.fsPath}`);

            // Delete documents for this file
            await this.vectorStore.deleteDocuments({
                'metadata.filePath': uri.fsPath
            });

            logger.info(`Removed deleted file from index: ${uri.fsPath}`);
        } catch (error) {
            logger.error(`Failed to remove deleted file from index: ${uri.fsPath}`, error);
        }
    }

    /**
     * Index the workspace
     * @param progress The progress object
     */
    async indexWorkspace(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
        if (this.isIndexing) {
            logger.warn('Indexing already in progress');
            return;
        }

        this.isIndexing = true;

        try {
            // First, clear existing documents if any
            try {
                const existingCount = await this.vectorStore.getDocumentCount();
                if (existingCount > 0) {
                    logger.info(`Clearing ${existingCount} existing documents before indexing`);
                    if (progress) {
                        progress.report({ message: `Clearing ${existingCount} existing documents...` });
                    }

                    // Delete all existing documents
                    await this.vectorStore.deleteDocuments({});
                    logger.info('Existing documents cleared');
                }
            } catch (clearError) {
                logger.warn('Failed to clear existing documents', clearError);
                // Continue with indexing even if clearing fails
            }

            const config = this.configManager.getConfiguration();

            // Ensure we have valid include patterns
            let includePatterns = config.includePatterns;
            if (!includePatterns || includePatterns.length === 0) {
                includePatterns = ['**/*.{js,ts,jsx,tsx,py,java,c,cpp,cs,go,rb,php,html,css,md}'];
                logger.warn('No include patterns found, using default patterns', { includePatterns });
            }

            // Ensure we have valid exclude patterns
            let excludePatterns = config.excludePatterns;
            if (!excludePatterns || excludePatterns.length === 0) {
                excludePatterns = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
                logger.warn('No exclude patterns found, using default patterns', { excludePatterns });
            }

            const options: IndexingOptions = {
                includePatterns,
                excludePatterns,
                chunking: {
                    chunkSize: 1000,
                    chunkOverlap: 200,
                    minChunkSize: 100
                }
            };

            logger.info('Starting workspace indexing with options', {
                includePatterns: options.includePatterns,
                excludePatterns: options.excludePatterns,
                chunkSize: options.chunking.chunkSize
            });

            if (progress) {
                progress.report({ message: 'Finding files to index...' });
            }

            // Find all files matching the patterns
            const files = await this.findFiles(options.includePatterns, options.excludePatterns);
            logger.info(`Found ${files.length} files to index`);

            // Log some sample files for debugging
            if (files.length > 0) {
                const sampleFiles = files.slice(0, Math.min(5, files.length));
                logger.debug('Sample files to index:', sampleFiles.map(f => f.fsPath));
            } else {
                logger.warn('No files found to index. Check your include/exclude patterns.');
                if (progress) {
                    progress.report({ message: 'No files found to index. Check your include/exclude patterns.' });
                }
                return;
            }

            if (progress) {
                progress.report({ message: `Found ${files.length} files to index` });
            }

            // Process files in batches
            const batchSize = 10;
            const totalFiles = files.length;
            let processedFiles = 0;
            let totalDocuments = 0;

            for (let i = 0; i < totalFiles; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                const documents: Document[] = [];

                // Process each file in the batch
                for (const file of batch) {
                    try {
                        logger.debug(`Processing file: ${file.fsPath}`);
                        const fileDocuments = await this.processFile(file, options.chunking);

                        if (fileDocuments.length > 0) {
                            logger.debug(`Generated ${fileDocuments.length} chunks for file: ${file.fsPath}`);
                            documents.push(...fileDocuments);
                        } else {
                            logger.debug(`No chunks generated for file: ${file.fsPath}`);
                        }
                    } catch (error) {
                        logger.error(`Failed to process file: ${file.fsPath}`, error);
                    }
                }

                // Generate embeddings for the documents
                if (documents.length > 0) {
                    logger.debug(`Generating embeddings for ${documents.length} documents`);

                    if (progress) {
                        progress.report({
                            message: `Generating embeddings for ${documents.length} chunks from ${batch.length} files...`
                        });
                    }

                    const texts = documents.map(doc => doc.text);
                    const embeddings = await this.embeddingService.generateEmbeddings(texts);

                    logger.debug(`Generated ${embeddings.length} embeddings`);

                    // Combine documents with embeddings
                    const documentsWithEmbeddings: DocumentWithEmbedding[] = documents.map((doc, index) => ({
                        ...doc,
                        embedding: embeddings[index]
                    }));

                    // Add to vector store
                    await this.vectorStore.addDocuments(documentsWithEmbeddings);
                    totalDocuments += documents.length;

                    logger.debug(`Added ${documents.length} documents to vector store`);
                } else {
                    logger.debug(`No documents to add for current batch`);
                }

                processedFiles += batch.length;

                if (progress) {
                    const percentage = Math.round((processedFiles / totalFiles) * 100);
                    progress.report({
                        message: `Indexed ${processedFiles} of ${totalFiles} files (${percentage}%) - ${totalDocuments} chunks created`,
                        increment: (batch.length / totalFiles) * 100
                    });
                }
            }

            // Verify the document count
            const finalCount = await this.vectorStore.getDocumentCount();
            logger.info(`Workspace indexing completed. ${finalCount} documents indexed.`);

            if (finalCount === 0) {
                logger.warn('No documents were indexed. Check your include/exclude patterns and file content.');
            }
        } catch (error) {
            logger.error('Failed to index workspace', error);
            throw error;
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Find files matching the patterns
     * @param includePatterns The include patterns
     * @param excludePatterns The exclude patterns
     */
    private async findFiles(includePatterns: string[], excludePatterns: string[]): Promise<vscode.Uri[]> {
        const allFiles: vscode.Uri[] = [];

        // Log the patterns for debugging
        logger.debug(`Finding files with include patterns: ${includePatterns.join(', ')}`);
        logger.debug(`Excluding patterns: ${excludePatterns.join(', ')}`);

        // Check if we have any workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            logger.warn('No workspace folders found. Please open a folder or workspace.');
            return [];
        }

        // Log workspace folders for debugging
        logger.debug(`Workspace folders: ${workspaceFolders.map(folder => folder.uri.fsPath).join(', ')}`);

        for (const includePattern of includePatterns) {
            try {
                logger.debug(`Searching for files matching pattern: ${includePattern}`);

                const files = await vscode.workspace.findFiles(
                    includePattern,
                    `{${excludePatterns.join(',')}}`
                );

                logger.debug(`Found ${files.length} files matching pattern: ${includePattern}`);
                allFiles.push(...files);
            } catch (error) {
                logger.error(`Error finding files with pattern ${includePattern}:`, error);
            }
        }

        // Remove duplicates
        const uniqueFiles = Array.from(new Map(allFiles.map(file => [file.fsPath, file])).values());

        // Log some sample files for debugging
        if (uniqueFiles.length > 0) {
            const sampleFiles = uniqueFiles.slice(0, Math.min(5, uniqueFiles.length));
            logger.debug(`Sample files found: ${sampleFiles.map(file => file.fsPath).join(', ')}`);
        } else {
            logger.warn('No files found matching the include patterns. Check your patterns and workspace.');
        }

        return uniqueFiles;
    }

    /**
     * Process a file
     * @param fileUri The file URI
     * @param options The chunking options
     */
    private async processFile(fileUri: vscode.Uri, options: ChunkingOptions): Promise<Document[]> {
        try {
            // Check if the file exists
            if (!fs.existsSync(fileUri.fsPath)) {
                logger.warn(`File does not exist: ${fileUri.fsPath}`);
                return [];
            }

            // Check if the file is a directory
            const stats = fs.statSync(fileUri.fsPath);
            if (stats.isDirectory()) {
                logger.debug(`Skipping directory: ${fileUri.fsPath}`);
                return [];
            }

            // Check file size
            if (stats.size > 10 * 1024 * 1024) { // 10MB limit
                logger.warn(`File too large (${stats.size} bytes), skipping: ${fileUri.fsPath}`);
                return [];
            }

            // Read the file
            let content: string;
            try {
                content = await fs.promises.readFile(fileUri.fsPath, 'utf-8');
                logger.debug(`Read file (${content.length} chars): ${fileUri.fsPath}`);
            } catch (error) {
                logger.warn(`Failed to read file as UTF-8: ${fileUri.fsPath}`, error);
                return [];
            }

            // Skip empty files
            if (!content.trim()) {
                logger.debug(`Skipping empty file: ${fileUri.fsPath}`);
                return [];
            }

            // Get the language ID
            const language = this.getLanguageFromPath(fileUri.fsPath);

            // Split the content into chunks
            const chunks = this.splitIntoChunks(content, options);
            logger.debug(`Split file into ${chunks.length} chunks: ${fileUri.fsPath}`);

            // Create documents
            return chunks.map((chunk, index) => ({
                id: uuidv4(),
                text: chunk.text,
                metadata: {
                    filePath: fileUri.fsPath,
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    language,
                    chunkIndex: index
                }
            }));
        } catch (error) {
            logger.error(`Failed to process file: ${fileUri.fsPath}`, error);
            return []; // Return empty array instead of throwing to be more resilient
        }
    }

    /**
     * Split content into chunks
     * @param content The content to split
     * @param options The chunking options
     */
    private splitIntoChunks(content: string, options: ChunkingOptions): { text: string; startLine: number; endLine: number }[] {
        const lines = content.split('\n');
        const chunks: { text: string; startLine: number; endLine: number }[] = [];

        let currentChunk: string[] = [];
        let currentChunkSize = 0;
        let startLine = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineLength = line.length;

            currentChunk.push(line);
            currentChunkSize += lineLength;

            // Check if we've reached the chunk size
            if (currentChunkSize >= options.chunkSize && currentChunk.length > 0) {
                chunks.push({
                    text: currentChunk.join('\n'),
                    startLine,
                    endLine: startLine + currentChunk.length - 1
                });

                // Calculate overlap
                const overlapLines = Math.min(
                    Math.ceil(options.chunkOverlap / (currentChunkSize / currentChunk.length)),
                    currentChunk.length - 1
                );

                // Keep overlap lines for the next chunk
                currentChunk = currentChunk.slice(-overlapLines);
                currentChunkSize = currentChunk.reduce((sum, line) => sum + line.length, 0);
                startLine = startLine + currentChunk.length - overlapLines;
            }
        }

        // Add the last chunk if it's not empty and meets the minimum size
        if (currentChunk.length > 0 && currentChunkSize >= options.minChunkSize) {
            chunks.push({
                text: currentChunk.join('\n'),
                startLine,
                endLine: startLine + currentChunk.length - 1
            });
        }

        return chunks;
    }

    /**
     * Get the language ID from the file path
     * @param filePath The file path
     */
    private getLanguageFromPath(filePath: string): string {
        const extension = path.extname(filePath).toLowerCase();

        // Map file extensions to language IDs
        const extensionToLanguage: Record<string, string> = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascriptreact',
            '.tsx': 'typescriptreact',
            '.py': 'python',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.cs': 'csharp',
            '.go': 'go',
            '.rb': 'ruby',
            '.php': 'php',
            '.html': 'html',
            '.css': 'css',
            '.md': 'markdown',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml'
        };

        return extensionToLanguage[extension] || 'plaintext';
    }

    /**
     * Check if indexing is in progress
     */
    isIndexingInProgress(): boolean {
        return this.isIndexing;
    }

    /**
     * Get the document count
     */
    async getDocumentCount(): Promise<number> {
        return await this.vectorStore.getDocumentCount();
    }

    /**
     * Update configuration
     * This should be called when configuration changes
     */
    updateConfiguration(): void {
        // Update file watcher based on new configuration
        this.setupFileWatcher();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }
    }
}
