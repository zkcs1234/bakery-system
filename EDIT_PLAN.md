# Edit Plan: Replace BreadCo/breadco logo with shopperslogo across app

## Information Gathered

- AppShell.tsx currently renders a text-based brand ("BreadCo" + a blue square "B") in the sidebar.
- LoginPage.tsx also uses a text-based brand ("BreadCo" + a blue square "B") in both desktop and mobile sections.
- NotFound.tsx uses a text-based "B" avatar.
- frontend/index.html currently sets the favicon to `/bread.svg`.
- There is an existing asset at `frontend/public/assets/shopperlogo.png` (and `shppers.png`, `login.jpg`). The task specifies `@shopperslogo.png` as the new system logo, which appears to correspond to `frontend/public/assets/shopperlogo.png` (note spelling mismatch).

## Plan

1. Determine the correct logo file to use:
   - Replace all visible BreadCo branding blocks ("BreadCo" text and "B" placeholder) with an `<img>` using the shopper logo asset.
   - Use `frontend/public/assets/shopperlogo.png` as the source (unless a different file name is intended).
2. Update `frontend/index.html`:
   - Change favicon from `/bread.svg` to the new logo asset path (e.g. `/assets/shopperlogo.png`).
3. Update React components to display the new logo:
   - `frontend/src/components/layout/AppShell.tsx`: replace sidebar brand header with logo image + appropriate text (or logo only).
   - `frontend/src/pages/auth/LoginPage.tsx`: replace desktop/mobile brand header blocks with logo image.
   - `frontend/src/pages/NotFound.tsx`: replace the centered "B" placeholder with the logo image.
4. Search for any remaining BreadCo/bread logo references and update them.

## Dependent Files to be edited

- `frontend/index.html`
- `frontend/src/components/layout/AppShell.tsx`
- `frontend/src/pages/auth/LoginPage.tsx`
- `frontend/src/pages/NotFound.tsx`

## Followup steps

- Run `npm run build` (in `frontend`) and `npm run lint` if available.
- Start `npm run dev` (in `frontend`) and verify all pages show the new logo.

<ask_followup_question>
Confirm whether the intended new logo file is `frontend/public/assets/shopperlogo.png` (since the task says `@shopperslogo.png`, but only shopperlogo.png exists). If it’s different, provide the exact filename to use.
Also confirm whether we should keep the app text label "BreadCo" or replace it with app name/leave text removed; I can swap to logo-only to avoid brand mismatch.
</ask_followup_question>
