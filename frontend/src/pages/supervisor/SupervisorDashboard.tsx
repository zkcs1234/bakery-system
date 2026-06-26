import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, Truck, Info,
} from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { Order } from '../../types';

interface OrderSummaryCounts {
  pending: number;
  special_pending: number;
  approved_unscheduled: number;
  approved_scheduled: number;
}

export default function SupervisorDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<OrderSummaryCounts>({
    pending: 0,
    special_pending: 0,
    approved_unscheduled: 0,
    approved_scheduled: 0,
  });
  const [approvedOrders, setApprovedOrders] = useState<Order[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoadError('');
    setLoading(true);

    Promise.all([
      api.get('/orders/summary'),
      api.get('/orders', { params: { status: 'approved', limit: 50 } }),
      api.get('/orders', { params: { status: 'pending', limit: 20 } }),
    ])
      .then(([summaryRes, approvedRes, pendingRes]) => {
        const counts = summaryRes.data.counts ?? {};
        setSummary({
          pending: counts.pending ?? 0,
          special_pending: counts.special_pending ?? 0,
          approved_unscheduled: counts.approved_unscheduled ?? 0,
          approved_scheduled: counts.approved_scheduled ?? 0,
        });
        setApprovedOrders(approvedRes.data.orders ?? []);
        setPendingOrders(pendingRes.data.orders ?? []);
      })
      .catch((e: unknown) => {
        setLoadError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load orders');
      })
      .finally(() => setLoading(false));
  }, []);

  const branchOrders = useMemo(
    () => [...approvedOrders].sort((a, b) => dayjs(a.delivery_date).diff(dayjs(b.delivery_date))),
    [approvedOrders]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="pageTitle text-blue-950 font-display">Supervisor Dashboard</h1>
        <p className="text-panelSubtitle text-slate-600 mt-1 font-body">
          {dayjs().format('dddd, MMMM D, YYYY')}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Pending Orders</span>
            <div className="kpi-icon-chip">
              <ClipboardList size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{summary.pending}</div>
          <div className="kpi-delta kpi-delta-flat mt-1">
            <span>—</span>
            <span>Awaiting review</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Special Orders</span>
            <div className="kpi-icon-chip">
              <AlertTriangle size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{summary.special_pending}</div>
          <div className="kpi-delta kpi-delta-flat mt-1">
            <span>—</span>
            <span>Priority items</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Unscheduled</span>
            <div className="kpi-icon-chip">
              <Clock size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{summary.approved_unscheduled}</div>
          <div className="kpi-delta kpi-delta-up mt-1">
            <span>▲</span>
            <span>Need work day</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Scheduled</span>
            <div className="kpi-icon-chip">
              <CheckCircle2 size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{summary.approved_scheduled}</div>
          <div className="kpi-delta kpi-delta-flat mt-1">
            <span>—</span>
            <span>In production</span>
          </div>
        </div>
      </div>

      {loadError && <div className="alert alert-danger">{loadError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-[18px]">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Branch Orders</h2>
              <p className="panel-subtitle">Approved orders ready for production</p>
            </div>
            <Link to="/supervisor/orders" className="panel-action-link">
              View all <ChevronRight size={13} />
            </Link>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-blue-50 rounded animate-pulse" />)}
              </div>
            ) : branchOrders.length === 0 ? (
              <div className="rounded-lg p-4 bg-blue-50 border border-border text-sm text-slate-600 font-body flex items-start gap-2">
                <Info size={15} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <span>No approved orders yet. Approve orders from the Orders page, then come back here to assign a work day.</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {branchOrders.slice(0, 6).map(order => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => navigate(order.work_day
                      ? `/supervisor/plan/${order.work_day}`
                      : `/supervisor/assign/${order.id}`
                    )}
                    className="w-full text-left rounded-lg border border-border hover:border-blue-300 hover:bg-blue-50 p-3 flex items-center gap-3 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Truck size={14} className="text-slate-400" />
                        <p className="text-sm font-medium text-ink font-body truncate">{order.branches?.name ?? 'Branch order'}</p>
                        {order.is_special && <AlertTriangle size={12} className="text-warning flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono">
                        Delivery {dayjs(order.delivery_date).format('ddd, MMM D, YYYY')}
                        {' · '}{order.order_items?.length ?? 0} items
                      </p>
                    </div>
                    {order.work_day ? (
                      <span className="status-pill status-pill-done shrink-0">
                        <span className="status-dot bg-success" />
                        <CheckCircle2 size={11} />
                        {dayjs(order.work_day).format('MMM D')}
                      </span>
                    ) : (
                      <span className="status-pill status-pill-delay shrink-0">
                        <span className="status-dot bg-warning" />
                        <Clock size={11} />
                        Needs work day
                      </span>
                    )}
                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Pending Orders</h2>
              <p className="panel-subtitle">Awaiting approval</p>
            </div>
            <Link to="/supervisor/orders" className="panel-action-link">
              View all <ChevronRight size={13} />
            </Link>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-blue-50 rounded animate-pulse" />)}
              </div>
            ) : pendingOrders.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <CheckCircle2 size={28} className="mx-auto mb-2 text-success" />
                <p className="text-sm font-body">No pending orders</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {pendingOrders.slice(0, 8).map(o => (
                  <div
                    key={o.id}
                    className={`flex items-center gap-3 p-2 rounded-lg border text-sm ${
                      o.is_special ? 'border-warning/30 bg-warningBg' : 'border-border hover:bg-blue-50'
                    }`}
                  >
                    {o.is_special && <AlertTriangle size={12} className="text-warning flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink font-body truncate">{o.branches?.name}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        Delivery: {dayjs(o.delivery_date).format('MMM D')}
                        {' · '}{o.order_items?.length ?? 0} items
                      </p>
                    </div>
                    <Link to="/supervisor/orders" className="btn-secondary btn-sm shrink-0">
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
