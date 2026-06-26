import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isAdmin, isSupervisor } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/branches
router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, address, contact, is_active, created_at, updated_at')
    .order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ branches: data });
});

// GET /api/branches/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, address, contact, is_active, created_at, updated_at')
    .eq('id', req.params.id)
    .single();
  if (error || !data) { res.status(404).json({ error: 'Branch not found' }); return; }
  res.json({ branch: data });
});

// POST /api/branches
router.post(
  '/',
  isAdmin,
  [
    body('name').trim().notEmpty(),
    body('address').optional().trim(),
    body('contact').optional().trim(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { data, error } = await supabase
      .from('branches')
      .insert(req.body)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'CREATE_BRANCH',
      entity: 'branches',
      entity_id: data.id,
      meta: { name: data.name },
    });

    res.status(201).json({ branch: data });
  }
);

// PATCH /api/branches/:id
router.patch('/:id', isAdmin, async (req: Request, res: Response) => {
  const { name, address, contact, is_active } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (contact !== undefined) updates.contact = contact;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase
    .from('branches')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  await supabase.from('system_logs').insert({
    user_id: req.user!.id,
    action: 'UPDATE_BRANCH',
    entity: 'branches',
    entity_id: req.params.id,
    meta: updates,
  });

  res.json({ branch: data });
});

export default router;
