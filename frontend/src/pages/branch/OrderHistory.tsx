import { useEffect, useState, useCallback } from 'react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import weekday from 'dayjs/plugin/weekday';
import localeData from 'dayjs/plugin/localeData';
import type { Order } from '../../types';
import { ORDER_STATUS_LABELS } from '../../types';

import { ChevronDown, RefreshCw, ChevronUp, ChevronsUpDown } from 'lucide-react';

dayjs.extend(weekday);
dayjs.extend(localeData);

/* ── Constants ───────────────────────────────────────────────────── */
const STATUS_BADGE: Record<string, string> = {
  pending:       'badge-amber',
  approved:      'badge-green',
  rejected:      'badge-red',
  in_production: 'badge-blue',
  packed:        'badge-purple',
  delivered:     'badge-green',
  expired:       'badge-red',
};

const ALL_STATUSES = ['pending','approved','rejected','in_production','packed','delivered','expired'] as const;

type SortField = 'created_at' | 'delivery_date';
type SortDir   = 'asc' | 'desc';

function getApiError(e: unknown) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? 'Something went wrong.';
}

/* ── Column width map — shared by <col>, <th>, and <td> ─────────── */
const COL = {
  placed:   'w-36',   // 144 px
  delivery: 'w-36',   // 144 px
  items:    'w-20',   //  80 px
  type:     'w-24',   //  96 px
  status:   'w-32',   // 128 px
  expand:   'w-10',   //  40 px
} as const;

/* ── Summary pill ────────────────────────────────────────────────── */
function SummaryPill({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
        active
          ? 'bg-crust-600 text-white border-crust-600'
          : 'bg-white text-gray-600 border-gray-200 hover:border-crust-300 hover:text-crust-700'
      }`}
    >
      {label}
      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
        active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
      }`}>{count}</span>
    </button>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
