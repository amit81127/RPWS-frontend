// backend/services/cacheService.js
// Ultra-fast in-memory cache with stampede protection (Single-Flight Promise Coalescing) & Stale-While-Revalidate

class EnhancedMemoryCache {
  constructor(defaultTtlMs = 10000, maxEntries = 1000) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.inflight = new Map();
    this.metrics = {
      hits: 0,
      misses: 0,
      staleHits: 0,
      stampedeAvoided: 0,
      totalHitsLatencyMs: 0,
      totalMissLatencyMs: 0,
    };

    // Periodic sweep to actively prevent memory buildup of expired keys
    this.cleanupInterval = setInterval(() => {
      this.pruneExpired();
    }, 60000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  pruneExpired() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.staleUntil) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.inflight.clear();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      // If beyond stale grace period, evict
      if (Date.now() > entry.staleUntil) {
        this.cache.delete(key);
        return null;
      }
      // Return stale entry with flag
      return { value: entry.value, isStale: true };
    }

    return { value: entry.value, isStale: false };
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      expiry: now + ttlMs,
      staleUntil: now + ttlMs + 60000, // 60s stale grace window
    });
  }

  delete(key) {
    return this.cache.delete(key);
  }

  invalidatePrefix(prefix) {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    return size;
  }

  async getOrSet(key, fetchFn, ttlMs = this.defaultTtlMs) {
    const start = Date.now();

    // Guard: Prevent caching sensitive patterns
    if (key.includes("auth") || key.includes("password") || key.includes("token")) {
      const data = await fetchFn();
      return { data, source: "BYPASS" };
    }

    // 1. Check unexpired or stale memory cache
    const cacheResult = this.get(key);
    if (cacheResult !== null) {
      if (!cacheResult.isStale) {
        this.metrics.hits++;
        this.metrics.totalHitsLatencyMs += Date.now() - start;
        return { data: cacheResult.value, source: "HIT" };
      }

      // Stale-While-Revalidate: Return cached data instantly to client, refresh in background
      this.metrics.staleHits++;
      this.metrics.totalHitsLatencyMs += Date.now() - start;

      if (!this.inflight.has(key)) {
        const bgPromise = (async () => {
          try {
            const freshData = await fetchFn();
            if (freshData !== null && freshData !== undefined) {
              this.set(key, freshData, ttlMs);
            }
          } catch (_) {
            // Background refresh error ignored
          } finally {
            this.inflight.delete(key);
          }
        })();
        this.inflight.set(key, bgPromise);
      }

      return { data: cacheResult.value, source: "STALE_HIT" };
    }

    // 2. Coalesce concurrent requests onto in-flight promise (Stampede protection)
    if (this.inflight.has(key)) {
      this.metrics.stampedeAvoided++;
      try {
        const coalescedData = await this.inflight.get(key);
        return { data: coalescedData, source: "COALESCED" };
      } catch (err) {
        // Fall back to direct authoritative fetch on error
      }
    }

    // 3. Initiate single-flight authoritative database fetch
    const fetchPromise = (async () => {
      try {
        const result = await fetchFn();
        if (result !== null && result !== undefined) {
          this.set(key, result, ttlMs);
        }
        return result;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, fetchPromise);

    try {
      const data = await fetchPromise;
      this.metrics.misses++;
      this.metrics.totalMissLatencyMs += Date.now() - start;
      return { data, source: "MISS" };
    } catch (err) {
      this.metrics.misses++;
      throw err;
    }
  }

  getMetrics() {
    const totalRequests =
      this.metrics.hits + this.metrics.staleHits + this.metrics.misses + this.metrics.stampedeAvoided;
    const hitRatePercent =
      totalRequests > 0
        ? Number(
            (
              ((this.metrics.hits + this.metrics.staleHits + this.metrics.stampedeAvoided) /
                totalRequests) *
              100
            ).toFixed(1)
          )
        : 0;

    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      hits: this.metrics.hits,
      staleHits: this.metrics.staleHits,
      misses: this.metrics.misses,
      stampedeAvoided: this.metrics.stampedeAvoided,
      hitRatePercent,
      avgHitLatencyMs:
        this.metrics.hits + this.metrics.staleHits > 0
          ? Number(
              (
                this.metrics.totalHitsLatencyMs /
                (this.metrics.hits + this.metrics.staleHits)
              ).toFixed(2)
            )
          : 0,
      avgMissLatencyMs:
        this.metrics.misses > 0
          ? Number((this.metrics.totalMissLatencyMs / this.metrics.misses).toFixed(2))
          : 0,
    };
  }
}

function createCacheKey(prefix, params = {}) {
  const sortedKeys = Object.keys(params).sort();
  const serialized = sortedKeys
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
  return serialized ? `${prefix}:${serialized}` : prefix;
}

const publicFeedCache = new EnhancedMemoryCache(10000, 1000);

module.exports = {
  EnhancedMemoryCache,
  createCacheKey,
  publicFeedCache,
};
