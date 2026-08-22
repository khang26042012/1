// Fetch and cache suggested models for providers that expose a public models API
// Fetches via backend proxy to avoid CORS issues

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key: cacheKey → { data, expiresAt }

/**
 * Fetch suggested models for a provider using its modelsFetcher config.
 * Results are cached in-memory for CACHE_TTL_MS.
 *
 * @param {{ url: string, type: string }} fetcher
 * @param {{ connectionId?: string }} [options] — pass a connectionId for
 *   authenticated discovery (hcnsec/forge/tokenrouter gate /v1/models behind
 *   an API key). The server resolves the key from the connection; the raw key
 *   never reaches the client.
 * @returns {Promise<Array<{ id: string, name: string, contextLength?: number }>>}
 */
export async function fetchSuggestedModels(fetcher, options = {}) {
  if (!fetcher?.url || !fetcher?.type) return [];

  const cacheKey = options.connectionId
    ? `${fetcher.url}::${options.connectionId}`
    : fetcher.url;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const params = new URLSearchParams({ url: fetcher.url, type: fetcher.type });
    if (options.connectionId) params.set("connectionId", options.connectionId);
    const res = await fetch(`/api/providers/suggested-models?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    const data = json.data ?? [];
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return [];
  }
}
