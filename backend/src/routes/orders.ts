import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import dayjs from 'dayjs';
import supabase from '../lib/supabase.js';
import {
  authenticate,
  isSupervisor,
  isBranchManager,
} from '../middleware/auth.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();
router.use(authenticate);

const ORDER_LIST_SELECT = `
  id, branch_id, placed_by, delivery_date, work_day, is_special, special_notes,
  status, approved_by, approved_at, created_at, updated_at,
  branches ( id, name ),
  placed_by_user:users!orders_placed_by_fkey ( id, full_name ),
  approved_by_user:users!orders_approved_by_fkey ( id, full_name ),
  order_items (
    id, batches,
    products ( id, name, dough_type, base_yield_qty, yield_unit )
  )
`;

const ORDER_DETAIL_SELECT = `
  id, branch_id, placed_by, delivery_date, work_day, is_special, special_notes,
  status, approved_by, approved_at, expires_at, created_at, updated_at,
  branches ( id, name ),
  placed_by_user:users!orders_placed_by_fkey ( id, full_name ),
  order_items (
    id, batches,
    products ( id, name, dough_type, base_yield_qty, yield_unit )
  )
`;

// ─── GET /api/orders/summary — lightweight status counts ─────────────────────
router.get('/summary', async (req: Request, res: Response) => {
  let query = supabase.from('orders').select('status, is_special, work_day');

  if (req.user!.role === 'branch_manager') {
    query = query.eq('branch_id', req.user!.branch_id!);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = data ?? [];
  const counts: Record<string, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    in_production: 0,
    packed: 0,
    delivered: 0,
    expired: 0,
    special_pending: 0,
    approved_unscheduled: 0,
    approved_scheduled: 0,
  };

  for (const row of rows) {
    const status = row.status as string;
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 'pending' && row.is_special) counts.special_pending += 1;
    if (status === 'approved' && !row.work_day) counts.approved_unscheduled += 1;
    if (status === 'approved' && row.work_day) counts.approved_scheduled += 1;
  }

  res.json({
    counts,
    total: rows.length,
  });
});

// ─── GET /api/orders — list orders (filtered by role, paginated) ─────────────
router.get('/', async (req: Request, res: Response) => {
  const { limit, offset } = parsePagination(req);

  let queryBuilder = supabase
    .from('orders')
    .select(ORDER_LIST_SELECT, { count: 'exact' })
    .order('delivery_date', { ascending: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (req.user!.role === 'branch_manager') {
    queryBuilder = queryBuilder.eq('branch_id', req.user!.branch_id!);
  }

  if (req.query.status) {
    queryBuilder = queryBuilder.eq('status', req.query.status as string);
  }

  if (req.query.date) {
    queryBuilder = queryBuilder.eq('delivery_date', req.query.date as string);
  }

  if (req.query.work_day) {
    queryBuilder = queryBuilder.eq('work_day', req.query.work_day as string);
  }

  const { data, error, count } = await queryBuilder;
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({
    orders: data,
    total: count ?? 0,
    limit,
    offset,
  });
});

// ─── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_DETAIL_SELECT)
    .eq('id', req.params.id)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Order not found' }); return; }

  if (
    req.user!.role === 'branch_manager' &&
    data.branch_id !== req.user!.branch_id
  ) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  res.json({ order: data });
});

// ─── POST /api/orders — place order (branch manager) ─────────────────────────
router.post(
  '/',
  isBranchManager,
  [
    body('delivery_date')
      .isDate()
      .custom((val) => {
        const tomorrow = dayjs().add(1, 'day').startOf('day');
        if (dayjs(val).isBefore(tomorrow)) {
          throw new Error('Delivery date must be at least 1 day in the future');
        }
        return true;
      }),
    body('is_special').optional().isBoolean(),
    body('special_notes').optional({ nullable: true }).isString(),
    body('items').isArray({ min: 1 }).withMessage('At least one order item required'),
    body('items.*.product_id')
      .isString()
      .custom((value) => {
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRegex.test(value)) {
          throw new Error('Invalid product_id format');
        }
        return true;
      }),
    body('items.*.batches').isInt({ min: 1 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { delivery_date, is_special, special_notes, items } = req.body;
    const branch_id = req.user!.branch_id;

    if (!branch_id) {
      res.status(400).json({ error: 'User has no assigned branch' });
      return;
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        branch_id,
        placed_by: req.user!.id,
        delivery_date,
        is_special: is_special ?? false,
        special_notes: special_notes ?? null,
        status: 'pending',
      })
      .select('id, branch_id, delivery_date, status, created_at')
      .single();

    if (orderErr || !order) {
      res.status(500).json({ error: orderErr?.message ?? 'Order creation failed' });
      return;
    }

    const orderItems = items.map((item: { product_id: string; batches: number }) => ({
      order_id: order.id,
      product_id: item.product_id,
      batches: item.batches,
    }));

    const { error: itemsErr } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsErr) {
      await supabase.from('orders').delete().eq('id', order.id);
      res.status(500).json({ error: itemsErr.message });
      return;
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'PLACE_ORDER',
      entity: 'orders',
      entity_id: order.id,
      meta: { delivery_date, is_special, item_count: items.length },
    });

    res.status(201).json({ order });
  }
);

// ─── PATCH /api/orders/:id/approve ───────────────────────────────────────────
router.patch(
  '/:id/approve',
  isSupervisor,
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: 'approved',
        approved_by: req.user!.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select('id, status, approved_at')
      .single();

    if (error || !data) {
      res.status(400).json({ error: 'Order not found or not in pending state' });
      return;
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'APPROVE_ORDER',
      entity: 'orders',
      entity_id: req.params.id,
    });

    res.json({ order: data });
  }
);

// ─── PATCH /api/orders/:id/reject ────────────────────────────────────────────
router.patch(
  '/:id/reject',
  isSupervisor,
  [body('reason').optional().isString()],
  async (req: Request, res: Response) => {
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'rejected' })
      .eq('id', req.params.id)
      .in('status', ['pending'])
      .select('id, status')
      .single();

    if (error || !data) {
      res.status(400).json({ error: 'Order not found or cannot be rejected' });
      return;
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'REJECT_ORDER',
      entity: 'orders',
      entity_id: req.params.id,
      meta: { reason: req.body.reason },
    });

    res.json({ order: data });
  }
);

router.patch(
  '/:id/work-day',
  isSupervisor,
  [
    body('work_day')
      .isISO8601()
      .withMessage('work_day must be a valid YYYY-MM-DD date'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { work_day } = req.body;
    const workDay = dayjs(work_day).startOf('day');

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, status, delivery_date')
      .eq('id', req.params.id)
      .single();

    if (orderErr || !order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    if (order.status !== 'approved') {
      res.status(400).json({ error: 'Only approved orders can be scheduled for production' });
      return;
    }

    if (workDay.isBefore(dayjs().startOf('day'))) {
      res.status(400).json({ error: 'Work day cannot be in the past' });
      return;
    }

    if (workDay.isAfter(dayjs(order.delivery_date).endOf('day'))) {
      res.status(400).json({ error: 'Work day cannot be after the delivery date' });
      return;
    }

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update({ work_day: workDay.format('YYYY-MM-DD') })
      .eq('id', req.params.id)
      .select('id, status, work_day, delivery_date')
      .single();

    if (updateErr || !updatedOrder) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to assign work day' });
      return;
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'ASSIGN_WORK_DAY',
      entity: 'orders',
      entity_id: req.params.id,
      meta: { work_day: workDay.format('YYYY-MM-DD') },
    });

    res.json({ order: updatedOrder });
  }
);

export default router;
