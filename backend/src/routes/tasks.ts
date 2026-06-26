import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isSupervisor } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

async function markRelatedOrdersPacked(planItemId: string, userId: string): Promise<void> {
  const { data: planItem, error: planItemErr } = await supabase
    .from('production_plan_items')
    .select('product_id, plan_id, production_plans ( production_date )')
    .eq('id', planItemId)
    .single();

  if (planItemErr || !planItem) return;

  const productionDate = (planItem.production_plans as { production_date?: string } | null)?.production_date;
  if (!productionDate) return;

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, status, order_items ( product_id )')
    .eq('work_day', productionDate)
    .in('status', ['approved', 'in_production']);

  if (ordersErr || !orders || !orders.length) return;

  const productIds = Array.from(new Set(
    orders.flatMap((order: any) => (order.order_items ?? []).map((item: any) => item.product_id))
  ));

  if (!productIds.length) return;

  const { data: planItems, error: planItemsErr } = await supabase
    .from('production_plan_items')
    .select('product_id, tasks ( task_role, status )')
    .eq('plan_id', planItem.plan_id)
    .in('product_id', productIds);

  if (planItemsErr || !planItems) return;

  const completedProdIds = new Set(
    (planItems as any[])
      .filter((item: any) =>
        (item.tasks as any[]).some((task: any) => task.task_role === 'repacking' && task.status === 'completed')
      )
      .map((item: any) => item.product_id)
  );

  const orderIdsToPack: string[] = [];

  for (const order of orders as any[]) {
    const itemProductIds = Array.from(new Set(
      (order.order_items ?? []).map((item: any) => item.product_id)
    ));

    const isFullyPacked = itemProductIds.every((productId) => completedProdIds.has(productId));
    if (isFullyPacked && order.status !== 'packed') {
      orderIdsToPack.push(order.id);
    }
  }

  if (!orderIdsToPack.length) return;

  const { error: updateErr } = await supabase
    .from('orders')
    .update({ status: 'packed' })
    .in('id', orderIdsToPack);

  if (!updateErr) {
    await supabase.from('system_logs').insert({
      user_id: userId,
      action: 'ORDER_PACKED',
      entity: 'orders',
      entity_id: orderIdsToPack[0],
      meta: { packed_order_ids: orderIdsToPack },
    });
  }
}

// ─── GET /api/tasks/my — worker sees only their tasks for today/upcoming ──────
router.get('/my', async (req: Request, res: Response) => {
  const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

  // Step 1: Get the production plan ID for this date
  const { data: planData } = await supabase
    .from('production_plans')
    .select('id')
    .eq('production_date', date)
    .single();

  // Step 2: Get plan item IDs for this plan
  let planItemIds: string[] = [];
  if (planData) {
    const { data: items } = await supabase
      .from('production_plan_items')
      .select('id')
      .eq('plan_id', planData.id);
    planItemIds = (items ?? []).map((i) => i.id);
  }

  if (planItemIds.length === 0) {
    return res.json({ tasks: [], date });
  }

  // Step 3: Fetch tasks for this worker restricted to today's plan
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, task_role, batches_assigned, status, is_priority, notes, started_at, completed_at,
      production_plan_items (
        id, total_batches,
        products (
          id, name, dough_type, base_yield_qty, yield_unit,
          oven_temp_c, bake_time_min
        ),
        production_plans ( production_date ),
        tasks ( task_role, status )
      )
    `)
    .eq('assigned_to', req.user!.id)
    .in('plan_item_id', planItemIds)
    .order('is_priority', { ascending: false })
    .order('created_at');

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Step 4: For repacker role, filter to only show tasks where baking is completed
  let filteredData = data ?? [];
  if (req.user!.role === 'repacker') {
    filteredData = (data ?? []).filter((task) => {
      if (task.task_role !== 'repacking') return false;
      
      const planItem = task.production_plan_items as any;
      const planTasks = planItem?.tasks as Array<{ task_role?: string; status?: string }> | undefined;
      const bakingTasks = planTasks?.filter((t) => t.task_role === 'baking') ?? [];
      
      // Repacker can only see tasks where ALL baking is complete
      const bakingComplete = bakingTasks.length > 0 && bakingTasks.every((t) => t.status === 'completed');
      return bakingComplete;
    });
  }

  // Enrich scaler + mixer tasks with ingredient details
  const enriched = await Promise.all(
    (data ?? []).map(async (task) => {
      const planItem = (task.production_plan_items as unknown) as {
        total_batches: number;
        products: { id: string; dough_type: string } | null;
      } | null;

      if (task.task_role === 'scaling' || task.task_role === 'mixing') {
        const product = planItem?.products;
        if (product) {
          const { data: recipeIng } = await supabase
            .from('recipe_ingredients')
            .select(`
              amount_g, amount_value, amount_display, amount_unit, notes, is_optional,
              ingredients ( id, name, unit )
            `)
            .eq('product_id', product.id);

          const batches = task.batches_assigned;
          const ingredientList = (recipeIng ?? []).map((r) => ({
            ...r,
            total_amount_g: r.amount_g != null ? r.amount_g * batches : null,
          }));

          return { ...task, ingredient_list: ingredientList };
        }
      }

      return task;
    })
  );

  res.json({ tasks: enriched, date });
});

// ─── GET /api/tasks/my/active — tasks in progress right now ──────────────────
router.get('/my/active', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, task_role, batches_assigned, status, is_priority, started_at,
      production_plan_items (
        products ( name, dough_type )
      )
    `)
    .eq('assigned_to', req.user!.id)
    .in('status', ['pending', 'in_progress'])
    .order('is_priority', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ tasks: data });
});

