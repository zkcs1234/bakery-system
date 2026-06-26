import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isSupervisor, isWorker } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/issues — list issues (supervisor sees all, workers see own)
router.get('/', async (req: Request, res: Response) => {
  let q = supabase.from('production_issues')
    .select(`
      *,
      reported_by_user:users!production_issues_reported_by_fkey ( id, full_name, role ),
      resolved_by_user:users!production_issues_resolved_by_fkey ( id, full_name ),
      production_plan_items (
        id, total_batches,
        products ( id, name, dough_type, base_yield_qty, yield_unit ),
        production_plans ( production_date )
      ),
      orders ( id, branch_id, branches ( name ) )
    `)
    .order('created_at', { ascending: false });

  if (req.query.status) q = q.eq('status', req.query.status as string);
  if (!['supervisor','admin'].includes(req.user!.role)) {
    q = q.eq('reported_by', req.user!.id);
  }

  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ issues: data });
});

// POST /api/issues — any worker/branch reports an issue
router.post(
  '/',
  isWorker,
  [
    body('issue_type').isIn(['excess_ingredient','shortage_mistake','cancellation','quality_issue','other']),
    body('description').trim().notEmpty(),
    body('plan_item_id').optional().isUUID(),
    body('order_id').optional().isUUID(),
    body('task_id').optional().isUUID(),
    body('excess_batches').optional().isFloat({ min: 0 }),
    body('affected_batches').optional().isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { issue_type, description, plan_item_id, order_id, task_id, excess_batches, affected_batches } = req.body;

    const { data, error } = await supabase
      .from('production_issues')
      .insert({
        issue_type, description,
        plan_item_id: plan_item_id ?? null,
        order_id: order_id ?? null,
        task_id: task_id ?? null,
        excess_batches: excess_batches ?? null,
        affected_batches: affected_batches ?? null,
        reported_by: req.user!.id,
        status: 'open',
      })
      .select(`
        *,
        reported_by_user:users!production_issues_reported_by_fkey ( id, full_name, role ),
        production_plan_items ( id, total_batches, products ( id, name, dough_type, yield_unit ) )
      `)
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id, action: 'REPORT_ISSUE',
      entity: 'production_issues', entity_id: data.id,
      meta: { issue_type },
    });

    res.status(201).json({ issue: data });
  }
);

// PATCH /api/issues/:id/acknowledge — supervisor acknowledges
router.patch('/:id/acknowledge', isSupervisor, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('production_issues')
    .update({ status: 'acknowledged' })
    .eq('id', req.params.id)
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ issue: data });
});

// PATCH /api/issues/:id/resolve — supervisor writes resolution + optionally adjust repacking task
router.patch(
  '/:id/resolve',
  isSupervisor,
  [
    body('resolution').trim().notEmpty(),
    body('adjust_repack_task_id').optional().isUUID(),
    body('adjust_batches').optional().isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { resolution, adjust_repack_task_id, adjust_batches } = req.body;

    // Optionally adjust a repacking task's batches (e.g. split extra stock across branches)
    if (adjust_repack_task_id && adjust_batches !== undefined) {
      await supabase.from('tasks')
        .update({ batches_assigned: adjust_batches })
        .eq('id', adjust_repack_task_id);
    }

    const { data, error } = await supabase
      .from('production_issues')
      .update({
        status: 'resolved', resolution,
        resolved_by: req.user!.id, resolved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select().single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id, action: 'RESOLVE_ISSUE',
      entity: 'production_issues', entity_id: req.params.id,
      meta: { resolution },
    });

    res.json({ issue: data });
  }
);

export default router;
