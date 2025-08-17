/**
 * Git Repository Detection Cache
 * 
 * Provides caching for expensive Git repository detection operations
 * to improve performance when working with many files.
 */

interface CacheEntry {
  repoRoot: string | null;
  timestamp: number;
}

export class GitRepoCache {
  private static instance: GitRepoCache;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
  private readonly MAX_ENTRIES = 1000; // Prevent unbounded growth

  private constructor() {}

  static getInstance(): GitRepoCache {
    if (!GitRepoCache.instance) {
      GitRepoCache.instance = new GitRepoCache();
    }
    return GitRepoCache.instance;
  }

  /**
   * Get cached repository root for a path
   */
  get(path: string): string | null | undefined {
    const entry = this.cache.get(path);
    
    if (!entry) {
      return undefined; // Not in cache
    }

    // Check if entry is still valid
    const now = Date.now();
    if (now - entry.timestamp > this.TTL_MS) {
      this.cache.delete(path);
      return undefined; // Expired
    }

    return entry.repoRoot;
  }

  /**
   * Set cached repository root for a path
   */
  set(path: string, repoRoot: string | null): void {
    // Enforce max cache size
    if (this.cache.size >= this.MAX_ENTRIES && !this.cache.has(path)) {
      // Remove oldest entry (first in map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(path, {
      repoRoot,
      timestamp: Date.now()
    });
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [path, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.TTL_MS) {
        this.cache.delete(path);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_ENTRIES,
      ttlMs: this.TTL_MS
    };
  }

  /**
   * Invalidate cache entries for a specific repository
   */
  invalidateRepo(repoRoot: string): void {
    for (const [path, entry] of this.cache.entries()) {
      if (entry.repoRoot === repoRoot) {
        this.cache.delete(path);
      }
    }
  }

  /**
   * Invalidate cache entries under a specific path
   */
  invalidatePath(basePath: string): void {
    for (const [path] of this.cache.entries()) {
      if (path.startsWith(basePath)) {
        this.cache.delete(path);
      }
    }
  }
}

/**
 * Export singleton instance methods for convenience
 */
export const gitRepoCache = GitRepoCache.getInstance();