// ─── PATCH /api/tasks/:id/status — worker updates task status ────────────────
router.patch(
  '/:id/status',
  [
    body('status').isIn(['in_progress', 'completed']),
    body('notes').optional().isString(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { status, notes } = req.body;

    // Verify task belongs to this worker (or supervisor can override)
    const { data: existing, error: fetchErr } = await supabase
      .from('tasks')
      .select('id, assigned_to, status, plan_item_id, task_role')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !existing) { res.status(404).json({ error: 'Task not found' }); return; }

    const isSupervisorUser = ['supervisor', 'admin'].includes(req.user!.role);
    if (!isSupervisorUser && existing.assigned_to !== req.user!.id) {
      res.status(403).json({ error: 'Not your task' });
      return;
    }

    // ─── REPACKING VALIDATION: Only if baker has finished baking THIS product ───
    if (!isSupervisorUser && existing.task_role === 'repacking' && ['in_progress', 'completed'].includes(status)) {
      // Get the product name for error message
      const { data: planItem, error: planItemErr } = await supabase
        .from('production_plan_items')
        .select('id, tasks ( status, task_role ), products ( name )')
        .eq('id', existing.plan_item_id)
        .single();

      const productName = (planItem?.products as any)?.name ?? 'this product';
      
      // Get the baking task status from the nested tasks array
      const planItemData = planItem as any;
      const tasks = planItemData?.tasks ?? [];
      const bakingTask = tasks.find((t: any) => t.task_role === 'baking');

      // Debug logging
      console.log('🔍 REPACKING VALIDATION DEBUG:', {
        repacking_task_id: req.params.id,
        plan_item_id: existing.plan_item_id,
        product_name: productName,
        all_tasks_in_plan: tasks.map((t: any) => ({ role: t.task_role, status: t.status })),
        baking_task_found: !!bakingTask,
        baking_task_status: bakingTask?.status,
      });

      if (planItemErr) { 
        console.error('❌ Error fetching plan item:', planItemErr);
        res.status(500).json({ 
          error: `Error checking baking status: ${planItemErr.message}`
        }); 
        return; 
      }

      const bakingComplete = bakingTask?.status === 'completed';
      if (!bakingComplete) {
        res.status(400).json({
          error: `Cannot pack ${productName} yet. The baker must finish baking it first.`,
          debug: {
            baking_task_found: !!bakingTask,
            current_baking_status: bakingTask?.status ?? 'not_found',
            expected_status: 'completed',
            plan_item_id: existing.plan_item_id,
            all_task_statuses: tasks.map((t: any) => `${t.task_role}:${t.status}`),
          }
        });
        return;
      }
    }

    // ─── GENERAL STAGE DEPENDENCIES (for mixing, baking, etc.) ───
    const dependencyMap: Record<string, string[]> = {
      mixing: ['scaling'],
      baking: ['mixing'],
      repacking: [],  // Repacking handled above with specific product logic
    };

    const dependencies = dependencyMap[existing.task_role] ?? [];
    if (!isSupervisorUser && dependencies.length && ['in_progress', 'completed'].includes(status)) {
      const { data: depTasks, error: depErr } = await supabase
        .from('tasks')
        .select('status')
        .eq('plan_item_id', existing.plan_item_id)
        .in('task_role', dependencies);

      if (depErr) { res.status(500).json({ error: depErr.message }); return; }

      const incomplete = (depTasks ?? []).some((task) => task.status !== 'completed');
      if (incomplete) {
        res.status(400).json({
          error: `Cannot update ${existing.task_role} task until the previous stage is completed.`,
        });
        return;
      }
    }

    // Completed tasks cannot be re-opened without supervisor override
    if (existing.status === 'completed' && !isSupervisorUser) {
      res.status(400).json({ error: 'Completed tasks cannot be changed without supervisor override' });
      return;
    }

    const updates: Record<string, unknown> = {
      status,
      notes: notes ?? null,
    };

    if (status === 'in_progress') updates.started_at = new Date().toISOString();
    if (status === 'completed')   updates.completed_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Log task completion for debugging
    if (status === 'completed' && existing.task_role === 'baking') {
      console.log('✅ BAKER COMPLETED TASK:', {
        task_id: req.params.id,
        plan_item_id: existing.plan_item_id,
        task_role: existing.task_role,
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: `TASK_${status.toUpperCase()}`,
      entity: 'tasks',
      entity_id: req.params.id,
    });

    if (status === 'completed' && existing.task_role === 'repacking') {
      await markRelatedOrdersPacked(existing.plan_item_id, req.user!.id);
    }

    res.json({ task: data });
  }
);

// ─── GET /api/tasks/debug/:plan_item_id — inspect task states (DEV ONLY) ─────
router.get('/debug/:plan_item_id', isSupervisor, async (req: Request, res: Response) => {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select(`
      id, task_role, status, assigned_to, batches_assigned,
      started_at, completed_at,
      production_plan_items (
        id, total_batches,
        products ( id, name ),
        production_plans ( production_date )
      )
    `)
    .eq('plan_item_id', req.params.plan_item_id)
    .order('task_role');

  if (error) { res.status(500).json({ error: error.message }); return; }

  const planItem = (tasks?.[0]?.production_plan_items as any) ?? null;
  
  res.json({
    plan_item_id: req.params.plan_item_id,
    product: planItem?.products,
    production_date: planItem?.production_plans?.production_date,
    tasks: tasks?.map(t => ({
      id: t.id,
      role: t.task_role,
      status: t.status,
      batches: t.batches_assigned,
      started: t.started_at,
      completed: t.completed_at,
    })),
    summary: {
      total_tasks: tasks?.length ?? 0,
      baking_status: (tasks?.find((t: any) => t.task_role === 'baking')?.status) ?? 'not_found',
      repacking_status: (tasks?.find((t: any) => t.task_role === 'repacking')?.status) ?? 'not_found',
    }
  });
});

// ─── PATCH /api/tasks/:id/override — supervisor unlocks completed task ────────
router.patch(
  '/:id/override',
  isSupervisor,
  [body('status').isIn(['pending', 'in_progress'])],
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: req.body.status,
        override_by: req.user!.id,
        completed_at: null,
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'TASK_OVERRIDE',
      entity: 'tasks',
      entity_id: req.params.id,
      meta: { new_status: req.body.status },
    });

    res.json({ task: data });
  }
);

