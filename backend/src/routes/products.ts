import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isAdmin, isSupervisor } from '../middleware/auth.js';
import { clearIngredientCache } from '../lib/ingredientCache.js';

const router = Router();
router.use(authenticate);

const PRODUCT_SUMMARY_SELECT = `
  id, name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min, is_active
`;

const PRODUCT_DETAIL_SELECT = `
  id, name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min, is_active,
  created_at, updated_at,
  recipe_ingredients (
    id, ingredient_id, amount_value, amount_display, amount_unit, amount_g, notes, is_optional,
    ingredients ( id, name, unit )
  )
`;

// ─── GET /api/products/summary — lightweight catalog (no recipes) ─────────────
router.get('/summary', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SUMMARY_SELECT)
    .eq('is_active', true)
    .order('name');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ products: data });
});

// ─── GET /api/products — all products with their recipe ──────────────────────
router.get('/', async (req: Request, res: Response) => {
  const summaryOnly = req.query.summary === 'true' || req.query.summary === '1';

  if (summaryOnly) {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SUMMARY_SELECT)
      .order('name');

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ products: data });
    return;
  }

  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_DETAIL_SELECT)
    .order('name');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ products: data });
});

// ─── GET /api/products/:id ────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_DETAIL_SELECT)
    .eq('id', req.params.id)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json({ product: data });
});

// ─── POST /api/products — create product + recipe ─────────────────────────────
router.post(
  '/',
  isAdmin,
  [
    body('name').trim().notEmpty(),
    body('dough_type').isIn(['lean_hard_yeast','enriched_yeast','tangzhong','batter_quick_mix']),
    body('base_yield_qty').isInt({ min: 1 }),
    body('yield_unit').trim().notEmpty(),
    body('oven_temp_c').optional().isInt({ min: 100, max: 300 }),
    body('bake_time_min').optional().isInt({ min: 1 }),
    body('ingredients').isArray({ min: 1 }).withMessage('At least one ingredient required'),
    body('ingredients.*.ingredient_id').isUUID(),
    body('ingredients.*.amount_g').isFloat({ min: 0.01 }),
    body('ingredients.*.amount_value').optional().isNumeric(),
    body('ingredients.*.amount_display').optional().isString(),
    body('ingredients.*.amount_unit').optional().isString(),
    body('ingredients.*.amount_value').optional().isNumeric(),
    body('ingredients.*.amount_display').optional().isString(),
    body('ingredients.*.amount_unit').optional().isString(),
    body('ingredients.*.is_optional').optional().isBoolean(),
    body('ingredients.*.notes').optional().isString(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min, ingredients } = req.body;

    // Create product
    const { data: product, error: productErr } = await supabase
      .from('products')
      .insert({ name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min })
      .select()
      .single();

    if (productErr || !product) {
      res.status(500).json({ error: productErr?.message ?? 'Product creation failed' });
      return;
    }

    // Insert recipe ingredients
    const recipeRows = ingredients.map((ing: {
      ingredient_id: string;
      amount_g: number;
      amount_value?: number;
      amount_display?: string;
      amount_unit?: string;
      notes?: string;
      is_optional?: boolean;
    }) => ({
      product_id: product.id,
      ingredient_id: ing.ingredient_id,
      amount_g: ing.amount_g,
      amount_value: ing.amount_value ?? null,
      amount_display: ing.amount_display ?? null,
      amount_unit: ing.amount_unit ?? null,
      notes: ing.notes ?? null,
      is_optional: ing.is_optional ?? false,
    }));

    const { error: recipeErr } = await supabase
      .from('recipe_ingredients')
      .insert(recipeRows);

    if (recipeErr) {
      // Rollback product
      await supabase.from('products').delete().eq('id', product.id);
      res.status(500).json({ error: recipeErr.message });
      return;
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'CREATE_PRODUCT',
      entity: 'products',
      entity_id: product.id,
      meta: { name, dough_type },
    });

    res.status(201).json({ product });
  }
);

// ─── PATCH /api/products/:id — update product details ────────────────────────
router.patch('/:id', isAdmin, async (req: Request, res: Response) => {
  const allowed = ['name','dough_type','base_yield_qty','yield_unit','oven_temp_c','bake_time_min','is_active'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  await supabase.from('system_logs').insert({
    user_id: req.user!.id,
    action: 'UPDATE_PRODUCT',
    entity: 'products',
    entity_id: req.params.id,
    meta: updates,
  });

  res.json({ product: data });
});

// ─── PUT /api/products/:id/recipe — replace entire recipe ────────────────────
router.put(
  '/:id/recipe',
  isAdmin,
  [
    body('ingredients').isArray({ min: 1 }),
    body('ingredients.*.ingredient_id').isUUID(),
    body('ingredients.*.amount_g').isFloat({ min: 0.01 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const productId = req.params.id;
    const { ingredients } = req.body;

    // Delete existing recipe
    await supabase.from('recipe_ingredients').delete().eq('product_id', productId);

    // Re-insert
    const rows = ingredients.map((ing: {
      ingredient_id: string;
      amount_g: number;
      amount_value?: number;
      amount_display?: string;
      amount_unit?: string;
      notes?: string;
      is_optional?: boolean;
    }) => ({
      product_id: productId,
      ingredient_id: ing.ingredient_id,
      amount_g: ing.amount_g,
      amount_value: ing.amount_value ?? null,
      amount_display: ing.amount_display ?? null,
      amount_unit: ing.amount_unit ?? null,
      notes: ing.notes ?? null,
      is_optional: ing.is_optional ?? false,
    }));

    const { error } = await supabase.from('recipe_ingredients').insert(rows);
    if (error) { res.status(500).json({ error: error.message }); return; }

    clearIngredientCache();
    await supabase
      .from('production_plans')
      .update({ ingredient_report: null, ingredient_report_computed_at: null })
      .not('ingredient_report', 'is', null);

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'UPDATE_RECIPE',
      entity: 'products',
      entity_id: productId,
      meta: { ingredient_count: ingredients.length },
    });

    res.json({ message: 'Recipe updated. All future production plans will recompute.' });
  }
);

// ─── GET /api/products/dough-assignments — for mixer dashboard ────────────────
router.get('/meta/dough-assignments', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('v_product_dough_assignment')
    .select('id, product_name, dough_type, mixer_assignment, requires_starter_prep, base_yield_qty, yield_unit, oven_temp_c, bake_time_min');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ assignments: data });
});

export default router;
