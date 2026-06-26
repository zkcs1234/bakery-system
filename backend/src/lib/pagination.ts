import type { Request } from 'express';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedMeta {
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function parsePagination(req: Request, defaultLimit = DEFAULT_LIMIT): PaginationParams {
  const rawLimit = parseInt(req.query.limit as string, 10);
  const rawOffset = parseInt(req.query.offset as string, 10);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : defaultLimit;

  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

  return { limit, offset };
}
