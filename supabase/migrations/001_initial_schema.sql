-- ============================================================
-- BakeryOS — Initial Schema Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'admin',
  'supervisor',
  'branch_manager',
  'scaler',
  'mixer',
  'baker',
  'repacker'
);

CREATE TYPE dough_type AS ENUM (
  'lean_hard_yeast',
  'enriched_yeast',
  'tangzhong',
  'batter_quick_mix'
);

CREATE TYPE mixer_team AS ENUM (
  'team_a',  -- Lean/Hard Yeast
  'team_b',  -- Enriched Yeast + Tangzhong
  'team_c'   -- Batter/Quick Mix
);

CREATE TYPE order_status AS ENUM (
  'pending',
  'approved',
  'in_production',
  'packed',
  'delivered',
  'rejected',
  'expired'
);

CREATE TYPE task_status AS ENUM (
  'pending',
  'in_progress',
  'completed'
);

CREATE TYPE task_role AS ENUM (
  'scaling',
  'mixing',
  'baking',
  'repacking'
);

CREATE TYPE stock_status AS ENUM (
  'sufficient',
  'low',
  'critical',
  'out_of_stock'
);

-- ─────────────────────────────────────────────
-- BRANCHES
-- ─────────────────────────────────────────────
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name TEXT NOT NULL,
    address TEXT,
    contact TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- USERS (extends Supabase auth.users)
-- ─────────────────────────────────────────────
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role user_role NOT NULL DEFAULT 'scaler',
    branch_id UUID REFERENCES branches (id),
    mixer_team mixer_team, -- only for role=mixer
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INGREDIENTS (master list)
-- ─────────────────────────────────────────────
CREATE TABLE ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'g', -- g, kg, ml, l, pcs
    current_stock_g NUMERIC NOT NULL DEFAULT 0, -- stored in grams internally
    reorder_threshold_g NUMERIC NOT NULL DEFAULT 0,
    stock_status stock_status NOT NULL DEFAULT 'sufficient',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PRODUCTS
-- ─────────────────────────────────────────────
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name TEXT NOT NULL,
    dough_type dough_type NOT NULL,
    base_yield_qty INTEGER NOT NULL DEFAULT 1, -- how many units per batch
    yield_unit TEXT NOT NULL DEFAULT 'pcs', -- pcs, loaves, rolls, etc.
    oven_temp_c INTEGER, -- degrees Celsius
    bake_time_min INTEGER, -- minutes
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- RECIPE INGREDIENTS (many products → many ingredients)
-- ─────────────────────────────────────────────
-- ALTER TABLE recipe_ingredients ALTER COLUMN amount_g DROP NOT NULL;
CREATE TABLE recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    product_id UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
    amount_value DECIMAL(10, 4),
    amount_display VARCHAR(20),
    amount_unit VARCHAR(20),
    amount_g NUMERIC NOT NULL, -- grams per BASE batch
    notes TEXT, -- e.g. "softened", "lukewarm", "optional"
    is_optional BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────────
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    branch_id UUID NOT NULL REFERENCES branches (id),
    placed_by UUID NOT NULL REFERENCES users (id),
    delivery_date DATE NOT NULL,
    work_day DATE,
    is_special BOOLEAN NOT NULL DEFAULT FALSE,
    special_notes TEXT,
    status order_status NOT NULL DEFAULT 'pending',
    approved_by UUID REFERENCES users (id),
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ, -- auto-expire 12h after placement
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT delivery_not_past CHECK (delivery_date >= CURRENT_DATE),
    CONSTRAINT work_day_before_delivery CHECK (
        work_day IS NULL
        OR work_day <= delivery_date
    )
);

