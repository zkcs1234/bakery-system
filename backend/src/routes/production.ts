import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import dayjs from 'dayjs';
import supabase from '../lib/supabase.js';
import {
  authenticate,
  isSupervisor,
} from '../middleware/auth.js';
import {
  computeIngredients,
  computeLoadBalance,
  requiresStarterPrep,
  type IngredientEngineResult,
} from '../lib/ingredientEngine.js';

const router = Router();
router.use(authenticate);

const PLAN_ITEM_PRODUCT_SELECT = `
  id, name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min
`;

const TASK_USER_SELECT = `
  id, plan_item_id, assigned_to, task_role, batches_assigned, status, is_priority, notes,
  assigned_user:users!tasks_assigned_to_fkey ( id, full_name, role, mixer_team )
`;

async function persistIngredientReport(
  planId: string,
  report: IngredientEngineResult
): Promise<void> {
  await supabase
    .from('production_plans')
    .update({
      ingredient_report: report,
      ingredient_report_computed_at: new Date().toISOString(),
    })
    .eq('id', planId);
}

async function loadIngredientReport(
  plan: {
    id: string;
    ingredient_report?: IngredientEngineResult | null;
    production_plan_items?: { product_id: string; total_batches: number }[];
  },
  refresh = false
): Promise<IngredientEngineResult> {
  const planItems = ((plan.production_plan_items ?? []) as { product_id: string; total_batches: number }[]).map((i) => ({
    product_id: i.product_id,
    total_batches: i.total_batches,
  }));

  if (!refresh && plan.ingredient_report) {
    return plan.ingredient_report as IngredientEngineResult;
  }

  const report = await computeIngredients(planItems, { skipCache: refresh });
  await persistIngredientReport(plan.id, report);
  return report;
}

