# TODO

- [x] Inspect relevant frontend files (index.html, AppShell.tsx, LoginPage.tsx, NotFound.tsx).
- [ ] Replace favicon/logo in `frontend/index.html` with `assets/shopperlogo.png`.
- [ ] Replace BreadCo brand in `frontend/src/components/layout/AppShell.tsx` (sidebar) with shopperlogo + “Bakery Production System”.
- [ ] Replace BreadCo brand in `frontend/src/pages/auth/LoginPage.tsx` (desktop + mobile) with shopperlogo + “Bakery Production System”.
- [ ] Replace BreadCo brand in `frontend/src/pages/NotFound.tsx` with shopperlogo.
- [ ] Ensure no other references remain.
- [ ] Run frontend build/lint.

# Performance / RLS fixes

- [x] Identify admin pages failing due to Supabase realtime relying on `auth.uid()`.
- [x] Workaround: Switch Admin modules from Supabase realtime hooks to backend REST endpoints.
- [ ] Update `frontend/src/pages/admin/ManageUsers.tsx` to REST-only.
- [ ] Update `frontend/src/pages/admin/ManageIngredients.tsx` to REST-only.
- [ ] Re-run lint/build after RLS/realtime changes.