-- ─────────────────────────────────────────────
-- ORDER ITEMS
-- ─────────────────────────────────────────────
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    order_id UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products (id),
    batches INTEGER NOT NULL CHECK (batches > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PRODUCTION PLANS
-- ─────────────────────────────────────────────
CREATE TABLE production_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    production_date DATE NOT NULL UNIQUE,
    generated_by UUID NOT NULL REFERENCES users (id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_finalized BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PRODUCTION PLAN ITEMS (consolidated per product per date)
-- ─────────────────────────────────────────────
CREATE TABLE production_plan_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    plan_id UUID NOT NULL REFERENCES production_plans (id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products (id),
    total_batches INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, product_id)
);

-- ─────────────────────────────────────────────
-- TASKS (assigned to workers)
-- ─────────────────────────────────────────────
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    plan_item_id UUID NOT NULL REFERENCES production_plan_items (id) ON DELETE CASCADE,
    assigned_to UUID NOT NULL REFERENCES users (id),
    task_role task_role NOT NULL,
    batches_assigned INTEGER NOT NULL DEFAULT 1,
    status task_status NOT NULL DEFAULT 'pending',
    is_priority BOOLEAN NOT NULL DEFAULT FALSE, -- special orders
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    override_by UUID REFERENCES users (id), -- supervisor override
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INGREDIENT TRANSACTIONS (pull log)
-- ─────────────────────────────────────────────
CREATE TABLE ingredient_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    ingredient_id UUID NOT NULL REFERENCES ingredients (id),
    plan_id UUID REFERENCES production_plans (id),
    delta_g NUMERIC NOT NULL, -- negative = pulled, positive = delivery
    reason TEXT,
    performed_by UUID REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- SYSTEM LOGS (audit trail)
-- ─────────────────────────────────────────────
CREATE TABLE system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    user_id UUID REFERENCES users (id),
    action TEXT NOT NULL,
    entity TEXT,
    entity_id UUID,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX idx_orders_branch ON orders (branch_id);

CREATE INDEX idx_orders_delivery ON orders (delivery_date);

CREATE INDEX idx_orders_work_day ON orders (work_day);

CREATE INDEX idx_orders_status ON orders (status);

CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE INDEX idx_tasks_assigned ON tasks (assigned_to);

CREATE INDEX idx_tasks_plan_item ON tasks (plan_item_id);

CREATE INDEX idx_tasks_status ON tasks (status);

CREATE INDEX idx_recipe_ing_product ON recipe_ingredients (product_id);

CREATE INDEX idx_logs_user ON system_logs (user_id);

CREATE INDEX idx_logs_created ON system_logs (created_at DESC);

-- ─────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'branches','users','ingredients','products',
    'recipe_ingredients','orders','order_items',
    'production_plans','production_plan_items','tasks'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()', tbl
    );
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────
-- AUTO-EXPIRE ORDERS FUNCTION
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_old_orders()
RETURNS void AS $$
BEGIN
  UPDATE orders
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- SET EXPIRES_AT ON ORDER INSERT
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_order_expiry()
RETURNS TRIGGER AS $$
BEGIN
  NEW.expires_at := NOW() + INTERVAL '12 hours';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_expiry
BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION set_order_expiry();

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;

ALTER TABLE production_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE production_plan_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE ingredient_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (backend uses service role key)
-- Anon/authenticated policies for frontend direct queries:

-- Users: see own profile
CREATE POLICY "users_self" ON users FOR
SELECT USING (auth.uid () = id);

-- Tasks: workers see only their own tasks
CREATE POLICY "tasks_own" ON tasks FOR
SELECT USING (assigned_to = auth.uid ());

-- Orders: branch managers see own branch orders only
CREATE POLICY "orders_branch" ON orders FOR
SELECT USING (
        branch_id IN (
            SELECT branch_id
            FROM users
            WHERE
                id = auth.uid ()
        )
    );

-- ─────────────────────────────────────────────
-- ══════════════════════════════════════════════
--   SEED DATA
-- ══════════════════════════════════════════════
-- ─────────────────────────────────────────────

-- Branches
INSERT INTO
    branches (id, name, address)
VALUES (
        '10000000-0000-0000-0000-000000000001',
        'Shoppers Branch',
        'Tagbilaran City, Bohol'
    ),
    (
        '10000000-0000-0000-0000-000000000002',
        'Gallares Branch',
        'Tagbilaran City, Bohol'
    ),
    (
        '10000000-0000-0000-0000-000000000003',
        'Panglao Branch',
        'Panglao, Bohol'
    ),
    (
        '10000000-0000-0000-0000-000000000004',
        'Trinidad Branch',
        'Trinidad, Bohol'
    );

