import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import authRoutes      from './routes/auth.js';
import usersRoutes     from './routes/users.js';
import branchesRoutes  from './routes/branches.js';
import productsRoutes  from './routes/products.js';
import ingredientsRoutes from './routes/ingredients.js';
import ordersRoutes    from './routes/orders.js';
import productionRoutes from './routes/production.js';
import tasksRoutes     from './routes/tasks.js';
import reportsRoutes   from './routes/reports.js';
import specialtiesRoutes from './routes/specialties.js';
import issuesRoutes      from './routes/issues.js';

import { errorHandler, notFound } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 4000;

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'BakeryOS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/users',       usersRoutes);
app.use('/api/branches',    branchesRoutes);
app.use('/api/products',    productsRoutes);
app.use('/api/ingredients', ingredientsRoutes);
app.use('/api/orders',      ordersRoutes);
app.use('/api/production',  productionRoutes);
app.use('/api/tasks',       tasksRoutes);
app.use('/api/reports',     reportsRoutes);
app.use('/api/specialties', specialtiesRoutes);
app.use('/api/issues',      issuesRoutes);
// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ┌────────────────────────────────────────┐
  │  🍞  BakeryOS API Server               │
  │  PORT: ${PORT}                             │
  │  ENV:  ${process.env.NODE_ENV ?? 'development'}                   │
  │  URL:  http://localhost:${PORT}            │
  └────────────────────────────────────────┘
  `);
});

export default app;
