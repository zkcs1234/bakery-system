import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import type React from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import type { UserRole } from './types';

import LoginPage from './pages/auth/LoginPage';
import AppShell from './components/layout/AppShell';

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const ManageUsers = lazy(() => import('./pages/admin/ManageUsers'));
const ManageProducts = lazy(() => import('./pages/admin/ManageProducts'));
const ManageIngredients = lazy(() => import('./pages/admin/ManageIngredients'));
const ManageBranches = lazy(() => import('./pages/admin/ManageBranches'));
const SystemLogs = lazy(() => import('./pages/admin/SystemLogs'));
const SupervisorDashboard = lazy(() => import('./pages/supervisor/SupervisorDashboard'));
const OrderInbox = lazy(() => import('./pages/supervisor/OrderInbox'));
const ProductionPlanView = lazy(() => import('./pages/supervisor/ProductionPlanView'));
const TaskAssignment = lazy(() => import('./pages/supervisor/TaskAssignment'));
const AssignWorkDay = lazy(() => import('./pages/supervisor/Assignworkday'));
const WorkerSpecialties = lazy(() => import('./pages/supervisor/WorkerSpecialties'));
const ProductionStatus = lazy(() => import('./pages/supervisor/ProductionStatus'));
const IssueTracker = lazy(() => import('./pages/supervisor/IssueTracker'));
const BranchDashboard = lazy(() => import('./pages/branch/BranchDashboard'));
const PlaceOrder = lazy(() => import('./pages/branch/PlaceOrder'));
const OrderHistory = lazy(() => import('./pages/branch/OrderHistory'));
const ScalerDashboard = lazy(() => import('./pages/scaler/ScalerDashboard'));
const MixerDashboard = lazy(() => import('./pages/mixer/MixerDashboard'));
const BakerDashboard = lazy(() => import('./pages/baker/BakerDashboard'));
const RepackerDashboard = lazy(() => import('./pages/repacker/RepackerDashboard'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-4 border-crust-300 border-t-crust-600 rounded-full animate-spin" />
    </div>
  );
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// ─── Route Guard ──────────────────────────────────────────────────────────────
function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-wheat-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-crust-300 border-t-crust-600 rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading BakeryOS…</span>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const roleRoutes: Record<UserRole, string> = {
      admin: '/admin', supervisor: '/supervisor', branch_manager: '/branch',
      scaler: '/scaler', mixer: '/mixer', baker: '/baker', repacker: '/repacker',
    };
    return <Navigate to={roleRoutes[user.role] ?? '/'} replace />;
  }

  return <>{children}</>;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RootRedirect />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><AdminDashboard /></LazyPage>} />
            <Route path="users" element={<LazyPage><ManageUsers /></LazyPage>} />
            <Route path="products" element={<LazyPage><ManageProducts /></LazyPage>} />
            <Route path="ingredients" element={<LazyPage><ManageIngredients /></LazyPage>} />
            <Route path="branches" element={<LazyPage><ManageBranches /></LazyPage>} />
            <Route path="logs" element={<LazyPage><SystemLogs /></LazyPage>} />
          </Route>

          <Route
            path="/supervisor"
            element={
              <ProtectedRoute allowedRoles={['supervisor', 'admin']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><SupervisorDashboard /></LazyPage>} />
            <Route path="orders" element={<LazyPage><OrderInbox /></LazyPage>} />
            <Route path="plan/:date" element={<LazyPage><ProductionPlanView /></LazyPage>} />
            <Route path="assign" element={<LazyPage><TaskAssignment /></LazyPage>} />
            <Route path="assign/:orderId" element={<LazyPage><AssignWorkDay /></LazyPage>} />
            <Route path="specialties" element={<LazyPage><WorkerSpecialties /></LazyPage>} />
            <Route path="status" element={<LazyPage><ProductionStatus /></LazyPage>} />
            <Route path="issues" element={<LazyPage><IssueTracker /></LazyPage>} />
          </Route>

          <Route
            path="/branch"
            element={
              <ProtectedRoute allowedRoles={['branch_manager', 'admin']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><BranchDashboard /></LazyPage>} />
            <Route path="order/new" element={<LazyPage><PlaceOrder /></LazyPage>} />
            <Route path="history" element={<LazyPage><OrderHistory /></LazyPage>} />
          </Route>

          <Route
            path="/scaler"
            element={
              <ProtectedRoute allowedRoles={['scaler', 'admin', 'supervisor']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><ScalerDashboard /></LazyPage>} />
          </Route>

          <Route
            path="/mixer"
            element={
              <ProtectedRoute allowedRoles={['mixer', 'admin', 'supervisor']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><MixerDashboard /></LazyPage>} />
          </Route>

          <Route
            path="/baker"
            element={
              <ProtectedRoute allowedRoles={['baker', 'admin', 'supervisor']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><BakerDashboard /></LazyPage>} />
          </Route>

          <Route
            path="/repacker"
            element={
              <ProtectedRoute allowedRoles={['repacker', 'admin', 'supervisor']}>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<LazyPage><RepackerDashboard /></LazyPage>} />
          </Route>

          <Route path="*" element={<LazyPage><NotFound /></LazyPage>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const routes: Record<UserRole, string> = {
    admin: '/admin', supervisor: '/supervisor', branch_manager: '/branch',
    scaler: '/scaler', mixer: '/mixer', baker: '/baker', repacker: '/repacker',
  };
  return <Navigate to={routes[user.role] ?? '/login'} replace />;
}