// ─── POST /api/production/generate — generate plan for a date ────────────────
router.post(
  '/generate',
  isSupervisor,
  [
    body('production_date')
      .isDate()
      .custom((val) => {
        const today = dayjs().startOf('day');
        const workDay = dayjs(val).startOf('day');
        if (workDay.isBefore(today)) {
          throw new Error(
            `Invalid work day. You selected ${workDay.format('MMMM D, YYYY')} ` +
            `but work days must be today (${today.format('MMMM D, YYYY')}) or later. ` +
            `Delivery will automatically be ${workDay.add(1, 'day').format('MMMM D, YYYY')}.`
          );
        }
        return true;
      }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { production_date, notes } = req.body;
    const workDate = dayjs(production_date).format('YYYY-MM-DD');
    const deliveryDate = dayjs(workDate).add(1, 'day').format('YYYY-MM-DD');

    // 1. Pull all APPROVED orders manually scheduled for this work day.
    //    Legacy support falls back to the old delivery_date = work_day + 1 rule.
    const { data: ordersByWorkDay, error: ordersErr } = await supabase
      .from('orders')
      .select(`
        id, is_special,
        order_items ( product_id, batches )
      `)
      .eq('work_day', workDate)
      .eq('status', 'approved');

    if (ordersErr) { res.status(500).json({ error: ordersErr.message }); return; }

    let orders = ordersByWorkDay ?? [];
    if (orders.length === 0) {
      const { data: legacyOrders, error: legacyErr } = await supabase
        .from('orders')
        .select(`
          id, is_special,
          order_items ( product_id, batches )
        `)
        .eq('delivery_date', deliveryDate)
        .eq('status', 'approved');

      if (legacyErr) { res.status(500).json({ error: legacyErr.message }); return; }
      orders = legacyOrders ?? [];
    }

    if (orders.length === 0) {
      const { data: allOrders, error: allOrdersErr } = await supabase
        .from('orders')
        .select('status')
        .eq('work_day', workDate);

      if (allOrdersErr) {
        res.status(500).json({ error: allOrdersErr.message });
        return;
      }

      const counts = (allOrders ?? []).reduce(
        (acc, order) => {
          const status = order.status as string;
          acc[status] = (acc[status] ?? 0) + 1;
          return acc;
        },
        { pending: 0, approved: 0, rejected: 0 } as Record<string, number>
      );

      res.status(400).json({
        error: `No approved orders found for work day ${dayjs(workDate).format('MMMM D, YYYY')}. Assign approved orders to that work day before generating a plan.`,
        details: {
          pending: counts.pending,
          approved: counts.approved,
          rejected: counts.rejected,
          message: `Work day: ${dayjs(workDate).format('MMMM D, YYYY')}`,
        },
      });
      return;
    }

    // 2. Consolidate: sum batches per product across all orders
    const consolidation = new Map<string, { total_batches: number; is_special: boolean }>();
    for (const order of orders) {
      for (const item of (order.order_items as { product_id: string; batches: number }[])) {
        const existing = consolidation.get(item.product_id);
        if (existing) {
          existing.total_batches += item.batches;
          if (order.is_special) existing.is_special = true;
        } else {
          consolidation.set(item.product_id, {
            total_batches: item.batches,
            is_special: order.is_special,
          });
        }
      }
    }

    // 3. Upsert production plan
    const { data: plan, error: planErr } = await supabase
      .from('production_plans')
      .upsert(
        {
          production_date,
          generated_by: req.user!.id,
          generated_at: new Date().toISOString(),
          notes: notes ?? null,
        },
        { onConflict: 'production_date' }
      )
      .select()
      .single();

    if (planErr || !plan) {
      res.status(500).json({ error: planErr?.message ?? 'Plan creation failed' });
      return;
    }

    // 4. Delete old tasks and plan items when regenerating the same plan
    const { data: existingItems, error: existingItemsErr } = await supabase
      .from('production_plan_items')
      .select('id')
      .eq('plan_id', plan.id);

    if (existingItemsErr) {
      res.status(500).json({ error: existingItemsErr.message });
      return;
    }

    const existingItemIds = (existingItems ?? []).map((item: { id: string }) => item.id);
    if (existingItemIds.length) {
      await supabase.from('tasks').delete().in('plan_item_id', existingItemIds);
    }

    await supabase.from('production_plan_items').delete().eq('plan_id', plan.id);

    // 5. Insert consolidated plan items
    const planItems = Array.from(consolidation.entries()).map(([product_id, val]) => ({
      plan_id: plan.id,
      product_id,
      total_batches: val.total_batches,
    }));

    const { data: insertedItems, error: itemsErr } = await supabase
      .from('production_plan_items')
      .insert(planItems)
      .select('id, product_id, total_batches, plan_id');

    if (itemsErr) { res.status(500).json({ error: itemsErr.message }); return; }

    const computeInput = planItems.map((p) => ({
      product_id: p.product_id,
      total_batches: p.total_batches,
    }));

    const workersPromise = supabase
      .from('users')
      .select('id, role, mixer_team')
      .in('role', ['scaler', 'mixer', 'baker', 'repacker'])
      .eq('is_active', true);

  // 6. Run ingredient computation engine (parallel with worker fetch)
    const [ingredientResult, workersResult] = await Promise.all([
      computeIngredients(computeInput, { skipCache: true }),
      workersPromise,
    ]);

    await persistIngredientReport(plan.id, ingredientResult);

    if (ingredientResult.has_shortages) {
      await supabase.from('system_logs').insert({
        user_id: req.user!.id,
        action: 'PRODUCTION_PLAN_SHORTAGE',
        entity: 'production_plans',
        entity_id: plan.id,
        meta: {
          production_date,
          order_count: orders.length,
          product_count: planItems.length,
          shortage_count: ingredientResult.shortage_list.length,
        },
      });
    }

    // 7. Auto-assign tasks based on worker roles and dough team, using least-loaded eligible workers.
    // Skip auto-assignment when ingredient shortages exist so the generated plan still returns,
    // but workers are not assigned until shortages are resolved.
    let assignedTasks: unknown[] = [];
    const { data: workers, error: workersErr } = workersResult;

    if (!ingredientResult.has_shortages && !workersErr && workers?.length) {
        const scalers = workers.filter((w: any) => w.role === 'scaler');
        const bakers = workers.filter((w: any) => w.role === 'baker');
        const repackers = workers.filter((w: any) => w.role === 'repacker');
        const mixers = workers.filter((w: any) => w.role === 'mixer');

        const loadMap = new Map<string, number>();
        workers.forEach((worker: any) => loadMap.set(worker.id, 0));

        const chooseLeastLoaded = (pool: any[]) => {
          return pool.reduce((minWorker, worker) => {
            if (!minWorker) return worker;
            const currentLoad = loadMap.get(worker.id) ?? 0;
            const minLoad = loadMap.get(minWorker.id) ?? 0;
            return currentLoad < minLoad ? worker : minWorker;
          }, pool[0]);
        };

        const taskRows: any[] = [];

        for (const item of (insertedItems ?? [])) {
          const scaler = scalers.length ? chooseLeastLoaded(scalers) : undefined;
          const baker = bakers.length ? chooseLeastLoaded(bakers) : undefined;
          const repacker = repackers.length ? chooseLeastLoaded(repackers) : undefined;
          const mixer = mixers.length ? chooseLeastLoaded(mixers) : undefined;

          if (scaler) {
            taskRows.push({
              plan_item_id: item.id,
              assigned_to: scaler.id,
              task_role: 'scaling',
              batches_assigned: item.total_batches,
              status: 'pending',
              is_priority: false,
              notes: null,
            });
            loadMap.set(scaler.id, (loadMap.get(scaler.id) ?? 0) + item.total_batches);
          }
          if (mixer) {
            taskRows.push({
              plan_item_id: item.id,
              assigned_to: mixer.id,
              task_role: 'mixing',
              batches_assigned: item.total_batches,
              status: 'pending',
              is_priority: false,
              notes: null,
            });
            loadMap.set(mixer.id, (loadMap.get(mixer.id) ?? 0) + item.total_batches);
          }
          if (baker) {
            taskRows.push({
              plan_item_id: item.id,
              assigned_to: baker.id,
              task_role: 'baking',
              batches_assigned: item.total_batches,
              status: 'pending',
              is_priority: false,
              notes: null,
            });
            loadMap.set(baker.id, (loadMap.get(baker.id) ?? 0) + item.total_batches);
          }
          if (repacker) {
            taskRows.push({
              plan_item_id: item.id,
              assigned_to: repacker.id,
              task_role: 'repacking',
              batches_assigned: item.total_batches,
              status: 'pending',
              is_priority: false,
              notes: null,
            });
            loadMap.set(repacker.id, (loadMap.get(repacker.id) ?? 0) + item.total_batches);
          }
        }

        if (taskRows.length) {
          const { data: tasks, error: tasksErr } = await supabase
            .from('tasks')
            .insert(taskRows)
            .select(TASK_USER_SELECT);

          if (!tasksErr) {
            assignedTasks = tasks ?? [];
          }
        }
    }

    // Attach product details in one batch query (instead of nested insert select)
    const productIds = planItems.map((p) => p.product_id);
    const { data: productRows } = await supabase
      .from('products')
      .select(PLAN_ITEM_PRODUCT_SELECT)
      .in('id', productIds);

    const productMap = new Map(
      (productRows ?? []).map((p: { id: string }) => [p.id, p])
    );

    const planItemsWithProducts = (insertedItems ?? []).map((item) => ({
      ...item,
      products: productMap.get(item.product_id) ?? null,
    }));

    // 7. Build dough-type groupings for mixer dashboard
    const doughGroups: Record<string, typeof planItemsWithProducts> = {
      lean_hard_yeast: [],
      enriched_yeast: [],
      tangzhong: [],
      batter_quick_mix: [],
    };

    for (const item of planItemsWithProducts) {
      const product = item.products as { dough_type: string } | null;
      if (product && doughGroups[product.dough_type]) {
        doughGroups[product.dough_type]!.push(item);
      }
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'GENERATE_PRODUCTION_PLAN',
      entity: 'production_plans',
      entity_id: plan.id,
      meta: { production_date, order_count: orders.length, product_count: planItems.length, task_count: assignedTasks.length },
    });

    res.status(201).json({
      plan,
      plan_items: planItemsWithProducts,
      tasks: assignedTasks,
      dough_groups: doughGroups,
      ingredient_report: ingredientResult,
      order_count: orders.length,
    });
  }
);