export default function OrderHistory() {
  const [orders, setOrders]             = useState<Order[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [loadError, setLoadError]       = useState('');
  const [offset, setOffset]             = useState(0);
  const [total, setTotal]               = useState(0);
  const PAGE_SIZE = 50;
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [sortField, setSortField]       = useState<SortField>('created_at');
  const [sortDir, setSortDir]           = useState<SortDir>('desc');

  const fetchOrders = useCallback((isRefresh = false, nextOffset = 0) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    api.get('/orders', { params: { limit: PAGE_SIZE, offset: nextOffset } })
      .then(r => {
        const batch = r.data.orders ?? [];
        setOrders(prev => nextOffset === 0 ? batch : [...prev, ...batch]);
        setTotal(r.data.total ?? batch.length);
        setOffset(nextOffset);
      })
      .catch(e => setLoadError(getApiError(e)))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown size={12} className="text-gray-300 ml-1 inline shrink-0" />;
    return sortDir === 'asc'
      ? <ChevronUp   size={12} className="text-crust-600 ml-1 inline shrink-0" />
      : <ChevronDown size={12} className="text-crust-600 ml-1 inline shrink-0" />;
  };

  const pendingCount  = orders.filter(o => o.status === 'pending').length;
  const approvedCount = orders.filter(o => o.status === 'approved').length;
  const inProdCount   = orders.filter(o => o.status === 'in_production').length;

  const filtered = orders
    .filter(o => !filterStatus || o.status === filterStatus)
    .sort((a, b) => {
      const va = dayjs(a[sortField]).valueOf();
      const vb = dayjs(b[sortField]).valueOf();
      return sortDir === 'asc' ? va - vb : vb - va;
    });

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Order History</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} order{total !== 1 ? 's' : ''} total
            {orders.length < total && (
              <span className="ml-2 text-gray-400">(showing {orders.length})</span>
            )}
            {pendingCount > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">
                · {pendingCount} awaiting approval
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => fetchOrders(true)}
          disabled={refreshing}
          title="Refresh orders"
          className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 shrink-0"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loadError && <div className="shortage-alert text-sm">{loadError}</div>}

      {/* ── Summary pills ── */}
      {!loading && orders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <SummaryPill
            label="All" count={orders.length}
            active={filterStatus === null}
            onClick={() => setFilterStatus(null)}
          />
          {pendingCount > 0 && (
            <SummaryPill label="Pending" count={pendingCount}
              active={filterStatus === 'pending'} onClick={() => setFilterStatus('pending')} />
          )}
          {approvedCount > 0 && (
            <SummaryPill label="Approved" count={approvedCount}
              active={filterStatus === 'approved'} onClick={() => setFilterStatus('approved')} />
          )}
          {inProdCount > 0 && (
            <SummaryPill label="In Production" count={inProdCount}
              active={filterStatus === 'in_production'} onClick={() => setFilterStatus('in_production')} />
          )}
          {ALL_STATUSES
            .filter(s => !['pending','approved','in_production'].includes(s))
            .map(s => {
              const count = orders.filter(o => o.status === s).length;
              if (!count) return null;
              return (
                <SummaryPill key={s} label={ORDER_STATUS_LABELS[s]} count={count}
                  active={filterStatus === s} onClick={() => setFilterStatus(s)} />
              );
            })
          }
        </div>
      )}

      {/* ── Table ── */}
      <div className="table-wrapper">
        <table className="table table-fixed w-full">
          {/* Pinned column widths — prevents any cell content from stretching a column */}
          <colgroup>
            <col className={COL.placed}   />
            <col className={COL.delivery} />
            <col className={COL.items}    />
            <col className={COL.type}     />
            <col className={COL.status}   />
            <col className={COL.expand}   />
          </colgroup>

          <thead>
            <tr>
              <th className={COL.placed}>
                <button onClick={() => toggleSort('created_at')}
                  className="flex items-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  Date Placed <SortIcon field="created_at" />
                </button>
              </th>
              <th className={COL.delivery}>
                <button onClick={() => toggleSort('delivery_date')}
                  className="flex items-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  Delivery <SortIcon field="delivery_date" />
                </button>
              </th>
              <th className={`${COL.items}  text-xs font-semibold uppercase tracking-wide`}>Items</th>
              <th className={`${COL.type}   text-xs font-semibold uppercase tracking-wide`}>Type</th>
              <th className={`${COL.status} text-xs font-semibold uppercase tracking-wide`}>Status</th>
              <th className={COL.expand}></th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-sm text-gray-400">
                  Loading orders…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-sm text-gray-400">
                  {filterStatus
                    ? `No ${(ORDER_STATUS_LABELS as Record<string, string>)[filterStatus]?.toLowerCase()} orders.`
                    : 'No orders yet.'}
                </td>
              </tr>
            ) : filtered.map(o => {
              const isOpen = expanded === o.id;
              return (
                <>
                  <tr
                    key={o.id}
                    onClick={() => setExpanded(isOpen ? null : o.id)}
                    className={`cursor-pointer hover:bg-wheat-50 transition-colors ${isOpen ? 'bg-wheat-50/60' : ''}`}
                  >
                    {/* Date placed */}
                    <td className={COL.placed}>
                      <p className="text-sm font-medium text-gray-700 leading-snug">
                        {dayjs(o.created_at).format('MMM D, YYYY')}
                      </p>
                      <p className="text-xs text-gray-400 leading-snug">
                        {dayjs(o.created_at).format('h:mm A')}
                      </p>
                    </td>

                    {/* Delivery */}
                    <td className={COL.delivery}>
                      <p className="text-sm font-semibold text-gray-800 leading-snug">
                        {dayjs(o.delivery_date).format('ddd, MMM D')}
                      </p>
                      <p className="text-xs text-gray-400 leading-snug">
                        {dayjs(o.delivery_date).format('YYYY')}
                      </p>
                    </td>

                    {/* Items */}
                    <td className={`${COL.items} text-sm text-gray-600`}>
                      {o.order_items?.length ?? 0} item{(o.order_items?.length ?? 0) !== 1 ? 's' : ''}
                    </td>

                    {/* Type */}
                    <td className={COL.type}>
                      {o.is_special
                        ? <span className="badge-orange text-xs">Special</span>
                        : <span className="badge-gray text-xs">Standard</span>}
                    </td>

                    {/* Status */}
                    <td className={COL.status}>
                      <div className="flex flex-col gap-1">
                        <span className={`${STATUS_BADGE[o.status] ?? 'badge-gray'} text-xs`}>
                          {ORDER_STATUS_LABELS[o.status]}
                        </span>
                        {o.status === 'packed' && (
                          <span className="inline-flex items-center justify-center rounded-full bg-purple-100 text-purple-700 px-2 py-1 text-xs font-semibold">
                            Ready for delivery
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Expand chevron */}
                    <td className={`${COL.expand} text-center`}>
                      <ChevronDown
                        size={15}
                        className={`mx-auto text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </td>
                  </tr>

                  {/* ── Expanded detail ── */}
                  {isOpen && (
                    <tr key={`${o.id}-detail`}>
                      <td colSpan={6} className="bg-wheat-50/50 px-5 py-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
                          Products in this order
                        </p>
                        {o.status === 'packed' && (
                          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
                            Ready for delivery
                          </div>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {(o.order_items ?? []).map(item => (
                            <div key={item.id}
                              className="bg-white rounded-lg border border-wheat-200 px-3 py-2.5 flex flex-col gap-0.5">
                              <p className="text-sm font-semibold text-gray-800 leading-snug">
                                {item.products?.name}
                              </p>
                              <p className="text-xs text-gray-400">
                                {item.batches} batch{item.batches !== 1 ? 'es' : ''}
                                {' · '}
                                {(item.products?.base_yield_qty ?? 0) * item.batches} {item.products?.yield_unit}
                              </p>
                            </div>
                          ))}
                        </div>
                        {o.special_notes && (
                          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5">
                            <p className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-1">
                              Special Instructions
                            </p>
                            <p className="text-sm text-gray-700">{o.special_notes}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {orders.length < total && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading || refreshing}
            onClick={() => fetchOrders(false, offset + PAGE_SIZE)}
          >
            Load more orders
          </button>
        </div>
      )}
    </div>
  );
}