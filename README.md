# 🍞 BakeryOS — Production Management System

A full-stack, role-based bakery production management web application built with **React 18 + TypeScript (Vite)**, **Node.js + Express**, and **Supabase (PostgreSQL)**.

---

## 📦 Tech Stack

| Layer       | Technology                                      |
|-------------|------------------------------------------------|
| Frontend    | React 18, TypeScript, Vite, TailwindCSS, Recharts, Axios |
| Backend     | Node.js, Express.js, REST API                   |
| Database    | Supabase (PostgreSQL) with Row-Level Security   |
| Auth        | Supabase Auth + JWT, Role-Based Access Control  |
| Real-time   | Supabase Realtime (task updates)                |
| Date        | Day.js                                          |

---

## 🗂️ Project Structure

```
bakery-system/
├── frontend/                   # React + TypeScript (Vite)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── src/
│       ├── components/         # Reusable UI components
│       │   ├── ui/             # Base UI primitives (Button, Badge, Card…)
│       │   ├── layout/         # AppShell, Sidebar, TopBar
│       │   └── shared/         # Tables, Forms, Modals, Charts
│       ├── pages/              # Route pages (one per role/feature)
│       │   ├── auth/           # Login
│       │   ├── admin/          # Admin dashboard & CRUD
│       │   ├── supervisor/     # Production planning & assignment
│       │   ├── branch/         # Order placement
│       │   ├── scaler/         # Scaling tasks
│       │   ├── mixer/          # Mixing tasks
│       │   ├── baker/          # Baking tasks
│       │   └── repacker/       # Packing tasks
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # Supabase client, Axios instance, helpers
│       └── types/              # TypeScript interfaces & enums
│
├── backend/                    # Node.js + Express API
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       ├── index.ts            # Server entry point
│       ├── routes/             # API route handlers
│       │   ├── auth.ts
│       │   ├── users.ts
│       │   ├── branches.ts
│       │   ├── products.ts
│       │   ├── recipes.ts
│       │   ├── ingredients.ts
│       │   ├── orders.ts
│       │   ├── production.ts
│       │   ├── tasks.ts
│       │   └── reports.ts
│       ├── middleware/         # Auth, error handling, validation
│       │   ├── auth.ts
│       │   ├── rbac.ts
│       │   └── errorHandler.ts
│       └── lib/                # Supabase admin client, helpers
│           ├── supabase.ts
│           └── ingredientEngine.ts
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   # Full DB schema
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- npm v9+
- A [Supabase](https://supabase.com) project (free tier works)

---

### 1. Clone & Install

```bash
git clone <repo-url>
cd bakery-system

# Install backend deps
cd backend && npm install

# Install frontend deps
cd ../frontend && npm install
```

---

### 2. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Copy the contents of `supabase/migrations/001_initial_schema.sql`
4. Paste and **Run** — this creates all tables, indexes, RLS policies, and seeds the initial recipes

---

### 3. Environment Variables

**Backend** — create `backend/.env`:
```env
PORT=4000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-jwt-secret-min-32-chars
NODE_ENV=development
```

**Frontend** — create `frontend/.env`:
```env
VITE_API_URL=http://localhost:4000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> ⚠️ **Never commit `.env` files.** Both are in `.gitignore`.

---

### 4. Run Development Servers

```bash
# Terminal 1 — Backend
cd backend
npm run dev
# Runs on http://localhost:4000

# Terminal 2 — Frontend
cd frontend
npm run dev
# Runs on http://localhost:5173
```

---

## 👥 User Roles & Default Credentials

After running the SQL migration, seed users are available for testing:

| Role           | Email                        | Password    |
|----------------|------------------------------|-------------|
| Admin          | admin@bakery.com             | Admin@1234  |
| Supervisor     | supervisor@bakery.com        | Super@1234  |
| Branch Manager | branch1@bakery.com           | Branch@1234 |
| Scaler         | scaler@bakery.com            | Scale@1234  |
| Mixer A        | mixer.a@bakery.com           | Mixer@1234  |
| Mixer B        | mixer.b@bakery.com           | Mixer@1234  |
| Mixer C        | mixer.c@bakery.com           | Mixer@1234  |
| Baker          | baker@bakery.com             | Baker@1234  |
| Repacker       | repacker@bakery.com          | Repack@1234 |

> Change all passwords immediately in production.

---

## 🍰 Pre-loaded Recipes