-- ─────────────────────────────────────────────
-- INGREDIENTS (master list from recipes)
-- ─────────────────────────────────────────────
INSERT INTO
    ingredients (
        id,
        name,
        unit,
        current_stock_g,
        reorder_threshold_g
    )
VALUES (
        '20000000-0000-0000-0000-000000000001',
        'All-Purpose Flour',
        'g',
        50000,
        10000
    ),
    (
        '20000000-0000-0000-0000-000000000002',
        'Bread Flour',
        'g',
        20000,
        5000
    ),
    (
        '20000000-0000-0000-0000-000000000003',
        'Whole Wheat / Golden Wheat Flour',
        'g',
        15000,
        4000
    ),
    (
        '20000000-0000-0000-0000-000000000004',
        'Unsalted Butter',
        'g',
        10000,
        2000
    ),
    (
        '20000000-0000-0000-0000-000000000005',
        'Granulated Sugar',
        'g',
        15000,
        3000
    ),
    (
        '20000000-0000-0000-0000-000000000006',
        'Light / Dark Brown Sugar',
        'g',
        10000,
        2000
    ),
    (
        '20000000-0000-0000-0000-000000000007',
        'Table Salt',
        'g',
        5000,
        1000
    ),
    (
        '20000000-0000-0000-0000-000000000008',
        'Instant Yeast',
        'g',
        2000,
        500
    ),
    (
        '20000000-0000-0000-0000-000000000009',
        'Active Dry Yeast',
        'g',
        1000,
        300
    ),
    (
        '20000000-0000-0000-0000-000000000010',
        'Whole Milk',
        'g',
        20000,
        5000
    ),
    (
        '20000000-0000-0000-0000-000000000011',
        'Evaporated Milk',
        'g',
        5000,
        1000
    ),
    (
        '20000000-0000-0000-0000-000000000012',
        'Dry Milk Powder',
        'g',
        3000,
        800
    ),
    (
        '20000000-0000-0000-0000-000000000013',
        'Water',
        'g',
        99999,
        1000
    ),
    (
        '20000000-0000-0000-0000-000000000014',
        'Eggs (large)',
        'pcs',
        200,
        50
    ),
    (
        '20000000-0000-0000-0000-000000000015',
        'Vegetable Oil',
        'g',
        8000,
        2000
    ),
    (
        '20000000-0000-0000-0000-000000000016',
        'Honey',
        'g',
        3000,
        500
    ),
    (
        '20000000-0000-0000-0000-000000000017',
        'Ground Cinnamon',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000018',
        'Baking Powder',
        'g',
        1000,
        200
    ),
    (
        '20000000-0000-0000-0000-000000000019',
        'Baking Soda',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000020',
        'Dutch-Process Cocoa',
        'g',
        3000,
        500
    ),
    (
        '20000000-0000-0000-0000-000000000021',
        'Chocolate Chips',
        'g',
        8000,
        2000
    ),
    (
        '20000000-0000-0000-0000-000000000022',
        'Espresso Powder',
        'g',
        300,
        50
    ),
    (
        '20000000-0000-0000-0000-000000000023',
        'Vanilla Extract',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000024',
        'Butterscotch Flavor',
        'g',
        200,
        50
    ),
    (
        '20000000-0000-0000-0000-000000000025',
        'Confectioners Sugar',
        'g',
        5000,
        1000
    ),
    (
        '20000000-0000-0000-0000-000000000026',
        'Ripe Bananas (mashed)',
        'g',
        5000,
        1000
    ),
    (
        '20000000-0000-0000-0000-000000000027',
        'Apricot Jam / Orange Marmalade',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000028',
        'Chopped Walnuts',
        'g',
        2000,
        400
    ),
    (
        '20000000-0000-0000-0000-000000000029',
        'Potato Flour / Instant Mashed',
        'g',
        2000,
        400
    ),
    (
        '20000000-0000-0000-0000-000000000030',
        'Cider Vinegar',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000031',
        'Bread & Cake Enhancer',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000032',
        'Ground Nutmeg',
        'g',
        200,
        50
    ),
    (
        '20000000-0000-0000-0000-000000000033',
        'Shortening / Vegetable Shortening',
        'g',
        2000,
        500
    ),
    (
        '20000000-0000-0000-0000-000000000034',
        'Sesame Seeds',
        'g',
        500,
        100
    ),
    (
        '20000000-0000-0000-0000-000000000035',
        'Sliced Hotdog',
        'pcs',
        100,
        20
    ),
    (
        '20000000-0000-0000-0000-000000000036',
        'Butter',
        'g',
        20000,
        2000
    );

