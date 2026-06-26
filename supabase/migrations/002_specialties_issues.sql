-- ============================================================
-- 002 — Worker Specialties + Production Issues/Exceptions
-- ============================================================

-- ─── WORKER SPECIALTIES (mixer/baker product proficiency) ─────
CREATE TABLE worker_specialties (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  proficiency TEXT NOT NULL DEFAULT 'standard', -- 'expert' | 'standard' | 'learning'
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);
CREATE INDEX idx_specialties_user ON worker_specialties(user_id);
CREATE INDEX idx_specialties_product ON worker_specialties(product_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON worker_specialties
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── PRODUCTION ISSUES (exceptions / mistakes / cancellations) ─
CREATE TYPE issue_type AS ENUM (
  'excess_ingredient', 'shortage_mistake', 'cancellation', 'quality_issue', 'other'
);
CREATE TYPE issue_status AS ENUM ('open', 'acknowledged', 'resolved');

CREATE TABLE production_issues (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_item_id    UUID REFERENCES production_plan_items(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id),
  task_id         UUID REFERENCES tasks(id),
  issue_type      issue_type NOT NULL,
  reported_by     UUID REFERENCES users(id),
  description     TEXT NOT NULL,
  excess_batches  NUMERIC,           -- e.g. mixer made 1 extra batch by mistake
  affected_batches NUMERIC,          -- e.g. cancelled order = 2 batches affected
  status          issue_status NOT NULL DEFAULT 'open',
  resolution      TEXT,              -- supervisor's instruction, e.g. "split extra Pan de Sal across branches"
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_issues_status ON production_issues(status);
CREATE INDEX idx_issues_plan_item ON production_issues(plan_item_id);
CREATE INDEX idx_issues_created ON production_issues(created_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON production_issues
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── VIEW: production pipeline status per plan item ────────────
CREATE OR REPLACE VIEW v_production_pipeline AS
SELECT
  ppi.id AS plan_item_id,
  ppi.plan_id,
  pp.production_date,
  p.id AS product_id,
  p.name AS product_name,
  p.dough_type,
  ppi.total_batches,
  t.id AS task_id,
  t.task_role,
  t.status AS task_status,
  t.batches_assigned,
  t.is_priority,
  t.started_at,
  t.completed_at,
  u.id AS worker_id,
  u.full_name AS worker_name
FROM production_plan_items ppi
JOIN production_plans pp ON pp.id = ppi.plan_id
JOIN products p ON p.id = ppi.product_id
LEFT JOIN tasks t ON t.plan_item_id = ppi.id
LEFT JOIN users u ON u.id = t.assigned_to
ORDER BY pp.production_date DESC, p.name,
  CASE t.task_role
    WHEN 'scaling' THEN 1 WHEN 'mixing' THEN 2
    WHEN 'baking' THEN 3 WHEN 'repacking' THEN 4 ELSE 5
  END;
