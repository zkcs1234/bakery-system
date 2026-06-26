# BakeryOS Performance Audit (Draft) — Speed, Scalability, Responsiveness

> Scope: Backend (Express + Supabase), Frontend (React), Supabase schema/RLS/migrations.
> Status: **Implementation in progress** — see checklist below.

---

## Implementation Checklist

Track of performance audit action items and their implementation status.

### Critical fixes (Section 11 Action Plan)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Production plan generation: fewer round trips, no nested insert selects, persist ingredient reports | ✅ Done | Parallel worker fetch + `computeIngredients`; insert without nested joins; `ingredient_report` JSONB on `production_plans` |
| 2 | Replace `select('*')` / over-fetch with explicit columns | ✅ Done | `production`, `orders`, `products`, `ingredients`, `branches`, `reports` routes updated |
| 3 | Pagination on growing lists (orders, transactions, catalog) | ✅ Done | `limit`/`offset` on orders + ingredient transactions; product summary endpoint |
| 4 | Composite indexes for filter patterns | ✅ Done | `004_performance_optimizations.sql` |
| 5 | Audit `computeIngredients` (N+1 / repeated reads) | ✅ Done | Single batch query; `Map` for batch lookup; 60s in-memory cache |
| 6 | Frontend dashboard network + render optimizations | ✅ Done | `/orders/summary`, lazy routes, debounced realtime, paginated fetches |
| 7 | RLS policies + realtime subscription load | ⚠️ Partial | Realtime debounced + column selects; full RLS policy audit not run |

### Critical issues (Section 3)

| Issue | Status | Notes |
|-------|--------|-------|
| A — Sequential DB ops in plan generate | ✅ Done | Parallel phases; batch product fetch after insert |
| B — Over-fetching / nested graph selects | ✅ Done | Explicit columns; `/products/summary` |
| C — Missing pagination | ✅ Done | Orders, transactions; summary endpoint for KPIs |
| D — Repeated `computeIngredients` on every GET | ✅ Done | Persisted report + cache; `?refresh=true` to force |
| E — Pipeline view `select('*')` | ✅ Done | Explicit column list |

### Database (Section 5)

| Item | Status |
|------|--------|
| Composite indexes (`orders`, `plan_items`, `tasks`, `recipe_ingredients`, `system_logs`, `ingredient_transactions`) | ✅ Done |
| `EXPLAIN ANALYZE` on candidate slow queries | ⬜ Not done (manual step in Supabase) |

### Frontend (Section 6)

| Item | Status | Notes |
|------|--------|-------|
| Unvirtualized large lists | ⚠️ Partial | `max-h` scroll containers; no `react-virtual` |
| Repeated fetching on state changes | ✅ Done | Targeted fetches + summary endpoint |
| Re-render / memoization | ⚠️ Partial | `useMemo` on dashboards; no broad memo audit |
| Lazy loading admin/worker pages | ✅ Done | `React.lazy` in `App.tsx` |
| Bundle / payload targets | ⚠️ Partial | Smaller payloads; not benchmarked |

### API patterns (Section 7)

| Item | Status |
|------|--------|
| Summary endpoints | ✅ `/orders/summary`, `/products/summary` |
| Cursor-based pagination | ⬜ Offset/limit used instead |
| Cached reports | ✅ DB + in-memory cache |
| Background jobs for recompute | ⬜ Not implemented |

### Remaining / manual steps

- [ ] Run `supabase/migrations/004_performance_optimizations.sql` on your Supabase project
- [ ] Run `EXPLAIN ANALYZE` on production generate, pipeline, and products catalog queries
- [ ] Full RLS policy review under load
- [ ] Optional: list virtualization (`react-virtual`) for order history / logs at 10k+ rows
- [ ] Optional: cursor-based pagination for very large datasets

**Implemented score estimate:** ~75–80/100 (up from 45/100 draft)

---

## 1) Executive Summary

