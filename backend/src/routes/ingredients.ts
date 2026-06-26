import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isAdmin, isScaler, isSupervisor } from '../middleware/auth.js';
import { clearIngredientCache } from '../lib/ingredientCache.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();
router.use(authenticate);

const STOCK_VIEW_SELECT = `
  id, name, unit, current_stock_g, reorder_threshold_g, computed_status
`;

const INGREDIENT_DETAIL_SELECT = `
  id, name, unit, current_stock_g, reorder_threshold_g, stock_status, created_at, updated_at
`;

// GET /api/ingredients
router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('v_ingredient_stock_status')
    .select(STOCK_VIEW_SELECT);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ingredients: data });
});

// GET /api/ingredients/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('ingredients')
    .select(INGREDIENT_DETAIL_SELECT)
    .eq('id', req.params.id)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Ingredient not found' }); return; }
  res.json({ ingredient: data });
});

// POST /api/ingredients — admin creates master ingredient
router.post(
  '/',
  isAdmin,
  [
    body('name').trim().notEmpty(),
    body('unit').isIn(['g','kg','ml','l','pcs']),
    body('current_stock_g').isFloat({ min: 0 }),
    body('reorder_threshold_g').isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { data, error } = await supabase
      .from('ingredients')
      .insert(req.body)
      .select(INGREDIENT_DETAIL_SELECT)
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    clearIngredientCache();
    res.status(201).json({ ingredient: data });
  }
);

// PATCH /api/ingredients/:id — admin updates master data
router.patch('/:id', isAdmin, async (req: Request, res: Response) => {
  const allowed = ['name','unit','reorder_threshold_g','current_stock_g'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const { data, error } = await supabase
    .from('ingredients')
    .update(updates)
    .eq('id', req.params.id)
    .select(INGREDIENT_DETAIL_SELECT)
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  clearIngredientCache();
  await supabase
    .from('production_plans')
    .update({ ingredient_report: null, ingredient_report_computed_at: null })
    .not('ingredient_report', 'is', null);

  const { data: updatedIngredient, error: viewError } = await supabase
    .from('v_ingredient_stock_status')
    .select(STOCK_VIEW_SELECT)
    .eq('id', req.params.id)
    .single();

  if (viewError || !updatedIngredient) {
    res.json({ ingredient: data });
    return;
  }

  res.json({ ingredient: updatedIngredient });
});

// POST /api/ingredients/:id/adjust — scaler adjusts stock (delivery or pull)
router.post(
  '/:id/adjust',
  isScaler,
  [
    body('delta_g').isFloat().withMessage('delta_g required (negative=pull, positive=delivery)'),
    body('reason').trim().notEmpty(),
    body('plan_id').optional().isUUID(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { delta_g, reason, plan_id } = req.body;
    const ingredientId = req.params.id;

    const { data: ing, error: fetchErr } = await supabase
      .from('ingredients')
      .select('current_stock_g')
      .eq('id', ingredientId)
      .single();

    if (fetchErr || !ing) { res.status(404).json({ error: 'Ingredient not found' }); return; }

    const newStock = Math.max(0, ing.current_stock_g + delta_g);

    await supabase
      .from('ingredients')
      .update({ current_stock_g: newStock })
      .eq('id', ingredientId);

    clearIngredientCache();
    await supabase
      .from('production_plans')
      .update({ ingredient_report: null, ingredient_report_computed_at: null })
      .not('ingredient_report', 'is', null);

    const { data: tx, error: txErr } = await supabase
      .from('ingredient_transactions')
      .insert({
        ingredient_id: ingredientId,
        plan_id: plan_id ?? null,
        delta_g,
        reason,
        performed_by: req.user!.id,
      })
      .select('id, ingredient_id, plan_id, delta_g, reason, performed_by, created_at')
      .single();

    if (txErr) { res.status(500).json({ error: txErr.message }); return; }

    const { data: updatedIngredient, error: viewError } = await supabase
      .from('v_ingredient_stock_status')
      .select(STOCK_VIEW_SELECT)
      .eq('id', ingredientId)
      .single();

    if (viewError || !updatedIngredient) {
      res.json({
        transaction: tx,
        new_stock_g: newStock,
      });
      return;
    }

    res.json({
      transaction: tx,
      new_stock_g: newStock,
      ingredient: updatedIngredient,
    });
  }
);

// GET /api/ingredients/:id/transactions
router.get('/:id/transactions', isSupervisor, async (req: Request, res: Response) => {
  const { limit, offset } = parsePagination(req, 50);

  const { data, error, count } = await supabase
    .from('ingredient_transactions')
    .select(`
      id, ingredient_id, plan_id, delta_g, reason, performed_by, created_at,
      users ( full_name )
    `, { count: 'exact' })
    .eq('ingredient_id', req.params.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({
    transactions: data,
    total: count ?? 0,
    limit,
    offset,
  });
});

export default router;