// ─── GET /api/tasks/progress/:plan_id — supervisor tracker ───────────────────
router.get('/progress/:plan_id', isSupervisor, async (req: Request, res: Response) => {
  // Get plan item IDs for this plan
  const { data: items } = await supabase
    .from('production_plan_items')
    .select('id')
    .eq('plan_id', req.params.plan_id);

  const planItemIds = (items ?? []).map((i) => i.id);
  if (!planItemIds.length) {
    res.json({ tasks: [] });
    return;
  }

  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, task_role, batches_assigned, status, is_priority,
      assigned_user:users!tasks_assigned_to_fkey ( id, full_name, role ),
      production_plan_items (
        plan_id,
        products ( name )
      )
    `)
    .in('plan_item_id', planItemIds)
    .order('task_role')
    .order('status');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ tasks: data });
});

// ─── POST /api/tasks/:id/variance — log per-ingredient variance (scaling/mixing) ─
router.post(
  '/:id/variance',
  [
    body('ingredient_id').isString(),
    body('ingredient_name').optional().isString(),
    body('type').isIn(['over', 'short']),
    body('amount_g').isFloat({ gt: 0 }),
    body('note').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { ingredient_id, ingredient_name, type, amount_g, note } = req.body;

    // Verify task exists and belongs to this user (or supervisor)
    const { data: task, error: fetchErr } = await supabase
      .from('tasks')
      .select('id, assigned_to, status')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !task) { res.status(404).json({ error: 'Task not found' }); return; }

    const isSupervisorUser = ['supervisor', 'admin'].includes(req.user!.role);
    if (!isSupervisorUser && task.assigned_to !== req.user!.id) {
      res.status(403).json({ error: 'Not your task' });
      return;
    }

    // Try inserting into a dedicated `task_variances` table if available; otherwise fallback to `system_logs`.
    try {
      const payload = {
        task_id: req.params.id,
        ingredient_id,
        ingredient_name: ingredient_name ?? null,
        type,
        amount_g,
        note: note ?? null,
        reported_by: req.user!.id,
        reported_at: new Date().toISOString(),
      };

      const { data: insertData, error: insertErr } = await supabase
        .from('task_variances')
        .insert(payload)
        .select()
        .single();

      if (!insertErr) {
        await supabase.from('system_logs').insert({
          user_id: req.user!.id,
          action: 'TASK_VARIANCE',
          entity: 'tasks',
          entity_id: req.params.id,
          meta: payload,
        });
        res.json({ variance: insertData });
        return;
      }

      // Fallback: table might not exist — record in system_logs
      await supabase.from('system_logs').insert({
        user_id: req.user!.id,
        action: 'TASK_VARIANCE_FALLBACK',
        entity: 'tasks',
        entity_id: req.params.id,
        meta: { ingredient_id, ingredient_name, type, amount_g, note },
      });

      res.json({ ok: true, fallback: true });
      return;
    } catch (e: unknown) {
      res.status(500).json({ error: (e as Error).message ?? 'Failed to log variance' });
    }
  }
);

export default router;