The system is functional, but several patterns will degrade performance as data volume and concurrency grow (e.g., **50k+ inventory transactions**, **1k+ recipes**, **100+ products**, multiple branches).

**Highest-risk areas (based on code review):**

1. **Backend production plan generation is “round-trip heavy”** (many sequential Supabase calls + expensive nested selects + live recomputation).
2. **Over-fetching large payloads** (e.g., `select('*')`, nested relationship graphs for dashboards/catalog).
3. **Missing pagination across admin/supervisor lists** (list endpoints return entire datasets depending on UI usage).
4. **Potential Supabase/RLS query inefficiencies** and possible policy work on high-frequency reads.
5. **Frontend likely triggers repeated network calls / re-renders** (needs confirmation by reading components, but API patterns suggest it).

---

## 2) Current Architecture Notes

### Backend

- Express server with route modules:
  - `/api/production` (plan generation, pipeline, ingredient reports, workload)
  - `/api/orders` (order lists/details + workflow updates)
  - `/api/products` (products + recipe ingredients)
  - `/api/reports` (admin dashboards, shortages, logs)
- Uses Supabase JS client:
  - **service role** used for backend admin operations (bypasses RLS)
  - RLS still matters for frontend direct queries if the frontend uses anon client.

### Supabase

Tables:

- `branches`, `users`, `ingredients`, `products`
- `recipe_ingredients`
- `orders`, `order_items`
- `production_plans`, `production_plan_items`
- `tasks`
- `ingredient_transactions` (inventory movement)
- `system_logs`
- plus migration-created `worker_specialties`, `production_issues`
- Views:
  - `v_product_dough_assignment`
  - `v_ingredient_stock_status`
  - `v_production_pipeline`

---

## 3) Critical Issues (Likely Bottlenecks)

### Critical Issue A — Production plan generation does many sequential DB operations

**Where:** `backend/src/routes/production.ts` → `POST /api/production/generate`

**Why it’s slow**

- Sequential workflow with multiple queries:
  1. Query orders (and fallback legacy query)
  2. Upsert production plan
  3. Delete tasks for existing plan items
  4. Delete existing `production_plan_items`
  5. Insert many `production_plan_items` with nested `products(...)` select
  6. Run `computeIngredients(planItems)` (likely CPU + DB)
  7. Conditional worker load query
  8. Insert tasks (with nested assigned user select)
  9. Insert system log
  10. Build dough groups
- Additionally, on regeneration, it performs:
  - select existing item ids
  - delete tasks by `plan_item_id IN (...)`
  - delete `production_plan_items`
  - reinserts tasks and plan items

**Scalability impact**

- As **products/recipes** grow, plan generation touches more plan items and more tasks.
- Under concurrent users, sequential round trips increase latency and server load.

**Estimate**

- For a typical day with N orders and M distinct products:
  - DB calls scale ~O(1) but latency adds up; tasks insertion scales O(M \* roles).
  - Likely becomes **seconds** per generate request at medium data size.

**Fix direction (audit only)**

- Convert to fewer DB round trips:
  - Use RPC or single SQL transaction to upsert + recompute + delete/insert in a single server-side flow.
  - Avoid nested relationship selects during insert if the UI doesn’t need full graphs.
  - Move ingredient computation to precomputed ingredients per product or caching.

---

### Critical Issue B — Over-fetching / large payloads from Supabase relationship selects

**Where (examples):**

- `GET /api/production/plans/:date`: uses `select('*, production_plan_items(... tasks(... users ...))')`
- `GET /api/products`: `select('*', recipe_ingredients(... ingredients ...))`
- `GET /api/production/pipeline/:date`: `.select('*')` from `v_production_pipeline`
- `GET /api/reports/daily/:date`: nested plan items + tasks.

**Why it’s slow**

- `select('*')` returns all columns including large JSON/meta where present.
- Nested selects fetch whole graphs even if UI only needs a subset.
- Large join graphs increase DB time and network time.