// ─── GET /api/production/plans/:date ─────────────────────────────────────────
router.get('/plans/:date', isSupervisor, async (req: Request, res: Response) => {
  const refresh = req.query.refresh === 'true';

  const { data: plan, error: planErr } = await supabase
    .from('production_plans')
    .select(`
      id, production_date, is_finalized, generated_at, generated_by, notes,
      ingredient_report, ingredient_report_computed_at,
      production_plan_items (
        id, product_id, total_batches,
        products ( ${PLAN_ITEM_PRODUCT_SELECT} ),
        tasks ( ${TASK_USER_SELECT} )
      )
    `)
    .eq('production_date', req.params.date)
    .single();

  if (planErr || !plan) {
    const { data: allOrders, error: allOrdersErr } = await supabase
      .from('orders')
      .select('status')
      .eq('work_day', req.params.date);

    if (allOrdersErr) {
      res.status(404).json({
        error: 'No production plan found for this work day. Additionally, order lookup failed.',
        details: { db_error: allOrdersErr.message },
      });
      return;
    }

    const counts = (allOrders ?? []).reduce(
      (acc, order) => {
        const status = order.status as string;
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0 } as Record<string, number>
    );

    const message = counts.approved > 0
      ? 'A plan has not been generated yet for this work day, but approved orders do exist. Generate one now.'
      : 'No production plan found for this work day. Assign approved orders to that work day, then generate a plan.';

    res.status(404).json({
      error: message,
      details: {
        pending: counts.pending,
        approved: counts.approved,
        rejected: counts.rejected,
      },
    });
    return;
  }

  const ingredientReport = await loadIngredientReport(plan, refresh);

  res.json({ plan, ingredient_report: ingredientReport });
});

