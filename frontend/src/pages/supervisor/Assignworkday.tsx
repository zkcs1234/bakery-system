import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, ChevronLeft, Truck, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { Order } from '../../types';

// NOTE — backend assumptions this page relies on:
//  1. `Order` includes `work_day: string | null`.
//  2. PATCH /orders/:id/work-day   body: { work_day: 'YYYY-MM-DD' }
//     — validates work_day <= order.delivery_date and persists it.
//  3. /production/generate matches approved orders to a plan by
//     `work_day === production_date` (manual), not delivery_date - 1.
// If these don't exist yet on the backend, this page's save step will fail —
// share the orders/production route files and I'll wire the exact contract.

export default function AssignWorkDay() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const todayStr = dayjs().format('YYYY-MM-DD');

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    api.get(`/orders/${orderId}`)
      .then(r => {
        const found = r.data.order ?? null;
        if (!found) {
          setLoadError('Order not found.');
        } else if (found.status !== 'approved') {
          setLoadError('Only approved orders can be scheduled for production. Approve this order first.');
        }
        setOrder(found);
      })
      .catch(() => setLoadError('Failed to load order.'))
      .finally(() => setLoading(false));
  }, [orderId]);

  const deliveryOverdue = order ? dayjs(order.delivery_date).isBefore(todayStr) : false;

  const confirmWorkDay = async () => {
    if (!order || !selectedDate) return;
    setSaving(true); setSaveError('');
    try {
      await api.patch(`/orders/${order.id}/work-day`, { work_day: selectedDate });
      try {
        // Build/refresh the consolidated plan for this work day. Safe to call even
        // if a plan already exists for it (other orders may already be combined in).
        await api.post('/production/generate', { production_date: selectedDate });
      } catch {
        // Generation issues (e.g. ingredient shortages) are surfaced on the plan page itself.
      }
      navigate(`/supervisor/plan/${selectedDate}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(msg ?? 'Failed to assign work day.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/supervisor" className="p-2 rounded-lg text-gray-400 hover:bg-wheat-100 hover:text-gray-600">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-2xl font-display font-bold text-gray-800">Assign Work Day</h1>
      </div>

      {loading && (
        <div className="card text-center py-12 text-gray-400">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" />
          Loading order…
        </div>
      )}

      {!loading && loadError && (
        <div className="shortage-alert">{loadError}</div>
      )}

      {!loading && order && (
        <div className="card-md space-y-4">
          {/* Order summary */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display font-semibold text-gray-800">{order.branches?.name ?? 'Branch order'}</p>
              <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1">
                <Truck size={13} className="text-blue-500" />
                Delivery: {dayjs(order.delivery_date).format('dddd, MMMM D, YYYY')}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {order.order_items?.length ?? 0} items{order.is_special ? ' · Special order' : ''}
              </p>
            </div>
            {order.is_special && <AlertTriangle size={16} className="text-orange-500 flex-shrink-0" />}
          </div>

          {order.order_items && order.order_items.length > 0 && (
            <div className="rounded-xl border border-wheat-200 bg-wheat-50 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">Products ordered by this branch</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {order.order_items.map(item => (
                  <div key={item.id} className="rounded-lg border border-wheat-100 bg-white p-3">
                    <p className="text-sm font-medium text-gray-800">{item.products?.name ?? 'Product'}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {item.batches} batch{item.batches !== 1 ? 'es' : ''}
                      {item.products?.base_yield_qty ? ` · ${item.products.base_yield_qty} ${item.products.yield_unit}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {deliveryOverdue && (
            <div className="rounded-lg px-3 py-2 bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>This order's delivery date has already passed. Confirm with the branch before scheduling production.</span>
            </div>
          )}

          {/* Already scheduled */}
          {order.work_day && !editing ? (
            <div className="rounded-lg px-3 py-3 bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-emerald-700 flex items-center gap-2">
                <CheckCircle2 size={15} className="flex-shrink-0" />
                <span>Work day already assigned: <strong>{dayjs(order.work_day).format('dddd, MMMM D, YYYY')}</strong></span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => { setSelectedDate(order.work_day ?? ''); setEditing(true); }}
                  className="btn-secondary btn-sm"
                >
                  Change
                </button>
                <Link to={`/supervisor/plan/${order.work_day}`} className="btn-primary btn-sm">
                  View Plan
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <label className="label">Work Day</label>
              <input
                type="date"
                className="input"
                value={selectedDate}
                min={todayStr}
                max={order.delivery_date}
                onChange={e => { setSelectedDate(e.target.value); setSaveError(''); }}
                disabled={saving}
              />
              <p className="text-xs text-gray-500 mt-2 flex items-start gap-1.5">
                <Info size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
                Must be on or before the delivery date ({dayjs(order.delivery_date).format('MMM D, YYYY')}). Orders sharing the same work day are combined into one production plan.
              </p>

              {saveError && <div className="shortage-alert text-sm mt-2">{saveError}</div>}

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={confirmWorkDay}
                  disabled={saving || !selectedDate}
                  className="btn-primary"
                >
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Confirm Work Day'}
                </button>
                {order.work_day && editing && (
                  <button type="button" onClick={() => setEditing(false)} className="btn-secondary btn-sm">
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}