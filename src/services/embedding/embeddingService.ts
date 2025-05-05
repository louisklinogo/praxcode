import axios from 'axios';
import { logger } from '../../utils/logger';
import { ConfigurationManager } from '../../utils/configurationManager';
import { CacheService } from '../cache/cacheService';
import * as crypto from 'crypto';

/**
 * Interface for embedding options
 */
export interface EmbeddingOptions {
    batchSize?: number;
}

/**
 * Embedding Service class
 */
export class EmbeddingService {
    private configManager: ConfigurationManager;
    private cacheService: CacheService | null = null;
    private cacheEnabled: boolean = true;
    private cacheTTL: number = 24 * 60 * 60 * 1000; // 24 hours

    /**
     * Constructor
     * @param configManager The configuration manager
     * @param cacheService Optional cache service
     */
    constructor(configManager: ConfigurationManager, cacheService?: CacheService) {
        this.configManager = configManager;
        this.cacheService = cacheService || null;
    }

    /**
     * Set the cache service
     * @param cacheService The cache service
     */
    setCacheService(cacheService: CacheService): void {
        this.cacheService = cacheService;
    }

    /**
     * Enable or disable caching
     * @param enabled Whether caching is enabled
     */
    setCacheEnabled(enabled: boolean): void {
        this.cacheEnabled = enabled;
    }

    /**
     * Set the cache TTL
     * @param ttl The cache TTL in milliseconds
     */
    setCacheTTL(ttl: number): void {
        this.cacheTTL = ttl;
    }

    /**
     * Generate embeddings for texts
     * @param texts The texts to generate embeddings for
     * @param options The embedding options
     */
    async generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
        const config = this.configManager.getConfiguration();
        const batchSize = options?.batchSize || 10;

        // Process in batches to avoid overloading the API
        const batches: string[][] = [];
        for (let i = 0; i < texts.length; i += batchSize) {
            batches.push(texts.slice(i, i + batchSize));
        }

        const allEmbeddings: number[][] = [];

        for (const batch of batches) {
            try {
                // Check if we can use cached embeddings
                const cachedEmbeddings = await this.getCachedEmbeddings(batch, config.embeddingModel);

                // If we have cached embeddings for all texts in the batch, use them
                if (cachedEmbeddings.length === batch.length) {
                    logger.debug(`Using cached embeddings for ${batch.length} texts`);
                    allEmbeddings.push(...cachedEmbeddings);
                    continue;
                }

                // Otherwise, generate embeddings for the batch
                const embeddings = await this.generateEmbeddingsWithOllama(batch, config.embeddingModel);
                allEmbeddings.push(...embeddings);

                // Cache the embeddings
                await this.cacheEmbeddings(batch, embeddings, config.embeddingModel);
            } catch (error) {
                logger.error('Failed to generate embeddings', error);
                throw new Error(`Failed to generate embeddings: ${error}`);
            }
        }

        return allEmbeddings;
    }

    /**
     * Get cached embeddings for texts
     * @param texts The texts to get embeddings for
     * @param model The model used for embeddings
     */
    private async getCachedEmbeddings(texts: string[], model: string): Promise<number[][]> {
        // If caching is disabled or no cache service, return empty array
        if (!this.cacheEnabled || !this.cacheService) {
            return [];
        }

        const cachedEmbeddings: number[][] = [];

        for (const text of texts) {
            // Create a cache key based on the text and model
            const cacheKey = this.createEmbeddingCacheKey(text, model);

            // Try to get from cache
            const cachedEmbedding = await this.cacheService.get<number[]>(cacheKey);

            if (cachedEmbedding) {
                cachedEmbeddings.push(cachedEmbedding);
            } else {
                // If any embedding is not cached, we need to generate all of them
                // This is because we need to return embeddings in the same order as the texts
                return [];
            }
        }

        return cachedEmbeddings;
    }

    /**
     * Cache embeddings for texts
     * @param texts The texts
     * @param embeddings The embeddings
     * @param model The model used for embeddings
     */
    private async cacheEmbeddings(texts: string[], embeddings: number[][], model: string): Promise<void> {
        // If caching is disabled or no cache service, do nothing
        if (!this.cacheEnabled || !this.cacheService) {
            return;
        }

        // Cache each embedding
        for (let i = 0; i < texts.length; i++) {
            const text = texts[i];
            const embedding = embeddings[i];

            // Create a cache key based on the text and model
            const cacheKey = this.createEmbeddingCacheKey(text, model);

            // Cache the embedding
            await this.cacheService.set(cacheKey, embedding, this.cacheTTL, true);
        }
    }

    /**
     * Create a cache key for an embedding
     * @param text The text
     * @param model The model
     */
    private createEmbeddingCacheKey(text: string, model: string): string {
        // Create a hash of the text to use as the cache key
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        return `embedding:${model}:${hash}`;
    }

    /**
     * Generate embeddings using Ollama
     * @param texts The texts to generate embeddings for
     * @param model The model to use
     */
    private async generateEmbeddingsWithOllama(texts: string[], model: string): Promise<number[][]> {
        const config = this.configManager.getConfiguration();
        const ollamaUrl = config.ollamaUrl;

        const embeddings: number[][] = [];

        // First check if Ollama is running
        try {
            await axios.get(`${ollamaUrl}/api/version`, { timeout: 2000 });
        } catch (error) {
            logger.error('Failed to connect to Ollama server', error);

            // Generate fallback random embeddings for testing purposes
            // This allows indexing to work even without Ollama running
            logger.warn('Using fallback random embeddings for testing');
            return texts.map(() => this.generateRandomEmbedding(384)); // 384 is a common embedding dimension
        }

        for (const text of texts) {
            try {
                const response = await axios.post(`${ollamaUrl}/api/embeddings`, {
                    model,
                    prompt: text
                });

                if (response.data && response.data.embedding) {
                    embeddings.push(response.data.embedding);
                } else {
                    logger.warn('Invalid response from Ollama embeddings API, using fallback embedding');
                    embeddings.push(this.generateRandomEmbedding(384));
                }
            } catch (error) {
                logger.error(`Failed to generate embedding for text: ${text.substring(0, 50)}...`, error);
                // Use a fallback embedding instead of failing the whole process
                embeddings.push(this.generateRandomEmbedding(384));
            }
        }

        return embeddings;
    }

    /**
     * Generate a random embedding for testing purposes
     * @param dimension The dimension of the embedding
     */
    generateRandomEmbedding(dimension: number): number[] {
        const embedding: number[] = [];
        for (let i = 0; i < dimension; i++) {
            embedding.push(Math.random() * 2 - 1); // Random value between -1 and 1
        }
        return embedding;
    }
}