// ─── GET /api/production/plans — list recent plans ───────────────────────────
router.get('/plans', isSupervisor, async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('production_plans')
    .select(`
      id, production_date, is_finalized, generated_at,
      generated_by_user:users ( full_name )
    `)
    .order('production_date', { ascending: false })
    .limit(30);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ plans: data });
});

// ─── POST /api/production/assign — assign tasks to workers ───────────────────
router.post(
  '/assign',
  isSupervisor,
  [
    body('plan_item_id').isUUID(),
    body('assignments').isArray({ min: 1 }),
    body('assignments.*.assigned_to').isUUID(),
    body('assignments.*.task_role').isIn(['scaling','mixing','baking','repacking']),
    body('assignments.*.batches_assigned').isInt({ min: 1 }),
    body('assignments.*.is_priority').optional().isBoolean(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { plan_item_id, assignments } = req.body;

    const { data: planItem, error: planItemErr } = await supabase
      .from('production_plan_items')
      .select('plan_id')
      .eq('id', plan_item_id)
      .single();

    if (planItemErr || !planItem) {
      res.status(404).json({ error: 'Plan item not found' });
      return;
    }

    // Collect the distinct roles being submitted so we can delete only those roles.
    // This is an atomic replace: delete old tasks for submitted roles, insert new ones.
    const roles = [...new Set(assignments.map((a: { task_role: string }) => a.task_role))];

    // Only delete tasks that are still pending — don't touch in_progress or completed tasks
    // to avoid stripping workers mid-work.
    const { error: deleteErr } = await supabase
      .from('tasks')
      .delete()
      .eq('plan_item_id', plan_item_id)
      .in('task_role', roles)
      .eq('status', 'pending');

    if (deleteErr) {
      res.status(500).json({ error: `Failed to clear old assignments: ${deleteErr.message}` });
      return;
    }

    // Insert all new assignments in one batch
    const taskRows = assignments.map((a: {
      assigned_to: string;
      task_role: string;
      batches_assigned: number;
      is_priority?: boolean;
      notes?: string;
    }) => ({
      plan_item_id,
      assigned_to: a.assigned_to,
      task_role: a.task_role,
      batches_assigned: a.batches_assigned,
      is_priority: a.is_priority ?? false,
      notes: a.notes ?? null,
      status: 'pending',
    }));

    const { data: tasks, error } = await supabase
      .from('tasks')
      .insert(taskRows)
      .select();

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'ASSIGN_TASKS',
      entity: 'production_plan_items',
      entity_id: plan_item_id,
      meta: { task_count: taskRows.length, roles },
    });

    res.status(201).json({ tasks });
  }
);

