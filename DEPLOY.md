# BakeryOS — Deployment Guide

Deploy the **backend** to [Render](https://render.com) and the **frontend** to [Vercel](https://vercel.com).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Prepare the Repository](#2-prepare-the-repository)
3. [Deploy Backend to Render](#3-deploy-backend-to-render)
4. [Deploy Frontend to Vercel](#4-deploy-frontend-to-vercel)
5. [Connect Frontend ↔ Backend](#5-connect-frontend--backend)
6. [Supabase CORS & Auth Settings](#6-supabase-cors--auth-settings)
7. [Verify the Deployment](#7-verify-the-deployment)
8. [Redeploying After Code Changes](#8-redeploying-after-code-changes)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

Before you start, make sure you have:

- A [GitHub](https://github.com) account with your project pushed to a repository
- A [Render](https://render.com) account (free tier works)
- A [Vercel](https://vercel.com) account (free tier works)
- Your [Supabase](https://supabase.com) project URL, anon key, and service role key ready

> **Important:** Never commit your `.env` files. The `.gitignore` already excludes them.

---

## 2. Prepare the Repository

Your repo must be on GitHub (or GitLab/Bitbucket — Render and Vercel support all three).

### 2a. Push to GitHub

If you haven't already, initialize git and push from the **root** of the project:

```bash
cd "C:\Users\Zar Kenneth Samijon\Downloads\bakery-system"

git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bakery-system.git
git push -u origin main
```

### 2b. Confirm the structure on GitHub

Your repo should look like this:

```
bakery-system/
├── backend/
│   ├── src/
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
└── .gitignore
```

---

## 3. Deploy Backend to Render

### 3a. Create a new Web Service

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub account and select your `bakery-system` repository
3. Fill in the service settings:

| Setting | Value |
|---|---|
| **Name** | `bakery-os-api` (or any name you like) |
| **Region** | Choose the closest to your users |
| **Branch** | `main` |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (or paid for better performance) |

> The **Root Directory** being `backend` is critical — it tells Render to treat the `backend/` folder as the project root.

### 3b. Set Environment Variables

In the Render dashboard, go to your service → **Environment** tab → **Add Environment Variable** for each of the following:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `SUPABASE_URL` | `https://yvtrogviookhqxxjrhvu.supabase.co` |
| `SUPABASE_ANON_KEY` | *(your anon key from Supabase dashboard)* |
| `SUPABASE_SERVICE_ROLE_KEY` | *(your service role key — keep this secret)* |
| `JWT_SECRET` | *(your JWT secret — at least 32 random characters)* |
| `FRONTEND_URL` | *(leave blank for now — fill in after Vercel deploy in Step 5)* |
| `CROSS_ORIGIN_DEPLOY` | `true` |

> **Where to find Supabase keys:** Supabase Dashboard → Your Project → **Settings** → **API**

> **Generate a JWT secret:** Use a random string generator. Example command:
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
> ```

### 3c. Deploy

Click **Create Web Service**. Render will:
1. Clone your repo
2. Run `npm install && npm run build` (compiles TypeScript to `dist/`)
3. Start the server with `node dist/index.js`

Wait for the status to show **Live**. Your backend URL will be something like:
```
https://bakery-os-api.onrender.com
```

### 3d. Test the health check

Open in your browser:
```
https://bakery-os-api.onrender.com/health
```

You should see:
```json
{
  "status": "ok",
  "service": "BakeryOS API",
  "version": "1.0.0"
}
```

---

## 4. Deploy Frontend to Vercel

### 4a. Import the project

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Import your `bakery-system` GitHub repository
3. Configure the project settings:

| Setting | Value |
|---|---|
| **Framework Preset** | `Vite` |
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` |

> Click **Edit** next to Root Directory and type `frontend`.

### 4b. Set Environment Variables

In the Vercel project settings, go to **Settings** → **Environment Variables** and add:

| Key | Value | Environments |
|---|---|---|
| `VITE_API_URL` | `https://bakery-os-api.onrender.com/api` | Production, Preview, Development |
| `VITE_SUPABASE_URL` | `https://yvtrogviookhqxxjrhvu.supabase.co` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | *(your Supabase anon key)* | Production, Preview, Development |

> Replace `https://bakery-os-api.onrender.com` with your actual Render URL from Step 3c.

### 4c. Deploy

Click **Deploy**. Vercel will build and deploy your frontend. Once done, your frontend URL will be:
```
https://bakery-os.vercel.app
```
(or whatever Vercel assigns — you can set a custom domain later)

---

## 5. Connect Frontend ↔ Backend

Now that both are deployed, you need to wire them together.

### 5a. Update FRONTEND_URL on Render

1. Go to Render → your `bakery-os-api` service → **Environment**
2. Set `FRONTEND_URL` to your Vercel URL:
   ```
   FRONTEND_URL=https://bakery-os.vercel.app
   ```
3. Click **Save Changes** — Render will automatically redeploy the backend.

This is required so the backend CORS policy allows requests from your Vercel domain.

### 5b. Update api.ts for production

In production, the Vite dev proxy is not available. The `api.ts` file already handles this correctly:

```ts
baseURL: import.meta.env.DEV
  ? '/api'                              // dev: uses Vite proxy
  : import.meta.env.VITE_API_URL ?? '/api'  // prod: uses VITE_API_URL
```

Since you set `VITE_API_URL` in Step 4b, this will point directly to Render in production. ✅

---

## 6. Supabase CORS & Auth Settings

### 6a. Add your Vercel domain to Supabase allowed URLs

1. Go to [supabase.com](https://supabase.com) → Your Project → **Authentication** → **URL Configuration**
2. Add your Vercel URL to **Site URL**:
   ```
   https://bakery-os.vercel.app
   ```
3. Add to **Redirect URLs**:
   ```
   https://bakery-os.vercel.app/**
   ```

### 6b. Confirm your Supabase project is active

Free-tier Supabase projects **pause after 1 week of inactivity**. If the backend returns 500 errors after a period of no use, log into Supabase and click **Restore project**.

---

## 7. Verify the Deployment

Run through this checklist after both services are live:

- [ ] `https://bakery-os-api.onrender.com/health` returns `{ "status": "ok" }`
- [ ] `https://bakery-os.vercel.app` loads the login page
- [ ] Sign in with admin account works and redirects to `/admin`
- [ ] Sign in with supervisor account works and redirects to `/supervisor`
- [ ] Sign in with a branch manager account works and redirects to `/branch`
- [ ] Page refresh after login keeps you logged in (cookie is persisted)
- [ ] Logout clears the session and redirects to `/login`

---

## 8. Redeploying After Code Changes

### Backend (Render)

Render auto-deploys on every push to `main`. Just push your changes:

```bash
git add .
git commit -m "your change"
git push
```

Render will detect the push, rebuild, and restart the server. You can watch the build log in the Render dashboard.

To trigger a manual redeploy without a code change: Render dashboard → your service → **Manual Deploy** → **Deploy latest commit**.

### Frontend (Vercel)

Vercel also auto-deploys on every push to `main`. Same workflow:

```bash
git push
```

Vercel builds the frontend and deploys in about 30–60 seconds.

---

## 9. Troubleshooting

### Backend shows "Missing SUPABASE_URL..." on Render

The environment variables weren't saved. Go to Render → **Environment** and confirm all variables are set, then trigger a manual redeploy.

### Login returns 401 immediately after success (redirect loop)

This means the cookie is being blocked between Vercel and Render. Check:

1. `CROSS_ORIGIN_DEPLOY` is set to `true` on Render ✅
2. `NODE_ENV` is set to `production` on Render (required for `secure: true` on the cookie) ✅
3. Both services are on HTTPS (Render and Vercel provide HTTPS by default) ✅
4. `FRONTEND_URL` on Render exactly matches your Vercel URL (no trailing slash)

### CORS errors in the browser console

The `FRONTEND_URL` environment variable on Render does not match your Vercel domain. Update it to match exactly, including `https://`.

### Render service keeps spinning down (free tier)

The free tier on Render spins down after 15 minutes of inactivity. The first request after a spin-down takes ~30 seconds. To avoid this:
- Upgrade to a paid Render plan, or
- Use a free uptime monitor like [UptimeRobot](https://uptimerobot.com) to ping `/health` every 5 minutes

### Supabase "project paused" errors

Restore the project from the Supabase dashboard. Free-tier projects pause after 1 week of inactivity. Consider upgrading to the Pro plan or using Supabase's paid tier for production.

### TypeScript build fails on Render

Make sure `typescript` and `tsx` are in `dependencies` (not just `devDependencies`) in `backend/package.json`, or add a `postinstall` script. Alternatively, commit your compiled `dist/` folder — though that is not recommended.

To check: look at the Render build log. If it says `tsc: not found`, move `typescript` to `dependencies` in `backend/package.json`.

### Environment variables not picked up after change

Render requires a redeploy to apply new environment variable values. After saving, click **Manual Deploy**.

Vercel requires a **redeploy** as well — go to Vercel → your project → **Deployments** → click the three dots on the latest deployment → **Redeploy**.

---

## Summary

| | Backend | Frontend |
|---|---|---|
| **Platform** | Render | Vercel |
| **Root dir** | `backend/` | `frontend/` |
| **Build** | `npm install && npm run build` | `npm run build` |
| **Start** | `node dist/index.js` | *(static, Vercel handles)* |
| **Auto-deploy** | On push to `main` | On push to `main` |
| **HTTPS** | ✅ Automatic | ✅ Automatic |
