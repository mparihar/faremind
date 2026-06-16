import { useState, useEffect } from 'react';

const DEFAULT_LIMIT = 25;
let cachedLimit: number | null = null;
let inflightPromise: Promise<number> | null = null;

function fetchLimit(): Promise<number> {
  if (cachedLimit !== null) return Promise.resolve(cachedLimit);
  if (inflightPromise) return inflightPromise;

  inflightPromise = fetch('/api/config/ai-recommendation-limit')
    .then((r) => r.json())
    .then((data) => {
      const val = typeof data.limit === 'number' ? data.limit : DEFAULT_LIMIT;
      cachedLimit = val;
      return val;
    })
    .catch(() => {
      cachedLimit = DEFAULT_LIMIT;
      return DEFAULT_LIMIT;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

/**
 * Hook that fetches the AI recommendation card limit from SystemConfig.
 * Deduplicates concurrent fetches so only one network request fires
 * even when many card components mount simultaneously.
 */
export function useAiRecommendationLimit(): number {
  const [limit, setLimit] = useState(cachedLimit ?? DEFAULT_LIMIT);

  useEffect(() => {
    if (cachedLimit !== null) return;
    fetchLimit().then(setLimit);
  }, []);

  return limit;
}