// ─── GET /api/production/workload/:plan_id ────────────────────────────────────
router.get('/workload/:plan_id', isSupervisor, async (req: Request, res: Response) => {
  // Get all plan_item IDs for this plan first
  const { data: items } = await supabase
    .from('production_plan_items')
    .select('id')
    .eq('plan_id', req.params.plan_id);

  const planItemIds = (items ?? []).map((i: { id: string }) => i.id);
  if (!planItemIds.length) {
    res.json({ workload: [] });
    return;
  }

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select(`
      task_role, batches_assigned,
      assigned_user:users!tasks_assigned_to_fkey ( id, full_name, role, mixer_team )
    `)
    .in('plan_item_id', planItemIds);

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Aggregate by worker and role
  const workerMap = new Map<string, { user_id: string; full_name: string; batches_assigned: number; roles: string[] }>();

  for (const task of (tasks ?? [])) {
    const user = (task.assigned_user as unknown) as { id: string; full_name: string } | null;
    if (!user) continue;

    const existing = workerMap.get(user.id);
    if (existing) {
      existing.batches_assigned += task.batches_assigned;
      if (!existing.roles.includes(task.task_role)) existing.roles.push(task.task_role);
    } else {
      workerMap.set(user.id, {
        user_id: user.id,
        full_name: user.full_name,
        batches_assigned: task.batches_assigned,
        roles: [task.task_role],
      });
    }
  }

  const workers = Array.from(workerMap.values());
  const loadBalance = computeLoadBalance(workers);

  res.json({ workload: loadBalance });
});

// ─── GET /api/production/ingredient-report/:date ─────────────────────────────
router.get('/ingredient-report/:date', isSupervisor, async (req: Request, res: Response) => {
  const refresh = req.query.refresh === 'true';

  const { data: plan, error } = await supabase
    .from('production_plans')
    .select(`
      id,
      ingredient_report,
      production_plan_items ( product_id, total_batches )
    `)
    .eq('production_date', req.params.date)
    .single();

  if (error || !plan) { res.status(404).json({ error: 'No plan for this date' }); return; }

  const report = await loadIngredientReport(plan, refresh);
  res.json({ date: req.params.date, report });
});
// ─── GET /api/production/pipeline/:date — per-product worker pipeline status ─
router.get('/pipeline/:date', isSupervisor, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('v_production_pipeline')
    .select(`
      plan_item_id, plan_id, production_date, product_id, product_name, dough_type,
      total_batches, task_id, task_role, task_status, batches_assigned, is_priority,
      started_at, completed_at, worker_id, worker_name
    `)
    .eq('production_date', req.params.date);

  if (error) { res.status(500).json({ error: error.message }); return; }

  type Row = {
    plan_item_id: string; product_id: string; product_name: string; dough_type: string;
    total_batches: number; task_id: string | null; task_role: string | null;
    task_status: string | null; batches_assigned: number | null; is_priority: boolean | null;
    started_at: string | null; completed_at: string | null;
    worker_id: string | null; worker_name: string | null;
  };

  const grouped = new Map<string, {
    plan_item_id: string; product_name: string; dough_type: string; total_batches: number;
    stages: Record<string, { task_id: string; status: string; batches_assigned: number; worker_name: string | null; is_priority: boolean; started_at: string | null; completed_at: string | null }[]>;
  }>();

  for (const row of (data as Row[] ?? [])) {
    if (!grouped.has(row.plan_item_id)) {
      grouped.set(row.plan_item_id, {
        plan_item_id: row.plan_item_id,
        product_name: row.product_name,
        dough_type: row.dough_type,
        total_batches: row.total_batches,
        stages: { scaling: [], mixing: [], baking: [], repacking: [] },
      });
    }
    if (row.task_role) {
      grouped.get(row.plan_item_id)!.stages[row.task_role].push({
        task_id: row.task_id!,
        status: row.task_status!,
        batches_assigned: row.batches_assigned ?? 0,
        worker_name: row.worker_name,
        is_priority: row.is_priority ?? false,
        started_at: row.started_at,
        completed_at: row.completed_at,
      });
    }
  }

  res.json({ pipeline: Array.from(grouped.values()) });
});
export default router;
