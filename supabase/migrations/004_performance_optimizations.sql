-- ============================================================
-- BakeryOS — Performance optimizations (indexes + cached reports)
-- ============================================================

-- Persist ingredient computation on production plans (avoid live recompute)
ALTER TABLE production_plans
  ADD COLUMN IF NOT EXISTS ingredient_report JSONB,
  ADD COLUMN IF NOT EXISTS ingredient_report_computed_at TIMESTAMPTZ;

-- ─── Orders: composite indexes for common filter patterns ───
CREATE INDEX IF NOT EXISTS idx_orders_work_day_status ON orders (work_day, status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders (delivery_date, status);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status_delivery ON orders (branch_id, status, delivery_date);

-- ─── Production plan items ───
CREATE INDEX IF NOT EXISTS idx_plan_items_plan_id ON production_plan_items (plan_id);

-- ─── Tasks: composite indexes for workload / pipeline queries ───
CREATE INDEX IF NOT EXISTS idx_tasks_plan_item_role ON tasks (plan_item_id, task_role);
CREATE INDEX IF NOT EXISTS idx_tasks_plan_item_status ON tasks (plan_item_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_status ON tasks (assigned_to, status);

-- ─── Recipe ingredients ───
CREATE INDEX IF NOT EXISTS idx_recipe_ing_product_ingredient ON recipe_ingredients (product_id, ingredient_id);

-- ─── System logs: filter by action + date range ───
CREATE INDEX IF NOT EXISTS idx_logs_action_created ON system_logs (action, created_at DESC);

-- ─── Ingredient transactions: scale to 50k+ rows ───
CREATE INDEX IF NOT EXISTS idx_ing_tx_ingredient_created ON ingredient_transactions (ingredient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ing_tx_plan_created ON ingredient_transactions (plan_id, created_at DESC);
