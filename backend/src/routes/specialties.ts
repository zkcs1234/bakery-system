import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isSupervisor } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// UUID validator that accepts any format
const isValidUUID = (value: string) => {
  if (!value) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
};

// GET /api/specialties — all specialties (optionally filter by user)
router.get('/', async (req: Request, res: Response) => {
  let q = supabase.from('worker_specialties')
    .select('id, user_id, product_id, proficiency, notes, created_at, users(id, full_name, role), products(id, name, dough_type)')
    .order('created_at', { ascending: false });

  if (req.query.user_id) q = q.eq('user_id', req.query.user_id as string);

  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ specialties: data });
});

// POST /api/specialties — assign one or many products to a worker
router.post(
  '/',
  isSupervisor,
  [
    body('user_id').custom(isValidUUID).withMessage('user_id must be a valid UUID'),
    body('product_ids')
      .isArray({ min: 1 })
      .withMessage('product_ids must be an array with at least one item'),
    body('product_ids.*')
      .custom(isValidUUID)
      .withMessage('Each product_id must be a valid UUID'),
    body('proficiency').optional().isIn(['expert', 'standard', 'learning']),
    body('notes').optional().isString(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { user_id, product_ids, proficiency, notes } = req.body;

    const rows = product_ids.map((product_id: string) => ({
      user_id, product_id,
      proficiency: proficiency ?? 'standard',
      notes: notes ?? null,
    }));

    // upsert so re-assigning doesn't duplicate
    const { data, error } = await supabase
      .from('worker_specialties')
      .upsert(rows, { onConflict: 'user_id,product_id' })
      .select('id, user_id, product_id, proficiency, notes, products(id, name, dough_type)');

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id, action: 'ASSIGN_SPECIALTY',
      entity: 'worker_specialties', meta: { worker: user_id, product_count: product_ids.length },
    });

    res.status(201).json({ specialties: data });
  }
);

// PATCH /api/specialties/:id — update proficiency/notes
router.patch('/:id', isSupervisor, async (req: Request, res: Response) => {
  const updates: Record<string, unknown> = {};
  if (req.body.proficiency !== undefined) updates.proficiency = req.body.proficiency;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;

  const { data, error } = await supabase
    .from('worker_specialties').update(updates).eq('id', req.params.id)
    .select('id, user_id, product_id, proficiency, notes, products(id, name, dough_type)').single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ specialty: data });
});

// DELETE /api/specialties/:id — remove a specialty
router.delete('/:id', isSupervisor, async (req: Request, res: Response) => {
  const { error } = await supabase.from('worker_specialties').delete().eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Removed' });
});

export default router;