-- ─────────────────────────────────────────────
-- PRODUCTS
-- ─────────────────────────────────────────────
INSERT INTO
    products (
        id,
        name,
        dough_type,
        base_yield_qty,
        yield_unit,
        oven_temp_c,
        bake_time_min
    )
VALUES (
        '30000000-0000-0000-0000-000000000001',
        'Chocolate Chip Cookies',
        'batter_quick_mix',
        25,
        'pcs',
        190,
        12
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        'Frosted Cinnamon Rolls',
        'enriched_yeast',
        24,
        'rolls',
        175,
        25
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        'White Sliced Bread',
        'lean_hard_yeast',
        3,
        'loaves',
        190,
        35
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        'Chocolate Fudge Cupcakes',
        'batter_quick_mix',
        24,
        'pcs',
        175,
        20
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        'Whole Grain Bread',
        'lean_hard_yeast',
        2,
        'loaves',
        190,
        40
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        'Banana Bread',
        'batter_quick_mix',
        1,
        'loaf',
        175,
        55
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        'Soft Pan De Sal',
        'enriched_yeast',
        24,
        'pcs',
        200,
        18
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        'Burger Buns',
        'enriched_yeast',
        8,
        'buns',
        190,
        15
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        'Japanese Milk Bread Rolls',
        'tangzhong',
        8,
        'rolls',
        175,
        20
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        'Hot Dog Buns',
        'enriched_yeast',
        10,
        'buns',
        190,
        15
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        'Hot Dog Bread',
        'tangzhong',
        8,
        'pcs',
        175,
        20
    );

-- ─────────────────────────────────────────────
-- RECIPE INGREDIENTS (from Bakery-Recipes.docx)
-- ─────────────────────────────────────────────

-- 1. CHOCOLATE CHIP COOKIES (25 × 40g cookies)
INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000004',
        11.00,
        '11',
        'tbsp',
        156,
        'Unsalted butter'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000006',
        2.125,
        '2 cups + 2 tbsp',
        'cups',
        454,
        'Light or dark brown sugar(packed)'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000007',
        1.00,
        '1',
        'tsp',
        6,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000023',
        1.00,
        '1',
        'tsp',
        4,
        'King Arthur Pure Vanilla Extract'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000024',
        0.25,
        '1/4',
        'tsp',
        1,
        'Butterscotch or vanilla-butternut flavor(optional)'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000014',
        3.00,
        '3',
        'pcs',
        150,
        'Large eggs'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000018',
        2.25,
        '2 1/4',
        'tsp',
        11,
        'Baking powder'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000022',
        0.50,
        '1/2',
        'tsp',
        3,
        'Espresso powder (optional)'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        2.75,
        '2 3/4',
        'cups',
        330,
        'King Arthur unbleached all-purpose flour'
    ),
    (
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000021',
        3.00,
        '3',
        'cups',
        510,
        'Chocolate chips or nuts'
    );
