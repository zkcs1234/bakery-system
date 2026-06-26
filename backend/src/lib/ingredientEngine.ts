/**
 * ingredientEngine.ts
 * ─────────────────────────────────────────────
 * Core business logic for dynamic ingredient computation.
 * Called during production plan generation and re-computation.
 *
 * Business rules implemented:
 * 1. Multiply recipe_ingredients × batch_count per product
 * 2. Aggregate identical ingredients across all products
 * 3. Compare totals against current_stock
 * 4. Return pull list (what to grab) + shortage list (what's missing)
 */

import supabase from './supabase.js';
import {
  getCachedIngredientReport,
  hashPlanItems,
  setCachedIngredientReport,
} from './ingredientCache.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanItem {
  product_id: string;
  total_batches: number;
}

export interface IngredientRequirement {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  required_g: number;         // total grams needed across all batches
  available_g: number;        // current stock
  shortage_g: number;         // 0 if sufficient, positive if short
  is_sufficient: boolean;
  is_optional: boolean;
}

export interface IngredientEngineResult {
  pull_list: IngredientRequirement[];
  shortage_list: IngredientRequirement[];
  has_shortages: boolean;
  total_products: number;
  total_batches: number;
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export async function computeIngredients(
  planItems: PlanItem[],
  options?: { skipCache?: boolean }
): Promise<IngredientEngineResult> {

  if (!planItems.length) {
    return emptyResult();
  }

  const cacheKey = hashPlanItems(planItems);
  if (!options?.skipCache) {
    const cached = getCachedIngredientReport(cacheKey);
    if (cached) return cached;
  }

  const productIds = planItems.map((p) => p.product_id);
  const batchMap = new Map(planItems.map((p) => [p.product_id, p.total_batches]));

  // 1. Fetch all recipe ingredients for products in this plan
  const { data: recipeRows, error: recipeErr } = await supabase
    .from('recipe_ingredients')
    .select(`
      product_id,
      ingredient_id,
      amount_g,
      is_optional,
      ingredients (
        id,
        name,
        unit,
        current_stock_g
      )
    `)
    .in('product_id', productIds);

  if (recipeErr) throw new Error(`Recipe fetch error: ${recipeErr.message}`);
  if (!recipeRows) return emptyResult();

  // 2. Build a map: ingredient_id → aggregated required_g
  const aggregation = new Map<string, {
    ingredient_id: string;
    ingredient_name: string;
    unit: string;
    required_g: number;
    available_g: number;
    is_optional: boolean;
  }>();

  for (const row of recipeRows) {
    const batchCount = batchMap.get(row.product_id);
    if (!batchCount) continue;
    const totalRequired = row.amount_g * batchCount;

    const ingredient = (row.ingredients as unknown) as {
      id: string;
      name: string;
      unit: string;
      current_stock_g: number;
    };

    if (aggregation.has(row.ingredient_id)) {
      aggregation.get(row.ingredient_id)!.required_g += totalRequired;
    } else {
      aggregation.set(row.ingredient_id, {
        ingredient_id: row.ingredient_id,
        ingredient_name: ingredient.name,
        unit: ingredient.unit,
        required_g: totalRequired,
        available_g: ingredient.current_stock_g,
        is_optional: row.is_optional,
      });
    }
  }

  // 3. Build full lists
  const pull_list: IngredientRequirement[] = [];
  const shortage_list: IngredientRequirement[] = [];

  for (const entry of aggregation.values()) {
    const shortage_g = Math.max(0, entry.required_g - entry.available_g);
    const requirement: IngredientRequirement = {
      ...entry,
      shortage_g,
      is_sufficient: shortage_g === 0,
    };

    pull_list.push(requirement);

    if (!requirement.is_sufficient && !entry.is_optional) {
      shortage_list.push(requirement);
    }
  }

  // Sort: shortages first, then alphabetical
  pull_list.sort((a, b) => {
    if (!a.is_sufficient && b.is_sufficient) return -1;
    if (a.is_sufficient && !b.is_sufficient) return 1;
    return a.ingredient_name.localeCompare(b.ingredient_name);
  });

  const totalBatches = planItems.reduce((sum, p) => sum + p.total_batches, 0);

  const result: IngredientEngineResult = {
    pull_list,
    shortage_list,
    has_shortages: shortage_list.length > 0,
    total_products: planItems.length,
    total_batches: totalBatches,
  };

  setCachedIngredientReport(cacheKey, result);
  return result;
}

// ─── Load Balancing Helper ────────────────────────────────────────────────────

export interface WorkerLoad {
  user_id: string;
  full_name: string;
  batches_assigned: number;
  is_overloaded: boolean;    // > avg * 1.3
  is_underloaded: boolean;   // < avg * 0.7
  load_percentage: number;   // relative to average
}

export function computeLoadBalance(
  workers: { user_id: string; full_name: string; batches_assigned: number }[]
): WorkerLoad[] {
  if (!workers.length) return [];

  const total = workers.reduce((sum, w) => sum + w.batches_assigned, 0);
  const avg = total / workers.length;

  return workers.map((w) => ({
    ...w,
    is_overloaded: avg > 0 && w.batches_assigned > avg * 1.3,
    is_underloaded: avg > 0 && w.batches_assigned < avg * 0.7,
    load_percentage: avg > 0 ? Math.round((w.batches_assigned / avg) * 100) : 0,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyResult(): IngredientEngineResult {
  return {
    pull_list: [],
    shortage_list: [],
    has_shortages: false,
    total_products: 0,
    total_batches: 0,
  };
}

/**
 * Deduces mixer team from dough type
 */
export function getMixerTeamForDoughType(
  doughType: string
): 'team_a' | 'team_b' | 'team_c' {
  switch (doughType) {
    case 'lean_hard_yeast':
      return 'team_a';
    case 'enriched_yeast':
    case 'tangzhong':
      return 'team_b';
    case 'batter_quick_mix':
    default:
      return 'team_c';
  }
}

/**
 * Returns 15-min buffer flag for Tangzhong products
 */
export function requiresStarterPrep(doughType: string): boolean {
  return doughType === 'tangzhong';
}
