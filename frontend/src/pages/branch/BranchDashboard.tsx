// BranchDashboard.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, Clock, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { Order } from '../../types';
import { ORDER_STATUS_LABELS } from '../../types';

const STATUS_PILL: Record<string, string> = {
  pending: 'status-pill-queued',
  approved: 'status-pill-done',
  rejected: 'status-pill-delay',
  in_production: 'status-pill-progress',
  packed: 'status-pill-done',
  delivered: 'status-pill-done',
  expired: 'status-pill-delay',
};

export default function BranchDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoadError('');
    api.get('/orders', { params: { limit: 50 } })
      .then(r => setOrders(r.data.orders))
      .catch((e: unknown) => {
        setLoadError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load branch orders');
      })
      .finally(() => setLoading(false));
  }, []);

  const recentOrders = orders.slice(0, 6);
  const pending      = orders.filter(o => o.status === 'pending').length;
  const approved     = orders.filter(o => o.status === 'approved').length;
  const inProduction = orders.filter(o => o.status === 'in_production').length;
  const packed       = orders.filter(o => o.status === 'packed').length;

  return (
    <div className="space-y-6">
      {/* Header - Design System */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="pageTitle text-blue-950 font-display">Branch Orders</h1>
          <p className="text-panelSubtitle text-slate-600 mt-1 font-body">
            {dayjs().format('MMMM D, YYYY')}
          </p>
        </div>
        <Link to="/branch/order/new" className="btn-primary">
          <ShoppingCart size={15} /> Place Order
        </Link>
      </div>

      {/* KPI Row - Design System */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Pending</span>
            <div className="kpi-icon-chip">
              <Clock size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{pending}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Approved</span>
            <div className="kpi-icon-chip">
              <CheckCircle2 size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{approved}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">In Production</span>
            <div className="kpi-icon-chip">
              <ShoppingCart size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{inProduction}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Packed</span>
            <div className="kpi-icon-chip">
              <CheckCircle2 size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{packed}</div>
        </div>
      </div>

      {/* Recent Orders Panel - Design System */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Recent Orders</h2>
            <p className="panel-subtitle">Your latest branch orders</p>
          </div>
          <Link to="/branch/history" className="panel-action-link">
            View all <ChevronRight size={13} />
          </Link>
        </div>
        <div className="p-4">
          {loadError && <div className="alert alert-danger mb-3">{loadError}</div>}
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_,i) => <div key={i} className="h-12 bg-blue-50 rounded animate-pulse" />)}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <ShoppingCart size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-body">No orders yet</p>
              <Link to="/branch/order/new" className="btn-primary mt-3 inline-flex">Place your first order</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentOrders.map(o => (
                <div key={o.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-blue-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 font-mono">Delivery: {dayjs(o.delivery_date).format('MMM D, YYYY')}</p>
                    <p className="text-xs text-slate-400 font-body">{o.order_items?.length ?? 0} item(s)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`status-pill ${STATUS_PILL[o.status]}`}>
                      <span className={`status-dot ${
                        o.status === 'pending' ? 'bg-slate-400' :
                        o.status === 'approved' || o.status === 'packed' || o.status === 'delivered' ? 'bg-success' :
                        o.status === 'rejected' || o.status === 'expired' ? 'bg-danger' :
                        'bg-blue-600'
                      }`} />
                      {ORDER_STATUS_LABELS[o.status]}
                    </span>
                    {o.status === 'packed' && (
                      <span className="badge badge-blue">
                        Ready for delivery
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}