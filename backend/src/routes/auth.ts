import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { createClient } from '@supabase/supabase-js';
import supabase from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Determine sameSite based on cross-origin deployment
// Set CROSS_ORIGIN_DEPLOY=true in .env if frontend/backend are on different origins
const isCrossOrigin = process.env.CROSS_ORIGIN_DEPLOY === 'true';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (isCrossOrigin ? 'none' : (process.env.NODE_ENV === 'production' ? 'strict' : 'lax')) as 'none' | 'strict' | 'lax',
  maxAge: 8 * 60 * 60 * 1000, // 8 hours (one production shift)
  path: '/',
};

// Helper: create a per-request auth client to avoid session race conditions
function createAuthClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Helper: retry wrapper for transient network failures
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  delayMs = 300
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      // Only retry on network/transient errors, not auth failures
      const isTransient = err?.message?.includes('network') || err?.message?.includes('timeout') || err?.status >= 500;
      if (attempt < maxRetries && isTransient) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().trim(),
    body('password').isLength({ min: 6 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    // Normalize email safely: only trim and lowercase, preserve dots and +tags
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    try {
      // Create a per-request auth client to avoid session race conditions
      const requestAuthClient = createAuthClient();

      // Use Supabase Auth with retry for transient failures
      const { data: authData, error: authError } = await withRetry(
        () => requestAuthClient.auth.signInWithPassword({ email, password })
      );

      if (authError || !authData.user) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      // Fetch profile from our users table
      const { data: profile, error: profileErr } = await supabase
        .from('users')
        .select('id, full_name, email, role, branch_id, mixer_team, is_active')
        .eq('id', authData.user.id)
        .single();

      if (profileErr || !profile) {
        console.error('Login: profile fetch failed', {
          profileErr: profileErr?.message,
          userId: authData.user?.id,
        });
        res.status(401).json({ error: 'User profile not found' });
        return;
      }


      if (!profile.is_active) {
        console.error('Login: user is inactive', { userId: profile.id });
        res.status(403).json({ error: 'Account deactivated. Contact admin.' });
        return;
      }

      // helpful log to confirm auth
      console.log('Login: success authData+profile', { email: profile.email, role: profile.role, userId: profile.id });


      // Issue our own JWT
      const token = jwt.sign(
        {
          sub: profile.id,
          email: profile.email,
          role: profile.role,
          branch_id: profile.branch_id,
          mixer_team: profile.mixer_team,
          full_name: profile.full_name,
        },
        process.env.JWT_SECRET!,
        { expiresIn: '8h' }
      );

      // Log the login
      await supabase.from('system_logs').insert({
        user_id: profile.id,
        action: 'LOGIN',
        entity: 'auth',
        meta: { ip: req.ip, user_agent: req.headers['user-agent'] },
      });

      res.cookie('bakery_token', token, COOKIE_OPTIONS);

      res.json({
        user: {
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          role: profile.role,
          branch_id: profile.branch_id,
          mixer_team: profile.mixer_team,
        },
        redirect: getRoleRedirect(profile.role),
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  await supabase.from('system_logs').insert({
    user_id: req.user!.id,
    action: 'LOGOUT',
    entity: 'auth',
  });

  res.clearCookie('bakery_token', { path: '/' });
  res.json({ message: 'Logged out successfully' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function getRoleRedirect(role: string): string {
  const routes: Record<string, string> = {
    admin: '/admin',
    supervisor: '/supervisor',
    branch_manager: '/branch',
    scaler: '/scaler',
    mixer: '/mixer',
    baker: '/baker',
    repacker: '/repacker',
  };
  return routes[role] ?? '/';
}

export default router;
