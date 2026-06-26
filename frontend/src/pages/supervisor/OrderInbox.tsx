import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, RefreshCw, Send, X, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);
import type { Order } from '../../types';
import { ORDER_STATUS_LABELS } from '../../types';

const STATUS_BADGE: Record<string, string> = {
  pending:       'badge-amber',
  approved:      'badge-green',
  rejected:      'badge-red',
  in_production: 'badge-blue',
  packed:        'badge-gray',
  delivered:     'badge-gray',
  expired:       'badge-red',
};

// Quick-pick rejection reasons the supervisor can tap instead of typing
const QUICK_REASONS = [
  'Insufficient ingredients',
  'Order submitted too late',
  'Delivery date unavailable',
  'Quantity exceeds capacity',
  'Branch quota reached',
];

interface RejectDraft {
  orderId: string;
  reason: string;
}

export default function OrderInbox() {
  type OrderFilter = 'all' | 'pending' | 'in_production' | 'packed';

  const [orders, setOrders]         = useState<Order[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<OrderFilter>('pending');
  const [actioning, setActioning]   = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [loadError, setLoadError]   = useState('');
  const [actionError, setActionError] = useState('');

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const inProductionCount = orders.filter(o => o.status === 'in_production').length;
  const packedCount = orders.filter(o => o.status === 'packed').length;
  const filteredOrders = filter === 'all' ? orders : orders.filter(o => o.status === filter);

  // Rejection flow state — null means no rejection dialog open
  const [rejectDraft, setRejectDraft] = useState<RejectDraft | null>(null);
  const [rejectSending, setRejectSending] = useState(false);
  const [rejectError, setRejectError]     = useState('');

  const fetchOrders = () => {
    setLoading(true);
    setLoadError('');
    setActionError('');
    const params: Record<string, string | number> = { limit: 100 };
    if (filter !== 'all') params.status = filter;
    api.get('/orders', { params })
      .then(r => setOrders(r.data.orders))
      .catch((e: unknown) => {
        setLoadError(
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? 'Failed to load orders'
        );
      })
      .finally(() => setLoading(false));
  };
  useEffect(fetchOrders, []);

  // ── Approve ───────────────────────────────────────────────────────────────
  const approve = async (id: string) => {
    setActioning(id);
    setActionError('');
    try {
      await api.patch(`/orders/${id}/approve`);
      fetchOrders();
    } catch (error: unknown) {
      setActionError(
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to approve order'
      );
    } finally {
      setActioning(null);
    }
  };

  // ── Open rejection compose panel ──────────────────────────────────────────
  const openReject = (orderId: string) => {
    setRejectDraft({ orderId, reason: '' });
    setRejectError('');
    // Auto-expand that order so the panel sits inline
    setExpanded(orderId);
  };

  const closeReject = () => {
    setRejectDraft(null);
    setRejectError('');
  };

  // ── Submit rejection with reason → notify branch ──────────────────────────
  const submitReject = async () => {
    if (!rejectDraft) return;
    const trimmed = rejectDraft.reason.trim();
    if (!trimmed) {
      setRejectError('Please provide a reason before sending.');
      return;
    }

    setRejectSending(true);
    setRejectError('');
    try {
      // 1. Reject the order with the typed reason
      await api.patch(`/orders/${rejectDraft.orderId}/reject`, {
        reason: trimmed,
      });

      // 2. Send a notification/message to the branch manager who placed the order
      //    POST /notifications  — adjust endpoint to match your backend schema
      const order = orders.find(o => o.id === rejectDraft.orderId);
      if (order) {
        await api.post('/notifications', {
          recipient_user_id: order.placed_by_user?.id,
          type:              'order_rejected',
          title:             'Your order was rejected',
          body:              trimmed,
          metadata: {
            order_id:      order.id,
            branch_name:   order.branches?.name,
            delivery_date: order.delivery_date,
          },
        });
      }

      closeReject();
      fetchOrders();
    } catch (error: unknown) {
      setRejectError(
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to reject order. Please try again.'
      );
    } finally {
      setRejectSending(false);
    }
  };

  // ── Group by delivery date ────────────────────────────────────────────────
  const grouped = filteredOrders.reduce<Record<string, Order[]>>((acc, o) => {
    const date = o.delivery_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(o);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* Page header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-gray-800">Order Inbox</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {orders.length} orders · {pendingCount} pending · {inProductionCount} in production · {packedCount} ready for delivery
            </p>
          </div>
          <button onClick={fetchOrders} className="btn-secondary btn-sm flex-shrink-0"><RefreshCw size={13} /></button>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {(
            [
              { key: 'all', label: 'All orders', count: orders.length },
              { key: 'pending', label: 'Pending', count: pendingCount },
              { key: 'in_production', label: 'In Production', count: inProductionCount },
              { key: 'packed', label: 'Ready for Delivery', count: packedCount },
            ] as const
          ).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`btn-sm rounded-lg ${filter === key ? 'btn-primary' : 'btn-secondary'}`}
              disabled={count === 0 && key !== 'all'}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      {loadError  && <div className="shortage-alert">{loadError}</div>}
      {actionError && <div className="shortage-alert">{actionError}</div>}

      {/* Order list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-white rounded-lg animate-pulse border border-wheat-100" />
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <CheckCircle2 size={36} className="mx-auto mb-2 text-sage-400" />
          <p>No orders found</p>
        </div>
      ) : (
        Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dateOrders]) => {
            const approvedCountForDate = dateOrders.filter(o => o.status === 'approved').length;
            return (
            <div key={date} className="space-y-2">

              {/* Date group header */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div>
                  <span className="text-sm font-semibold text-gray-600">
                    {dayjs(date).format('dddd, MMMM D, YYYY')}
                  </span>
                  <p className="text-xs text-gray-400">Delivery date</p>
                </div>
                <div className="flex-1 h-px bg-wheat-200" />
              </div>

              {/* Orders in this date group */}
              {dateOrders.map(order => {
                const isRejectingThis = rejectDraft?.orderId === order.id;

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-lg border shadow-card overflow-hidden transition-all ${
                      order.is_special ? 'border-orange-300' : 'border-wheat-100'
                    } ${isRejectingThis ? 'ring-2 ring-red-200' : ''}`}
                  >
                    {/* Order header row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      {order.is_special && (
                        <AlertTriangle size={15} className="text-orange-500 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-800 text-sm">{order.branches?.name}</p>
                          {order.is_special && <span className="badge-orange">Special Order</span>}
                          <div className="flex flex-col gap-1">
                            <span className={STATUS_BADGE[order.status]}>
                              {ORDER_STATUS_LABELS[order.status]}
                            </span>
                            {order.status === 'packed' && (
                              <span className="inline-flex items-center justify-center rounded-full bg-purple-100 text-purple-700 px-2 py-1 text-xs font-semibold">
                                Ready for delivery
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Placed by {order.placed_by_user?.full_name}
                          {' · '}{dayjs(order.created_at).format('MMM D, h:mm A')}
                          {order.expires_at && order.status === 'pending' && (
                            <span className="text-amber-500 ml-2">
                              · Expires {dayjs(order.expires_at).fromNow()}
                            </span>
                          )}
                        </p>
                        {/* Delivery; show work day only for approved/in-progress/packed orders */}
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                            🚚 Delivery: {dayjs(order.delivery_date).format('ddd, MMM D, YYYY')}
                          </span>
                          {order.status !== 'pending' && (
                            <span className="text-xs text-gray-400">
                              Work day: {dayjs(order.work_day ?? order.delivery_date).format('ddd, MMM D')}
                            </span>
                          )}
                        </div>

                        {/* Show saved rejection reason on already-rejected orders */}
                        {order.status === 'rejected' && (order as any).rejection_reason && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <XCircle size={11} />
                            Reason sent: {(order as any).rejection_reason}
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                          className={`btn-ghost btn-sm transition-transform ${expanded === order.id ? 'rotate-180' : ''}`}
                        >
                          <ChevronDown size={16} />
                        </button>
                        {order.status === 'pending' && (
                          <>
                            <button
                              onClick={() => approve(order.id)}
                              disabled={actioning === order.id || isRejectingThis}
                              className="btn-success btn-sm"
                            >
                              {actioning === order.id
                                ? <Loader2 size={13} className="animate-spin" />
                                : <CheckCircle2 size={13} />}
                              Approve
                            </button>
                            <button
                              onClick={() => isRejectingThis ? closeReject() : openReject(order.id)}
                              disabled={actioning === order.id}
                              className={`btn-sm ${isRejectingThis ? 'btn-secondary' : 'btn-danger'}`}
                            >
                              {isRejectingThis ? <X size={13} /> : <XCircle size={13} />}
                              {isRejectingThis ? 'Cancel' : 'Reject'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Expanded order items */}
                    {expanded === order.id && !isRejectingThis && (
                      <div className="border-t border-wheat-100 px-4 py-3 bg-wheat-50/40">
                        {order.status === 'packed' && (
                          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
                            Ready for delivery
                          </div>
                        )}
                        {order.special_notes && (
                          <div className="warning-alert mb-3 text-xs">
                            <strong>Special notes:</strong> {order.special_notes}
                          </div>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {(order.order_items ?? []).map(item => (
                            <div key={item.id} className="bg-white rounded-lg border border-wheat-100 p-2">
                              <p className="text-xs font-medium text-gray-700">{item.products?.name}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {item.batches} batch{item.batches > 1 ? 'es' : ''}{' '}
                                ×{item.products?.base_yield_qty} {item.products?.yield_unit}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Rejection compose panel ─────────────────────────── */}
                    {isRejectingThis && (
                      <div className="border-t border-red-100 bg-red-50/40 px-4 py-4 space-y-3">

                        {/* Order items summary (compact, so supervisor remembers what they're rejecting) */}
                        {(order.order_items ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pb-1">
                            {(order.order_items ?? []).map(item => (
                              <span key={item.id}
                                className="text-xs bg-white border border-red-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {item.products?.name} ×{item.batches}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Label */}
                        <div>
                          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
                            Rejection notice to {order.branches?.name}
                          </p>
                          <p className="text-xs text-gray-500 mb-2">
                            This message will be sent to{' '}
                            <span className="font-medium text-gray-700">{order.placed_by_user?.full_name}</span>.
                          </p>
                        </div>

                        {/* Quick-pick reasons */}
                        <div className="flex flex-wrap gap-1.5">
                          {QUICK_REASONS.map(r => (
                            <button
                              key={r}
                              onClick={() => setRejectDraft(d => d ? { ...d, reason: r } : d)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                rejectDraft?.reason === r
                                  ? 'bg-red-600 border-red-600 text-white'
                                  : 'bg-white border-red-200 text-red-700 hover:bg-red-50'
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>

                        {/* Free-text message */}
                        <textarea
                          rows={4}
                          placeholder={`Write a message to ${order.branches?.name}…\n\nE.g. "Your order for Jun 18 has been rejected due to insufficient bread flour stock. Please resubmit with reduced quantities or contact the production team."`}
                          value={rejectDraft?.reason ?? ''}
                          onChange={e => setRejectDraft(d => d ? { ...d, reason: e.target.value } : d)}
                          className="w-full text-sm border border-red-200 rounded-lg px-3 py-2.5 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                        />

                        {/* Character count hint */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">
                            {(rejectDraft?.reason ?? '').trim().length === 0
                              ? 'A reason is required.'
                              : `${(rejectDraft?.reason ?? '').trim().length} characters`}
                          </span>
                          {rejectError && (
                            <span className="text-xs text-red-600 flex items-center gap-1">
                              <AlertTriangle size={11} /> {rejectError}
                            </span>
                          )}
                        </div>

                        {/* Action row */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={submitReject}
                            disabled={rejectSending || !(rejectDraft?.reason ?? '').trim()}
                            className="btn-danger btn-sm flex items-center gap-1.5"
                            style={{ opacity: !(rejectDraft?.reason ?? '').trim() ? 0.45 : 1 }}
                          >
                            {rejectSending
                              ? <><Loader2 size={13} className="animate-spin" /> Sending…</>
                              : <><Send size={13} /> Reject &amp; Notify Branch</>}
                          </button>
                          <button onClick={closeReject} className="btn-secondary btn-sm">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            );
          })
      )}
    </div>
  );
}