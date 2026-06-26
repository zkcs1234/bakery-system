import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../lib/supabase.js';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  branch_id: string | null;
  mixer_team: string | null;
  full_name: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// In-memory cache for is_active checks to reduce DB load on /auth/me
const activeUserCache = new Map<string, { isActive: boolean; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Verify JWT ───────────────────────────────────────────────────────────────
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Read from httpOnly cookie first, fall back to Authorization header
    const token =
      req.cookies?.bakery_token ||
      req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string;
      email: string;
      role: string;
      branch_id: string | null;
      mixer_team: string | null;
      full_name: string;
    };

    // Check cache first for is_active status
    const cached = activeUserCache.get(decoded.sub);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      // Use cached data
      if (!cached.isActive) {
        res.status(401).json({ error: 'Invalid or expired session' });
        return;
      }

      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        branch_id: decoded.branch_id,
        mixer_team: decoded.mixer_team,
        full_name: decoded.full_name,
      };

      next();
      return;
    }

    // Cache miss or expired — verify user still exists and is active
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, role, branch_id, mixer_team, full_name, is_active')
      .eq('id', decoded.sub)
      .single();

    if (error || !user || !user.is_active) {
      activeUserCache.set(decoded.sub, { isActive: false, timestamp: now });
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    // Update cache
    activeUserCache.set(decoded.sub, { isActive: true, timestamp: now });

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      branch_id: user.branch_id,
      mixer_team: user.mixer_team,
      full_name: user.full_name,
    };

    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Role-Based Access Control ────────────────────────────────────────────────
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied. Required role(s): ${roles.join(', ')}`,
      });
      return;
    }
    next();
  };
}

// Convenience role guards
export const isAdmin = requireRole('admin');
export const isSupervisor = requireRole('supervisor', 'admin');
export const isBranchManager = requireRole('branch_manager', 'admin');
export const isWorker = requireRole('scaler', 'mixer', 'baker', 'repacker', 'admin', 'supervisor');
export const isScaler = requireRole('scaler', 'admin', 'supervisor');
export const isMixer = requireRole('mixer', 'admin', 'supervisor');
export const isBaker = requireRole('baker', 'admin', 'supervisor');
export const isRepacker = requireRole('repacker', 'admin', 'supervisor');

// ─── Cache Invalidation ───────────────────────────────────────────────────────
// Call this when a user is deactivated so the next request re-checks the DB
export function invalidateUserCache(userId: string): void {
  activeUserCache.delete(userId);
}