**Scalability impact**

- As product catalogs and recipe ingredients increase, payload size grows rapidly.
- This amplifies both:
  - Supabase bandwidth/latency
  - frontend parsing and render time

**Estimate**

- Pipeline and plan endpoints can easily become **100s of KB**+ per request.

**Fix direction (audit only)**

- Replace `*` with explicit columns.
- Use “summary endpoints” tailored per dashboard.
- Apply server-side pagination or “date/product range filtering” for large datasets.

---

### Critical Issue C — Missing pagination / unbounded list endpoints

**Where (examples):**

- `GET /api/orders` returns orders with nested relationships, ordered by delivery_date + created_at.
  - No limit/offset.
- Admin logs endpoint supports pagination (`/api/reports/logs`) — good.
- Other lists in modules likely exist but were not fully reviewed yet.

**Why it’s slow**

- Without pagination, the database must produce large result sets.
- UI may request multiple pages or re-render triggers additional full refresh.

**Scalability impact**

- Orders and tasks scale quickly with production volume.

**Estimate**

- With 10k+ orders per branch, single requests can degrade severely.

**Fix direction (audit only)**

- Add `limit`, `offset` (or cursor) everywhere a list can grow.
- Make UI request only what it displays.

---

### Critical Issue D — Potential N+1 / repeated compute patterns inside request handlers

**Where:** production + reports endpoints

**Observations**

- Production plan endpoints recompute ingredient reports on request:
  - `GET /api/production/plans/:date` recomputes `computeIngredients(planItems)` every call.
  - `GET /api/production/ingredient-report/:date` recomputes again.
  - `GET /api/reports/plan-shortages/:date` computes ingredients too.

**Why it’s slow**

- If `computeIngredients` performs Supabase queries per ingredient or per product, it becomes a hidden N+1 pattern.
- Even if it’s pure CPU, it becomes expensive at larger plan sizes.

**Scalability impact**

- Concurrent dashboard usage could multiply CPU load.

**Fix direction (audit only)**

- Cache ingredient computation results per `production_plan_items` hash or per plan id/date.
- Prefer precomputed “ingredient requirements per plan” persisted in DB.

---

### Critical Issue E — Supabase views used with `select('*')` (payload risk)

**Where:** `GET /api/production/pipeline/:date`

**Why it’s slow**

- The view `v_production_pipeline` includes many columns; selecting all increases payload.
- Sorting/grouping happens in application code.

**Fix direction (audit only)**

- Select only columns needed by frontend.
- Let Postgres filter by `production_date` and possibly pre-aggregate by task_role.

---

## 4) Module-by-Module Audit (Preliminary)

> Note: Backend modules reviewed so far include `production.ts`, `orders.ts`, `reports.ts`, `products.ts`.
> Frontend and remaining backend routes still need deeper reading before “exact code changes”.

### 4.1 Dashboard (AdminDashboard / SupervisorDashboard / BranchDashboard)

**Likely issues (based on API patterns):**

- Multiple endpoints called on page load (plan + pipeline + orders + reports), increasing waterfall latency.
- Re-render storms if state updates happen frequently or if lists are unvirtualized.

**Estimated impact**

- Large dashboard payload endpoints can add seconds and cause noticeable UI jank.

---

### 4.2 Production Management

**Highest risk:** `/api/production/generate`, `/api/production/plans/:date`, `/api/production/pipeline/:date`

**Why it’s slow**

- Heavy nested selects and recomputation.
- Multiple sequential calls.

**Expected optimization direction**

- Reduce DB calls and payload.
- Persist computed ingredient reports and workload.

---

### 4.3 Recipes / Ingredients / Product Catalog

**Where:** `GET /api/products` returns products + full recipe_ingredients + ingredients.

**Why it’s slow**

- As recipes/ingredients scale, this becomes a massive catalog response.

**Expected optimization direction**

