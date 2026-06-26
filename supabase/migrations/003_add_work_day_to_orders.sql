-- ============================================================
-- 003 — Add work_day to orders for supervisor production scheduling
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS work_day DATE;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS work_day_before_delivery;

ALTER TABLE orders
  ADD CONSTRAINT work_day_before_delivery
    CHECK (work_day IS NULL OR work_day <= delivery_date);

CREATE INDEX IF NOT EXISTS idx_orders_work_day ON orders(work_day);

-- Optional: backfill existing approved orders to work_day = delivery_date - 1
-- only if your process should preserve the old delivery_date-based schedule.
-- Uncomment and adjust as needed.
--
-- UPDATE orders
-- SET work_day = delivery_date - INTERVAL '1 day'
-- WHERE work_day IS NULL AND status = 'approved';