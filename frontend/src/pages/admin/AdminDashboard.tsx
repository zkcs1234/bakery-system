import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Users, Package, ClipboardList, AlertTriangle,
  TrendingUp, ChevronRight, Plus
} from 'lucide-react';
import api from '../../lib/api';

interface Overview {
  active_branches: number;
  active_users: number;
  active_products: number;
  pending_orders: number;
  stock_alerts: number;
  production_shortages: number;
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  to?: string;
  alert?: boolean;
}

function StatCard({ label, value, icon, to, alert }: StatCardProps) {
  const inner = (
    <div className={`kpi-card hover:shadow-card transition-shadow ${alert && value > 0 ? 'border-danger/30' : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-chip">
          <span className="kpi-icon">{icon}</span>
        </div>
      </div>
      <div className="kpi-value">{value}</div>
      {alert && value > 0 && (
        <div className="kpi-delta kpi-delta-down mt-1">
          <span>▼</span>
          <span>Needs attention</span>
        </div>
      )}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : <div>{inner}</div>;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/reports/overview')
      .then(r => setStats(r.data))
      .catch((e: unknown) => {
        setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load dashboard overview');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header - Design System */}
      <div>
        <h1 className="pageTitle text-blue-950 font-display">Admin Dashboard</h1>
        <p className="text-panelSubtitle text-slate-600 mt-1 font-body">System overview and management</p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {/* KPI Row - Design System */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="kpi-card animate-pulse bg-gray-100 h-28" />
          ))}
        </div>
      ) : stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <StatCard
            label="Active Branches"
            value={stats.active_branches}
            icon={<Building2 size={16} />}
            to="/admin/branches"
          />
          <StatCard
            label="Active Users"
            value={stats.active_users}
            icon={<Users size={16} />}
            to="/admin/users"
          />
          <StatCard
            label="Active Products"
            value={stats.active_products}
            icon={<Package size={16} />}
            to="/admin/products"
          />
          <StatCard
            label="Production"
            value={0}
            icon={<TrendingUp size={16} />}
          />
        </div>
      )}

      {/* Main Panel - Orders Overview - Design System */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
        {/* Pending Orders Panel */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Pending Orders</h2>
              <p className="panel-subtitle">Orders awaiting approval</p>
            </div>
            <Link to="/supervisor/orders" className="panel-action-link">
              View all <ChevronRight size={13} />
            </Link>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-blue-50 rounded animate-pulse" />)}
              </div>
            ) : stats && stats.pending_orders > 0 ? (
              <div className="flex items-center gap-4 p-3 bg-blue-50 rounded-lg">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <ClipboardList size={18} className="text-blue-700" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-body text-ink">{stats.pending_orders} orders pending</p>
                  <p className="text-xs text-slate-600 font-body">Awaiting supervisor review</p>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400">
                <p className="text-sm font-body">No pending orders</p>
              </div>
            )}
          </div>
        </div>

        {/* Stock Alerts Panel */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Stock Alerts</h2>
              <p className="panel-subtitle">Low inventory warnings</p>
            </div>
            <Link to="/admin/ingredients" className="panel-action-link">
              View all <ChevronRight size={13} />
            </Link>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-blue-50 rounded animate-pulse" />)}
              </div>
            ) : stats && stats.production_shortages > 0 ? (
              <div className="flex items-center gap-4 p-3 bg-warningBg rounded-lg">
                <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-warning" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-body text-ink">{stats.production_shortages} items low</p>
                  <p className="text-xs text-slate-600 font-body">Requires restocking</p>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400">
                <p className="text-sm font-body">All stock levels OK</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions - Design System */}
      <div>
        <h2 className="panel-title mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Add User', sub: 'Manage staff', to: '/admin/users', icon: <Users size={18} /> },
            { label: 'Add Product', sub: 'New item', to: '/admin/products', icon: <Package size={18} /> },
            { label: 'Add Ingredient', sub: 'Stock inventory', to: '/admin/ingredients', icon: <Package size={18} /> },
            { label: 'Add Branch', sub: 'New location', to: '/admin/branches', icon: <Building2 size={18} /> },
          ].map(({ label, sub, to, icon }) => (
            <Link
              key={to}
              to={to}
              className="panel p-4 flex flex-col gap-3 hover:shadow-card-md transition-shadow group"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700">
                {icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-950 font-body">{label}</p>
                <p className="text-sm text-slate-600 font-body">{sub}</p>
              </div>
              <ChevronRight size={14} className="text-slate-400 self-end opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}