- Split into:
  - product summary list (id, name, dough_type, oven_temp/bake_time)
  - product details endpoint loaded on demand
  - recipe ingredients pagination or “by product id” only

---

### 4.4 Inventory (Stock Movements)

**Status:** Not yet reviewed routes/components for `ingredient_transactions`.

**Likely issues to check**

- Missing pagination for transactions (50,000+ requirement).
- Sorting by created_at without proper composite indexes.

---

### 4.5 Stock Movements

**Status:** Not yet reviewed.

---

### 4.6 Sales Reports

**Status:** `/api/reports` reviewed partially (overview/logs/low-stock/daily).

**Potential issue:** overview does multiple count queries; acceptable but ensure indexes exist.

---

### 4.7 User Management / Notifications

**Status:** Not yet reviewed.

---

## 5) Database Optimization Findings (Indexes + Query Patterns)

### 5.1 Index Coverage Gaps (based on schema review)

Existing indexes include:

- `orders`: branch_id, delivery_date, work_day, status
- `order_items`: order_id
- `tasks`: assigned_to, plan_item_id, status
- `recipe_ingredients`: product_id
- `system_logs`: user_id, created_at DESC

**Likely missing / insufficient composite indexes**

1. `orders` patterns used in code:
   - `.eq('work_day', ...) .eq('status', 'approved')`
   - `.eq('delivery_date', ...) .eq('status', 'approved')`
   - `.eq('branch_id', ...)` (branch manager filtering)

   → recommend composite indexes:
   - `(work_day, status)`
   - `(delivery_date, status)`
   - `(branch_id, status, delivery_date)` (if frequently filtered)

2. `production_plan_items` patterns:
   - filter by `(plan_id)` and insert unique `(plan_id, product_id)`.
   - workload: select ids by `plan_id` then query tasks by `plan_item_id IN (...)`.

   → check indexes on `production_plan_items(plan_id)` (currently only unique composite on `(plan_id, product_id)`; not an explicit single-col index).
   - `production_plan_items(plan_id)` would improve `WHERE plan_id = ?` scans.

3. `tasks` patterns:
   - insert/delete by `(plan_item_id, task_role)`
   - select tasks by `.in('plan_item_id', ids)`
   - workload aggregates tasks for plan items

   → recommend composite indexes:
   - `(plan_item_id, task_role)`
   - `(plan_item_id, status)` if status used in dashboards
   - `(plan_item_id, assigned_to)` if future filtering exists

4. `recipe_ingredients` patterns:
   - join from `products` to recipe_ingredients and then to ingredients.
   - computeIngredients likely scans recipe_ingredients by product_id.

   → index `recipe_ingredients(product_id, ingredient_id)` if queries require ingredient lookup.

5. `system_logs` patterns:
   - filtering by `created_at >=` and `action IN (...)` and sometimes entity.

   → recommend `(created_at, action)` composite (or `action, created_at`).

6. `ingredient_transactions` patterns:
   - not reviewed, but scaling requirements suggest heavy filtering by `ingredient_id`, `plan_id`, and range by `created_at`.

---

### 5.2 Query Execution Plan Review (Needed)

This audit draft identifies candidate slow queries, but execution plans (`EXPLAIN ANALYZE`) must be captured for:

- production plan generate: orders query, production_plan upsert, tasks insert/select
- pipeline view query
- products catalog query (deep nested recipe ingredients)
- ingredient computation path (inside `ingredientEngine.ts`)

---

## 6) Frontend Performance Audit (Preliminary)

> Frontend review is pending deep reading of dashboard pages/components and API hooks.

### Likely performance bottlenecks to confirm

1. **Unvirtualized large lists** (orders history, pipeline stages, logs).
2. **Repeated fetching** triggered by state changes.
3. **Re-render storms**:
   - large derived arrays created in render
   - context/provider state causing full subtree rerenders
