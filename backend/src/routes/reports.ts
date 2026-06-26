import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isAdmin, isScaler, isSupervisor } from '../middleware/auth.js';
import { computeIngredients } from '../lib/ingredientEngine.js';

const router = Router();
router.use(authenticate);

// GET /api/reports/logs — system audit log (admin)
router.get('/logs', isAdmin, async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const actionFilter = req.query.action as string | undefined;
  const entityFilter = req.query.entity as string | undefined;

  let logsQuery = supabase
    .from('system_logs')
    .select(`
      id, action, entity, entity_id, meta, created_at,
      users ( id, full_name, role )
    `, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (actionFilter) logsQuery = logsQuery.eq('action', actionFilter);
  if (entityFilter) logsQuery = logsQuery.eq('entity', entityFilter);

  const { data, error, count } = await logsQuery.range(offset, offset + limit - 1);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ logs: data, total: count, limit, offset });
});

// GET /api/reports/overview — admin dashboard stats
router.get('/overview', isAdmin, async (_req: Request, res: Response) => {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [branches, users, products, orders, ingredients, shortages] = await Promise.all([
    supabase.from('branches').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('v_ingredient_stock_status').select('computed_status').in('computed_status', ['low','critical','out_of_stock']),
    supabase.from('system_logs').select('id', { count: 'exact', head: true })
      .in('action', ['PRODUCTION_PLAN_SHORTAGE', 'LOW_STOCK_ALERT'])
      .gte('created_at', oneWeekAgo),
  ]);

  res.json({
    active_branches: branches.count ?? 0,
    active_users: users.count ?? 0,
    active_products: products.count ?? 0,
    pending_orders: orders.count ?? 0,
    stock_alerts: ingredients.data?.length ?? 0,
    production_shortages: shortages.count ?? 0,
  });
});

// GET /api/reports/low-stock — scaler can inspect current low stock ingredients
router.get('/low-stock', isScaler, async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('v_ingredient_stock_status')
    .select('id,name,current_stock_g,reorder_threshold_g,computed_status');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const shortages = (data ?? [])
    .filter((item: any) => ['low', 'critical', 'out_of_stock'].includes(item.computed_status))
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      ingredient_id: item.id,
      ingredient_name: item.name,
      shortage_g: Math.max(0, item.reorder_threshold_g - item.current_stock_g),
      computed_status: item.computed_status,
      current_stock_g: item.current_stock_g,
      reorder_threshold_g: item.reorder_threshold_g,
    }));

  res.json({ shortages });
});

// GET /api/reports/plan-shortages/:date — scaler can inspect shortages for a production plan date
router.get('/plan-shortages/:date', isScaler, async (req: Request, res: Response) => {
  const refresh = req.query.refresh === 'true';

  const { data: plan, error: planErr } = await supabase
    .from('production_plans')
    .select(`
      id, ingredient_report,
      production_plan_items ( product_id, total_batches )
    `)
    .eq('production_date', req.params.date)
    .single();

  if (planErr && planErr.message !== 'Result returned no rows') {
    res.status(500).json({ error: planErr.message });
    return;
  }

  if (!plan) {
    const emptyReport = await computeIngredients([]);
    res.json({ plan_exists: false, ingredient_report: emptyReport });
    return;
  }

  let ingredientReport = plan.ingredient_report as Awaited<ReturnType<typeof computeIngredients>> | null;

  if (!ingredientReport || refresh) {
    ingredientReport = await computeIngredients(
      (plan.production_plan_items ?? []).map((item: { product_id: string; total_batches: number }) => ({
        product_id: item.product_id,
        total_batches: item.total_batches,
      })),
      { skipCache: refresh }
    );

    await supabase
      .from('production_plans')
      .update({
        ingredient_report: ingredientReport,
        ingredient_report_computed_at: new Date().toISOString(),
      })
      .eq('id', plan.id);
  }

  res.json({ plan_exists: true, ingredient_report: ingredientReport });
});

// POST /api/reports/notify-shortage — scaler alerts admin to low stock
router.post('/notify-shortage', isScaler, [
  body('production_date').isISO8601(),
  body('shortages').isArray({ min: 1 }),
  body('shortages.*.ingredient_id').isString().notEmpty(),
  body('shortages.*.ingredient_name').isString().notEmpty(),
  body('shortages.*.shortage_g').isNumeric(),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { production_date, shortages } = req.body;
  const { error } = await supabase.from('system_logs').insert([{ 
    user_id: req.user!.id,
    action: 'LOW_STOCK_ALERT',
    entity: 'production_plans',
    entity_id: null,
    meta: {
      production_date,
      shortage_count: shortages.length,
      shortages,
    },
  }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ message: 'Admin notified of low stock alert.' });
});

// GET /api/reports/daily/:date — supervisor summary
router.get('/daily/:date', isSupervisor, async (req: Request, res: Response) => {
  const { data: plan } = await supabase
    .from('production_plans')
    .select(`
      id, production_date, is_finalized,
      production_plan_items (
        product_id, total_batches,
        products ( name, dough_type ),
        tasks ( status, task_role, batches_assigned )
      )
    `)
    .eq('production_date', req.params.date)
    .single();

  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, is_special, branches(name)')
    .eq('work_day', req.params.date);

  res.json({ plan, orders: orders ?? [] });
});

export default router;
