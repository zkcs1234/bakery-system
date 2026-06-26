-- ============================================================
-- 005 — Admin RLS policies (for admin/supervisor dashboards)
-- ============================================================
-- Purpose:
-- Allow admin/supervisor roles to SELECT full datasets used by:
-- - frontend admin pages (users, branches, ingredients)
-- - realtime hooks (useRealtimeData.tsx)
--
-- Assumptions:
-- - public.users has role column (user_role enum)
-- - RLS is already enabled on users/branches/ingredients
-- - Existing policies already cover users_self / tasks_own / orders_branch
-- ============================================================

-- ------------------------------
-- USERS: admin/supervisor SELECT all
-- ------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'users_admin_supervisor_select_all'
  ) THEN
    EXECUTE $SQL$
      CREATE POLICY "users_admin_supervisor_select_all"
      ON public.users
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role IN ('admin','supervisor')
        )
      );
    $SQL$;
  END IF;
END $$;

-- ------------------------------
-- BRANCHES: admin/supervisor SELECT all
-- ------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'branches'
      AND policyname = 'branches_admin_supervisor_select_all'
  ) THEN
    EXECUTE $SQL$
      CREATE POLICY "branches_admin_supervisor_select_all"
      ON public.branches
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role IN ('admin','supervisor')
        )
      );
    $SQL$;
  END IF;
END $$;

-- ------------------------------
-- INGREDIENTS: admin/supervisor SELECT all
-- ------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ingredients'
      AND policyname = 'ingredients_admin_supervisor_select_all'
  ) THEN
    EXECUTE $SQL$
      CREATE POLICY "ingredients_admin_supervisor_select_all"
      ON public.ingredients
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.users u
          WHERE u.id = auth.uid()
            AND u.role IN ('admin','supervisor')
        )
      );
    $SQL$;
  END IF;
END $$;

-- ------------------------------
-- VIEW: v_ingredient_stock_status
-- ------------------------------
-- Intentionally not creating a view policy here.
-- Your earlier migration failed because your current DB instance did not
-- have `public.v_ingredient_stock_status` available at policy-creation time.
--
-- With ingredients SELECT allowed above, the view will work once the view
-- exists.