4. **No memoization**:
   - expensive table cell computation
   - derived “groupings” recomputed on each render
5. **Bundle size**:
   - heavy admin pages loaded immediately

### Performance targets at enterprise scale

- Dashboard LCP < 2.5s on mid-tier devices.
- Interaction latency < 100ms for common actions.
- Network payloads < 250KB per dashboard initial load.

---

## 7) API Optimization (Preliminary)

### Findings

- Payload-heavy endpoints used by dashboards.
- Lack of pagination on list endpoints.
- Some endpoints recompute data synchronously.

### Proposed patterns for speed

- Introduce “summary endpoints” with tight selection.
- Add cursor-based pagination.
- Cache computed reports (Redis or persisted tables).
- Use background jobs for heavy recomputation.

---

## 8) Supabase (RLS + Realtime) Considerations

### RLS

Schema enables RLS for many tables and defines limited policies.

**Risk to verify**

- Missing policies may cause queries to behave differently between anonymous vs authenticated clients.
- Policies may include subqueries that can be expensive at scale.

### Realtime

There are doc files present:

- `REALTIME_SETUP.md`, `REALTIME_IMPLEMENTATION.md`, `REALTIME_COMPLETE.md`

**Risk to verify**

- Realtime subscriptions can create redundant fetching and increased load.
- If subscriptions are too broad (subscribe to whole tables) or not debounced, they can thrash the UI and DB.

---

## 9) Supabase Index/SQL Improvement Summary (Draft)

This section will be finalized after complete module review.

**Candidate indexes (draft):**

- `orders`: `(work_day, status)`, `(delivery_date, status)`, `(branch_id, work_day)`, etc.
- `production_plan_items`: `(plan_id)`
- `tasks`: `(plan_item_id, task_role)`, `(plan_item_id, status)`, `(assigned_to, status)`
- `system_logs`: `(action, created_at)` or `(created_at, action)`
- `recipe_ingredients`: `(product_id, ingredient_id)` if needed
- `ingredient_transactions`: composites for `ingredient_id + created_at`, `plan_id + created_at`

---

## 10) Performance Score (Draft)

Current Score: **45/100**
Expected Score After Optimization: **80-90/100**

Rationale:

- Major wins available via payload reduction, pagination, and DB round-trip reduction.

---

## 11) Action Plan (Ranked, Audit-Only)

1. **Production plan generation**: reduce sequential Supabase round trips; remove nested selects during insert; persist computed ingredient reports.
2. **Replace `select('*')` and nested graph over-fetch** with explicit columns and purpose-built endpoints.
3. **Add pagination everywhere** lists can grow (orders, tasks, pipeline if it grows, ingredients catalog).
4. **Add composite indexes** for filter patterns from code.
5. **Audit `computeIngredients`** for hidden N+1 queries or repeated reads.
6. **Frontend dashboard network + render audit** (memoization, virtualization, lazy loading).
7. **Verify RLS policies and realtime subscriptions** for excessive load.

---

## Appendix A — Files Reviewed (So Far)

- `backend/src/index.ts`
- `backend/src/lib/supabase.ts`
- `backend/src/routes/production.ts`
- `backend/src/routes/orders.ts`
- `backend/src/routes/reports.ts`
- `backend/src/routes/products.ts`
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_specialties_issues.sql`
- `supabase/migrations/003_add_work_day_to_orders.sql`

---

## Appendix B — Next Review Steps (Before code changes)

To complete a “module per module with optimized code” audit, next must be reviewed:

- `backend/src/lib/ingredientEngine.ts` (computeIngredients implementation)
- remaining backend routes:
  - branches, ingredients, tasks, issues, specialties, users
- frontend:
  - dashboard pages and their data hooks (`useRealtimeData`, API wrappers)
  - any tables/grids for virtualization opportunities
- `frontend/src/lib/api.ts`, `frontend/src/lib/supabase.ts`
- `REALTIME_*.md` docs