The following recipes are seeded from `Bakery-Recipes.docx`:

| Product                   | Dough Type          | Yield          |
|---------------------------|---------------------|----------------|
| Chocolate Chip Cookies    | Batter/Quick Mix    | 25 × 40g       |
| Frosted Cinnamon Rolls    | Enriched Yeast      | 24 rolls       |
| White Sliced Bread        | Lean/Hard Yeast     | 3 loaves       |
| Chocolate Fudge Cupcakes  | Batter/Quick Mix    | 24 cupcakes    |
| Whole Grain Bread         | Lean/Hard Yeast     | 2 loaves       |
| Banana Bread              | Batter/Quick Mix    | 1 loaf         |
| Soft Pan De Sal           | Enriched Yeast      | 24 pcs         |
| Burger Buns               | Enriched Yeast      | 8 large buns   |
| Japanese Milk Bread Rolls | Tangzhong           | 8 rolls        |
| Hot Dog Buns              | Enriched Yeast      | 10 buns        |
| Hot Dog Bread             | Tangzhong           | 8 pcs          |

---

## 🏭 Production Workflow

```
Branch Order (D-1 minimum)
        ↓
Supervisor Approval + Plan Generation
        ↓
Ingredient Engine → Pull List + Shortage Alerts
        ↓
Scaler: Weigh & portion all ingredients
        ↓
Mixer A/B/C: Mix by dough type category
        ↓
Baker: Bake by product category (load-balanced)
        ↓
Repacker: Pack & label by branch destination
        ↓
Dispatch: Deliver on scheduled date
```

---

## 🔒 Security

- JWT stored in **httpOnly cookies** (no localStorage)
- All routes protected by RBAC middleware
- Workers can only see their own tasks (enforced server-side + RLS)
- Branches can only see their own orders
- Admin-only routes for user/recipe management
- Supabase Row Level Security enabled on all tables

---

## 📡 API Reference

Base URL: `http://localhost:4000/api`

### Auth
| Method | Path              | Description         |
|--------|-------------------|---------------------|
| POST   | /auth/login       | Login, set cookie   |
| POST   | /auth/logout      | Clear cookie        |
| GET    | /auth/me          | Current user info   |

### Orders
| Method | Path                      | Roles                    |
|--------|---------------------------|--------------------------|
| GET    | /orders                   | Supervisor, Admin        |
| POST   | /orders                   | Branch Manager           |
| PATCH  | /orders/:id/approve       | Supervisor               |
| PATCH  | /orders/:id/reject        | Supervisor               |

### Production
| Method | Path                              | Roles       |
|--------|-----------------------------------|-------------|
| POST   | /production/generate              | Supervisor  |
| GET    | /production/plans/:date           | Supervisor  |
| POST   | /production/assign                | Supervisor  |
| GET    | /production/ingredient-report     | Supervisor  |

### Tasks
| Method | Path                      | Roles               |
|--------|---------------------------|---------------------|
| GET    | /tasks/my                 | All workers         |
| PATCH  | /tasks/:id/status         | Assigned worker     |

---

## 🗄️ Database Schema Overview

```
users → branches, roles
products → dough_type_categories
recipes → products (one-to-one)
recipe_ingredients → recipes × ingredients
orders → branches × users (branch managers)
order_items → orders × products
production_plans → supervisor × date
production_plan_items → plans × products
tasks → production_plan_items × users (workers)
ingredient_transactions → inventory log
```

---

## 🛠️ Build for Production

```bash
# Build frontend
cd frontend && npm run build
# Output: frontend/dist/

# Build backend
cd backend && npm run build
# Output: backend/dist/
```

---

## 📝 Sessions Roadmap

| Session | Scope                                         | Status  |
|---------|-----------------------------------------------|---------|
| 1       | Scaffold + DB Schema + Backend Foundation     | ✅ Done |
| 2       | Auth System + User Management API             | 🔜 Next |
| 3       | Orders API + Ingredient Engine                | 🔜      |
| 4       | Production Plan + Task Assignment API         | 🔜      |
| 5       | Frontend: Auth + Shell + Admin Dashboard      | 🔜      |
| 6       | Frontend: Supervisor Dashboard                | 🔜      |
| 7       | Frontend: Branch + Worker Dashboards          | 🔜      |
| 8       | Real-time updates + Final polish              | 🔜      |

---

## 📄 License

Internal use only — BakeryOS Production Team.