-- 2. FROSTED CINNAMON ROLLS (24 rolls) — Dough + Filling + Frosting
INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000001',
        7.875,
        '7 1/2 to 8 1/4',
        'cups',
        945,
        '900g–990g King Arthur flour (midpoint)'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000005',
        0.67,
        '2/3',
        'cup',
        131,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tbsp',
        18,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000008',
        5,
        '5',
        'tsp',
        14,
        'Instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000010',
        1.5,
        '1 1/2',
        'cups',
        340,
        'Milk'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000013',
        0.5,
        '1/2',
        'cup',
        113,
        'Water'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000004',
        12,
        '12',
        'tbsp',
        170,
        'Unsalted butter (dough cold)'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000014',
        2,
        '2',
        'pcs',
        100,
        'Eggs'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000005',
        0.50,
        '1/2',
        'cup',
        99,
        'Filling sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000017',
        1.5,
        '1 1/2',
        'tbsp',
        11,
        'Cinnamon'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000004',
        4,
        '4',
        'tbsp',
        57,
        'Filling butter'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000004',
        4,
        '4',
        'tbsp',
        57,
        'Frosting butter'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000025',
        4,
        '4',
        'cups',
        454,
        'Confectioners sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000007',
        0.125,
        '1/8',
        'tsp',
        0.75,
        'Salt (frosting)'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000023',
        0.5,
        '1/2',
        'tsp',
        2,
        'Vanilla extract'
    ),
    (
        '30000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000010',
        5,
        '5',
        'tbsp',
        71,
        'Milk (frosting)'
    );
-- 3. WHITE SLICED BREAD (3 loaves)

INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000013',
        2,
        '2',
        'cups',
        454,
        'Lukewarm water'
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000011',
        1,
        '5 oz',
        'can',
        142,
        'Evaporated milk or whole milk'
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000015',
        0.33,
        '1/3',
        'cup',
        67,
        'Vegetable oil'
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000016',
        0.25,
        '1/4',
        'cup',
        85,
        'Honey'
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tbsp',
        18,
        'table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000008',
        1,
        '1',
        'tbsp',
        11,
        'instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000001',
        7.5,
        '7-8',
        'cups',
        900,
        'King Arthur unbleached all-purpose flour (7–8 cups, midpoint)'
    );

-- 4. CHOCOLATE FUDGE CUPCAKES (24 cupcakes)

INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000020',
        1,
        '1',
        'cup',
        85,
        'Dutch-process cocoa'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000001',
        2.33,
        '2 1/3',
        'cup',
        280,
        'King Arthur unbleached all-purpose flour'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000006',
        1.67,
        '1 2/3',
        'cup',
        354,
        'Light or dark brown sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000018',
        1.5,
        '1 1/2',
        'tsp',
        6,
        'Baking powder'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000022',
        1,
        '1',
        'tsp',
        3,
        'Espresso powder(optional)'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000019',
        1,
        '1',
        'tsp',
        6,
        'Baking soda'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tsp',
        6,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000031',
        2,
        '2',
        'tbsp',
        14,
        'King Arthur bread & cake enhancer(optional)'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000021',
        1.5,
        '1 1/2',
        'cup',
        255,
        'Chocolate chips'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000014',
        3,
        '3',
        'pcs',
        150,
        'Large eggs'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000010',
        1.5,
        '1 1/2',
        'cup',
        340,
        'Milk at room temperature'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000023',
        1,
        '1',
        'tbsp',
        14,
        'King Arthur pure vanilla extract'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000030',
        1,
        '1',
        'tbsp',
        15,
        'Cider or white vinegar'
    ),
    (
        '30000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000015',
        0.5,
        '1/2',
        'cup',
        99,
        'Vegetable oil'
    );

-- 5. WHOLE GRAIN BREAD (2 loaves)
INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000013',
        2,
        '2',
        'cup',
        454,
        'Warm water'
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000005',
        0.25,
        '1/4',
        'cup',
        50,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000008',
        2.25,
        '2 1/4',
        'tsp',
        7,
        'Active dry or instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000003',
        3,
        '3',
        'cup',
        340,
        'King Arthur golden wheat flour'
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tbsp',
        18,
        'Table salt)'
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000015',
        0.25,
        '1/4',
        'cup',
        50,
        'Vegetable oil'
    ),
    (
        '30000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000001',
        3,
        '3',
        'cup',
        360,
        'King Arthur all-purpose flour'
    );

-- 6. BANANA BREAD (1 loaf)

INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000004',
        8,
        '8',
        'tbsp',
        113,
        'Unsalted butter(cool room temperature)'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000006',
        0.66,
        '2/3',
        'cup',
        142,
        'Light or  dark bown sugar(packed)'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000023',
        1,
        '1',
        'tsp',
        4,
        'King Arthur pure vanilla extract'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000017',
        1,
        '1',
        'tsp',
        3,
        'Ground cinnamon'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000032',
        0.25,
        '1/4',
        'tsp',
        1,
        'Ground nutmeg'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000019',
        1,
        '1',
        'tsp',
        6,
        'Baking soda'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000018',
        1,
        '1',
        'tsp',
        4,
        'Baking powder'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tsp',
        6,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000026',
        1.5,
        '1 1/2',
        'cup',
        340,
        'Bananas(mashed)'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000027',
        3,
        '3',
        'tsp',
        64,
        'Apricot jam or orange marmalade(optional)'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000016',
        0.25,
        '1/4',
        'cup',
        85,
        'Honey'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000014',
        2,
        '2',
        'pcs',
        2,
        'Large eggs'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000001',
        2.25,
        '2 1/4',
        'cup',
        270,
        'King Arthur all-purpose flour'
    ),
    (
        '30000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000028',
        0.5,
        '1/2',
        'cup',
        57,
        'Chopped walnuts(optional)'
    );

--
INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000013',
        0.5,
        '1/2',
        'cup',
        113,
        'Lukewarm water'
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000010',
        2,
        '2',
        'cup',
        454,
        'Warm milk (100–110°F)'
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000004',
        3,
        '3',
        'tbsp',
        43,
        'Butter'
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000005',
        2,
        '2',
        'tbsp',
        25,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tbsp',
        18,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000008',
        2.5,
        '2 1/2',
        'tbsp',
        23,
        'Instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000001',
        6.5,
        '6 1/2',
        'cup',
        780,
        'King Arthur all-purpose flour'
    );

--
INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000001',
        3.5,
        '3 1/2',
        'cup',
        420,
        'King Arthur all-purpose flour'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000013',
        0.75,
        '3/4',
        'cup',
        198,
        '+ 2tbsp Lukewarm water'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000004',
        2,
        '2',
        'tbsp',
        28,
        'Butter'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000014',
        1,
        '1',
        'pcs',
        1,
        'Large egg'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000005',
        0.25,
        '1/4',
        'cup',
        50,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000007',
        1.25,
        '1 1/4',
        'tsp',
        8,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000008',
        1,
        '1',
        'tbsp',
        9,
        'Instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000004',
        3,
        '3',
        'tbsp',
        43,
        'Butter glaze: melted butter'
    ),
    (
        '30000000-0000-0000-0000-000000000008',
        '20000000-0000-0000-0000-000000000034',
        '10',
        '10',
        'g',
        10,
        'Sesame seeds for topping(optional)'
    );
--
INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000013',
        3,
        '3',
        'tbsp',
        43,
        'Water'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000010',
        3,
        '3',
        'tbsp',
        43,
        'Whole preferred milk'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000002',
        2,
        '2',
        'tbsp',
        14,
        'King Arthur unbleached bread flour'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000002',
        2.5,
        '2 1/2',
        'cup',
        300,
        'King Arthur unbleached bread flour'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000012',
        2,
        '2',
        'tbsp',
        14,
        'King Arthur bakers special dry milk'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000005',
        0.25,
        '1/4',
        'cup',
        50,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tsp',
        6,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000008',
        1,
        '1',
        'tbsp',
        9,
        'Instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000010',
        0.25,
        '1/2',
        'cup',
        113,
        'Whole preferred milk'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000014',
        1,
        '1',
        'pcs',
        1,
        'Large egg'
    ),
    (
        '30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000004',
        4,
        '4',
        'tbsp',
        57,
        'Unsalted melted butter'
    );

-- 10. HOT DOG BUNS (10 buns)

INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000008',
        2.5,
        '2 1/2',
        'tsp',
        7,
        'Instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000013',
        1,
        '1',
        'cup',
        227,
        'Lukewarm water'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000001',
        3,
        '3',
        'cup',
        360,
        'King Arthur unbleached all-purpose flour'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000007',
        1.25,
        '1 1/4',
        'tsp',
        8,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000005',
        3,
        '3',
        'tbsp',
        37,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000004',
        6,
        '6',
        'tbsp',
        85,
        'Unsalted butter (softened)'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000012',
        0.25,
        '1/4',
        'cup',
        28,
        'King Arthur bakers special dry milk'
    ),
    (
        '30000000-0000-0000-0000-000000000010',
        '20000000-0000-0000-0000-000000000029',
        0.25,
        '1/4',
        'cup',
        46,
        'Potato flour or instant mashed potatoes'
    );

-- 11. HOT DOG BREAD with Tangzhong (8 pcs)

INSERT INTO
    recipe_ingredients (
        product_id,
        ingredient_id,
        amount_value,
        amount_display,
        amount_unit,
        amount_g,
        notes
    )
VALUES (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000013',
        3,
        '3',
        'tbsp',
        43,
        'Water'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000010',
        3,
        '3',
        'tbsp',
        43,
        'Whole preferred milk'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000002',
        2,
        '2',
        'tbsp',
        14,
        'King Arthur unbleached bread flour'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000010',
        0.5,
        '1/2',
        'cup',
        113,
        'Whole preferred milk(cold)'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000002',
        2.5,
        '2 1/2',
        'cup',
        300,
        'King Arthur unbleached  bread flour'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000012',
        2,
        '2',
        'tbsp',
        14,
        'King Arthur bakers special dry milk'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000005',
        0.25,
        '1/4',
        'cup',
        50,
        'Granulated sugar'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000007',
        1,
        '1',
        'tsp',
        6,
        'Table salt'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000008',
        1,
        '1',
        'tbsp',
        9,
        'Instant yeast'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000014',
        1,
        '1',
        'pcs',
        1,
        'Large egg'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000004',
        4,
        '4',
        'tbsp',
        57,
        'Unsalted melted butter'
    ),
    (
        '30000000-0000-0000-0000-000000000011',
        '20000000-0000-0000-0000-000000000035',
        4,
        '4',
        'pcs',
        4,
        'Sliced hotdog'
    );

-- ─────────────────────────────────────────────
-- SEED TEST USERS (passwords set via Supabase Dashboard or Auth API)
-- These are profile rows only — auth.users must be created via Supabase Auth
-- Insert via your admin seed script after creating auth users
-- ─────────────────────────────────────────────
-- NOTE: Run backend/src/scripts/seedUsers.ts to create auth users + profiles

-- ─────────────────────────────────────────────
-- USEFUL VIEWS
-- ─────────────────────────────────────────────

CREATE OR REPLACE VIEW v_product_dough_assignment AS
SELECT
    p.id,
    p.name AS product_name,
    p.dough_type,
    CASE p.dough_type
        WHEN 'lean_hard_yeast' THEN 'Mixer Team A'
        WHEN 'enriched_yeast' THEN 'Mixer Team B'
        WHEN 'tangzhong' THEN 'Mixer Team B (Tangzhong — 15min starter buffer)'
        WHEN 'batter_quick_mix' THEN 'Mixer Team C'
    END AS mixer_assignment,
    CASE p.dough_type
        WHEN 'tangzhong' THEN TRUE
        ELSE FALSE
    END AS requires_starter_prep,
    p.base_yield_qty,
    p.yield_unit,
    p.oven_temp_c,
    p.bake_time_min
FROM products p
WHERE
    p.is_active = TRUE
ORDER BY p.dough_type, p.name;

CREATE OR REPLACE VIEW v_ingredient_stock_status AS
SELECT
    i.id,
    i.name,
    i.unit,
    i.current_stock_g,
    i.reorder_threshold_g,
    CASE
        WHEN i.current_stock_g = 0 THEN 'out_of_stock'
        WHEN i.current_stock_g < i.reorder_threshold_g * 0.5 THEN 'critical'
        WHEN i.current_stock_g < i.reorder_threshold_g THEN 'low'
        ELSE 'sufficient'
    END AS computed_status
FROM ingredients i
ORDER BY computed_status DESC, i.name;