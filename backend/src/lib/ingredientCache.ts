import type { IngredientEngineResult, PlanItem } from './ingredientEngine.js';

const TTL_MS = 60_000;

interface CacheEntry {
  result: IngredientEngineResult;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

export function hashPlanItems(items: PlanItem[]): string {
  return items
    .map((p) => `${p.product_id}:${p.total_batches}`)
    .sort()
    .join('|');
}

export function getCachedIngredientReport(key: string): IngredientEngineResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedIngredientReport(key: string, result: IngredientEngineResult): void {
  cache.set(key, { result, expires: Date.now() + TTL_MS });
}

export function clearIngredientCache(): void {
  cache.clear();
}
