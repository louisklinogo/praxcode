import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger';

/**
 * Cache entry interface
 */
interface CacheEntry<T> {
    value: T;
    timestamp: number;
    ttl: number; // Time to live in milliseconds
}

/**
 * Cache service for storing and retrieving data
 */
export class CacheService {
    private static instance: CacheService;
    private cacheDir: string;
    private memoryCache: Map<string, CacheEntry<any>> = new Map();
    private maxMemoryCacheSize: number = 100; // Maximum number of items in memory cache
    
    /**
     * Private constructor (singleton)
     * @param context The extension context
     */
    private constructor(context: vscode.ExtensionContext) {
        this.cacheDir = path.join(context.globalStorageUri.fsPath, 'cache');
        
        // Ensure the cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            logger.info(`Created cache directory at ${this.cacheDir}`);
        }
        
        // Start periodic cleanup
        this.startCleanupInterval();
    }
    
    /**
     * Get the cache service instance
     * @param context The extension context
     */
    public static getInstance(context: vscode.ExtensionContext): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService(context);
        }
        return CacheService.instance;
    }
    
    /**
     * Set a value in the cache
     * @param key The cache key
     * @param value The value to cache
     * @param ttl Time to live in milliseconds (default: 1 hour)
     * @param persistent Whether to persist the cache to disk (default: false)
     */
    public async set<T>(key: string, value: T, ttl: number = 3600000, persistent: boolean = false): Promise<void> {
        const cacheKey = this.hashKey(key);
        const entry: CacheEntry<T> = {
            value,
            timestamp: Date.now(),
            ttl
        };
        
        // Store in memory cache
        this.memoryCache.set(cacheKey, entry);
        
        // Enforce memory cache size limit
        if (this.memoryCache.size > this.maxMemoryCacheSize) {
            // Remove the oldest entry
            const oldestKey = this.getOldestCacheKey();
            if (oldestKey) {
                this.memoryCache.delete(oldestKey);
            }
        }
        
        // Persist to disk if requested
        if (persistent) {
            try {
                const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
                await fs.promises.writeFile(filePath, JSON.stringify(entry), 'utf-8');
                logger.debug(`Cached ${key} to disk at ${filePath}`);
            } catch (error) {
                logger.error(`Failed to write cache to disk for key ${key}`, error);
                // Continue even if disk cache fails
            }
        }
    }
    
    /**
     * Get a value from the cache
     * @param key The cache key
     * @param checkDisk Whether to check disk cache if not found in memory (default: true)
     */
    public async get<T>(key: string, checkDisk: boolean = true): Promise<T | null> {
        const cacheKey = this.hashKey(key);
        
        // Check memory cache first
        const memoryEntry = this.memoryCache.get(cacheKey) as CacheEntry<T> | undefined;
        if (memoryEntry) {
            // Check if the entry is still valid
            if (Date.now() - memoryEntry.timestamp < memoryEntry.ttl) {
                logger.debug(`Cache hit for ${key} (memory)`);
                return memoryEntry.value;
            } else {
                // Entry expired, remove it
                this.memoryCache.delete(cacheKey);
            }
        }
        
        // Check disk cache if requested
        if (checkDisk) {
            try {
                const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
                if (fs.existsSync(filePath)) {
                    const data = await fs.promises.readFile(filePath, 'utf-8');
                    const entry = JSON.parse(data) as CacheEntry<T>;
                    
                    // Check if the entry is still valid
                    if (Date.now() - entry.timestamp < entry.ttl) {
                        logger.debug(`Cache hit for ${key} (disk)`);
                        
                        // Store in memory cache for faster access next time
                        this.memoryCache.set(cacheKey, entry);
                        
                        return entry.value;
                    } else {
                        // Entry expired, remove it
                        await fs.promises.unlink(filePath);
                    }
                }
            } catch (error) {
                logger.error(`Failed to read cache from disk for key ${key}`, error);
                // Continue even if disk cache fails
            }
        }
        
        logger.debug(`Cache miss for ${key}`);
        return null;
    }
    
    /**
     * Remove a value from the cache
     * @param key The cache key
     */
    public async remove(key: string): Promise<void> {
        const cacheKey = this.hashKey(key);
        
        // Remove from memory cache
        this.memoryCache.delete(cacheKey);
        
        // Remove from disk cache
        try {
            const filePath = path.join(this.cacheDir, `${cacheKey}.json`);
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
                logger.debug(`Removed cache for ${key}`);
            }
        } catch (error) {
            logger.error(`Failed to remove cache from disk for key ${key}`, error);
        }
    }
    
    /**
     * Clear all cache entries
     */
    public async clear(): Promise<void> {
        // Clear memory cache
        this.memoryCache.clear();
        
        // Clear disk cache
        try {
            const files = await fs.promises.readdir(this.cacheDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    await fs.promises.unlink(path.join(this.cacheDir, file));
                }
            }
            logger.info('Cache cleared');
        } catch (error) {
            logger.error('Failed to clear disk cache', error);
        }
    }
    
    /**
     * Hash a key to create a safe filename
     * @param key The key to hash
     */
    private hashKey(key: string): string {
        return crypto.createHash('md5').update(key).digest('hex');
    }
    
    /**
     * Get the oldest cache key
     */
    private getOldestCacheKey(): string | undefined {
        let oldestKey: string | undefined;
        let oldestTimestamp = Infinity;
        
        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.timestamp < oldestTimestamp) {
                oldestTimestamp = entry.timestamp;
                oldestKey = key;
            }
        }
        
        return oldestKey;
    }
    
    /**
     * Start the cleanup interval
     */
    private startCleanupInterval(): void {
        // Run cleanup every hour
        setInterval(() => {
            this.cleanup();
        }, 3600000);
    }
    
    /**
     * Clean up expired cache entries
     */
    private async cleanup(): Promise<void> {
        const now = Date.now();
        
        // Clean up memory cache
        for (const [key, entry] of this.memoryCache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.memoryCache.delete(key);
            }
        }
        
        // Clean up disk cache
        try {
            const files = await fs.promises.readdir(this.cacheDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(this.cacheDir, file);
                    try {
                        const data = await fs.promises.readFile(filePath, 'utf-8');
                        const entry = JSON.parse(data) as CacheEntry<any>;
                        
                        if (now - entry.timestamp > entry.ttl) {
                            await fs.promises.unlink(filePath);
                        }
                    } catch (error) {
                        // If we can't read the file, just delete it
                        await fs.promises.unlink(filePath);
                    }
                }
            }
        } catch (error) {
            logger.error('Failed to clean up disk cache', error);
        }
    }
    
    /**
     * Dispose the cache service
     */
    public dispose(): void {
        // Clear the memory cache
        this.memoryCache.clear();
    }
}
