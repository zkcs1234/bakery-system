import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import supabase from '../lib/supabase.js';
import { authenticate, isAdmin, isSupervisor } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /api/users — list all users (admin/supervisor) ───────────────────────
router.get('/', isSupervisor, async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, full_name, email, role, is_active, mixer_team, created_at,
      branches ( id, name )
    `)
    .order('role')
    .order('full_name');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ users: data });
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', isAdmin, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('users')
    .select(`*, branches ( id, name )`)
    .eq('id', req.params.id)
    .single();

  if (error || !data) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user: data });
});

// ─── POST /api/users — create user (admin only) ───────────────────────────────
router.post(
  '/',
  isAdmin,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Min 8 chars'),
    body('full_name').trim().notEmpty(),
    body('role').isIn(['admin','supervisor','branch_manager','scaler','mixer','baker','repacker']),
    body('branch_id').optional().isUUID(),
    body('mixer_team').optional().isIn(['team_a', 'team_b', 'team_c']),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { email, password, full_name, role, branch_id, mixer_team } = req.body;

    // Create auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authErr || !authData.user) {
      res.status(400).json({ error: authErr?.message ?? 'Failed to create auth user' });
      return;
    }

    // Insert profile
    const { data: profile, error: profileErr } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        full_name,
        email,
        role,
        branch_id: branch_id ?? null,
        mixer_team: role === 'mixer' ? mixer_team : null,
      })
      .select()
      .single();

    if (profileErr) {
      // Rollback auth user
      await supabase.auth.admin.deleteUser(authData.user.id);
      res.status(500).json({ error: profileErr.message });
      return;
    }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'CREATE_USER',
      entity: 'users',
      entity_id: profile.id,
      meta: { email, role },
    });

    res.status(201).json({ user: profile });
  }
);

// ─── PATCH /api/users/:id — update user ──────────────────────────────────────
router.patch(
  '/:id',
  isAdmin,
  [
    body('full_name').optional().trim().notEmpty(),
    body('role').optional().isIn(['admin','supervisor','branch_manager','scaler','mixer','baker','repacker']),
    body('branch_id').optional().isUUID(),
    body('mixer_team').optional().isIn(['team_a', 'team_b', 'team_c']),
    body('is_active').optional().isBoolean(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { full_name, role, branch_id, mixer_team, is_active } = req.body;
    const updates: Record<string, unknown> = {};

    if (full_name !== undefined) updates.full_name = full_name;
    if (role !== undefined) updates.role = role;
    if (branch_id !== undefined) updates.branch_id = branch_id;
    if (mixer_team !== undefined) updates.mixer_team = mixer_team;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('system_logs').insert({
      user_id: req.user!.id,
      action: 'UPDATE_USER',
      entity: 'users',
      entity_id: req.params.id,
      meta: updates,
    });

    res.json({ user: data });
  }
);

// ─── DELETE /api/users/:id — deactivate (soft delete) ────────────────────────
router.delete('/:id', isAdmin, async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }

  await supabase.from('system_logs').insert({
    user_id: req.user!.id,
    action: 'DEACTIVATE_USER',
    entity: 'users',
    entity_id: req.params.id,
  });

  res.json({ message: 'User deactivated' });
});

export default router;
