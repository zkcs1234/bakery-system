import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, Users, Truck } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { ProductionPlan, User, TaskRole, WorkerLoad, Order } from '../../types';

// NOTE: delivery info on this page now comes from approved orders' own
// `work_day` field grouped by work day, rather than assuming delivery = work day + 1.

// ─── Types ────────────────────────────────────────────────────────────────────
interface ExistingTask {
  id: string;
  task_role: TaskRole;
  batches_assigned: number;
  status: 'pending' | 'in_progress' | 'completed';
  is_priority: boolean;
  assigned_user?: { id: string; full_name: string; role: string };
}
interface PlanItemFull {
  id: string;
  product_id: string;
  total_batches: number;
  products?: {
    id: string; name: string; dough_type: string;
    base_yield_qty: number; yield_unit: string;
    oven_temp_c: number | null; bake_time_min: number | null;
  };
  tasks?: ExistingTask[];
}
interface PlanWithOrders extends ProductionPlan {
  /** Count of approved orders whose work_day === production_date */
  order_count?: number;
}
interface AssignRow { user_id: string; batches: number; }

const ROLE_LABELS: Record<TaskRole, string> = {
  scaling: 'Scaling', mixing: 'Mixing', baking: 'Baking', repacking: 'Repacking',
};
const ROLE_TO_DB: Record<TaskRole, string> = {
  scaling: 'scaler', mixing: 'mixer', baking: 'baker', repacking: 'repacker',
};
const STAGES: TaskRole[] = ['scaling', 'mixing', 'baking', 'repacking'];

// ─── Inline styles ────────────────────────────────────────────────────────────
const S = {
  page: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '0 4px',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  pageHeader: {
    marginBottom: 24,
  } as React.CSSProperties,

  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--blue-900)',
    margin: 0,
    letterSpacing: '-0.01em',
  } as React.CSSProperties,

  pageSub: {
    fontSize: 13,
    color: 'var(--gray-500)',
    margin: '4px 0 0',
  } as React.CSSProperties,

  selectorCard: {
    background: '#fff',
    border: '1px solid var(--gray-200)',
    borderRadius: 10,
    padding: '16px 20px',
    marginBottom: 20,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,

  deliveryBanner: (urgent: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: urgent ? '#FFF7ED' : '#EFF6FF',
    border: `1px solid ${urgent ? '#FED7AA' : '#BFDBFE'}`,
    borderRadius: 8,
    marginBottom: 16,
  }),

  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--gray-500)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 6,
  } as React.CSSProperties,

  itemCard: {
    background: '#fff',
    border: '1px solid var(--gray-200)',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 1px 4px rgba(12,68,124,0.07)',
    marginBottom: 12,
  } as React.CSSProperties,

  itemHeader: {
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderBottom: '1px solid var(--gray-100)',
    background: 'var(--blue-50)',
  } as React.CSSProperties,

  productName: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--blue-900)',
    margin: 0,
  } as React.CSSProperties,

  metaPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--gray-500)',
    background: '#fff',
    border: '1px solid var(--gray-200)',
    borderRadius: 20,
    padding: '2px 10px',
  } as React.CSSProperties,

  roleGrid: {
    padding: '16px 20px',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 12,
  } as React.CSSProperties,

  roleCard: (ok: boolean, hasRows: boolean): React.CSSProperties => ({
    background: '#FAFBFC',
    border: `1px solid ${hasRows && !ok ? '#FECACA' : hasRows && ok ? '#BBF7D0' : 'var(--gray-200)'}`,
    borderRadius: 10,
    padding: 14,
    transition: 'border-color 0.15s',
  }),

  roleHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  } as React.CSSProperties,

  roleLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--gray-600)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.07em',
  } as React.CSSProperties,

  batchBadge: (ok: boolean): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 20,
    padding: '2px 9px',
    color: ok ? '#15803D' : '#B91C1C',
    background: ok ? '#F0FDF4' : '#FEF2F2',
  }),

  workerRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  } as React.CSSProperties,

  selectWrap: {
    flex: 1,
    position: 'relative',
  } as React.CSSProperties,

  workerSelect: {
    width: '100%',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    MozAppearance: 'none' as const,
    fontSize: 12,
    padding: '6px 28px 6px 10px',
    border: '1px solid var(--gray-200)',
    borderRadius: 7,
    background: 'white url("data:image/svg+xml;utf8,") no-repeat right center',
    backgroundColor: 'white',
    color: 'var(--gray-800)',
    cursor: 'pointer',
    outline: 'none',
    backgroundImage: 'none !important',
  } as React.CSSProperties,

  chevron: {
    position: 'absolute' as const,
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none' as const,
    color: 'var(--gray-400)',
  },

  batchInput: {
    fontSize: 12,
    padding: '6px 8px',
    width: 58,
    border: '1px solid var(--gray-200)',
    borderRadius: 7,
    background: '#fff',
    color: 'var(--gray-800)',
    textAlign: 'center' as const,
    outline: 'none',
  } as React.CSSProperties,

  removeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--gray-300)',
    padding: '4px',
    borderRadius: 5,
    display: 'flex',
    alignItems: 'center',
  } as React.CSSProperties,

  addWorkerBtn: {
    width: '100%',
    border: '1px dashed var(--gray-300)',
    background: 'none',
    borderRadius: 7,
    padding: '7px 0',
    fontSize: 12,
    color: 'var(--blue-700)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    fontWeight: 600,
  } as React.CSSProperties,

  emptyAssignBtn: {
    width: '100%',
    border: '1px dashed var(--gray-300)',
    background: 'none',
    borderRadius: 7,
    padding: '9px 0',
    fontSize: 12,
    color: 'var(--gray-400)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  } as React.CSSProperties,

  errorRow: {
    fontSize: 11,
    color: '#B91C1C',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    margin: '4px 0 0',
  } as React.CSSProperties,

  completedChip: {
    marginBottom: 8,
    padding: '5px 10px',
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    borderRadius: 7,
    fontSize: 11,
    color: '#15803D',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontWeight: 600,
  } as React.CSSProperties,

  saveBtn: (isSaved: boolean, disabled: boolean, isSaving: boolean): React.CSSProperties => ({
    background: isSaved ? '#16A34A' : 'var(--blue-800)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 18px',
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    opacity: disabled ? 0.4 : isSaving ? 0.75 : 1,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  }),

  loadingBox: {
    textAlign: 'center' as const,
    padding: 40,
    color: 'var(--gray-400)',
    background: '#fff',
    borderRadius: 12,
    border: '1px solid var(--gray-200)',
  } as React.CSSProperties,
};

export default function TaskAssignment() {
  const [plans, setPlans]       = useState<PlanWithOrders[]>([]);
  const [workers, setWorkers]   = useState<User[]>([]);
  const [orders, setOrders]     = useState<Order[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [plan, setPlan]         = useState<ProductionPlan | null>(null);
  const [workload, setWorkload] = useState<WorkerLoad[]>([]);
  const [loading, setLoading]   = useState(false);
  const [specialtyMap, setSpecialtyMap] = useState<Record<string, Set<string>>>({});

  // Delivery dates actually tied to each work day, grouped from approved orders'
  // own work_day field (an order can no longer be assumed to deliver "tomorrow").
  const deliveryInfoByWorkDay = useMemo(() => {
    const map: Record<string, { dates: string[]; count: number }> = {};
    orders.filter(o => o.status === 'approved' && o.work_day).forEach(o => {
      const wd = o.work_day as string;
      if (!map[wd]) map[wd] = { dates: [], count: 0 };
      if (!map[wd].dates.includes(o.delivery_date)) map[wd].dates.push(o.delivery_date);
      map[wd].count += 1;
    });
    Object.values(map).forEach(v => v.dates.sort());
    return map;
  }, [orders]);

  const selectedDeliveryInfo = selectedDate ? deliveryInfoByWorkDay[selectedDate] : undefined;
  const primaryDeliveryDate  = selectedDeliveryInfo?.dates[0];
  const deliveryDate         = primaryDeliveryDate ? dayjs(primaryDeliveryDate) : null;
  const deliveryDateStr      = deliveryDate ? deliveryDate.format('MMMM D, YYYY') : '';
  const deliveryDayName      = deliveryDate ? deliveryDate.format('dddd') : '';
  const extraDeliveryDates   = (selectedDeliveryInfo?.dates.length ?? 0) - 1;

  // Is the soonest delivery tied to this work day today or tomorrow? Flag it as urgent.
  const isUrgent = deliveryDate
    ? deliveryDate.diff(dayjs().startOf('day'), 'day') <= 1
    : false;

  const [assignments, setAssignments] = useState<Record<string, Record<TaskRole, AssignRow[]>>>({});
  const [saving, setSaving]   = useState<string | null>(null);
  const [saved, setSaved]     = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([api.get('/production/plans'), api.get('/users'), api.get('/specialties'), api.get('/orders', { params: { status: 'approved', limit: 100 } })])
      .then(([p, u, s, o]) => {
        setPlans(p.data.plans ?? []);
        setWorkers(
          u.data.users.filter(
            (w: User) => ['scaler', 'mixer', 'baker', 'repacker'].includes(w.role) && w.is_active
          )
        );

        const specialties = s.data.specialties ?? [];
        const map: Record<string, Set<string>> = {};
        specialties.forEach((sp: any) => {
          const uid = sp.user_id;
          const pid = sp.product_id ?? sp.product?.id ?? null;
          if (!uid || !pid) return;
          if (!map[uid]) map[uid] = new Set();
          map[uid].add(pid);
        });
        setSpecialtyMap(map);
        setOrders(o.data.orders ?? []);
      });
  }, []);

  const loadWorkload = (planId: string) => {
    api.get(`/production/workload/${planId}`).then(r => setWorkload(r.data.workload ?? []));
  };

  const loadPlan = useCallback((date: string) => {
    setSelectedDate(date);
    setPlan(null);
    setLoading(true);
    api.get(`/production/plans/${date}`).then(r => {
      const planData = r.data.plan as ProductionPlan;
      setPlan(planData);
      const prefill: Record<string, Record<TaskRole, AssignRow[]>> = {};
      ((planData.production_plan_items ?? []) as PlanItemFull[]).forEach(item => {
        const byRole: Record<TaskRole, AssignRow[]> = { scaling: [], mixing: [], baking: [], repacking: [] };
        (item.tasks ?? []).forEach(t => {
          // Include ALL tasks in prefill, including completed ones, so the supervisor
          // can see who did the work. Completed tasks are shown read-only via completedTask chip.
          // Only skip tasks that have no assigned user at all.
          if (!t.assigned_user) return;
          // Don't put completed tasks back into editable rows — they're displayed via the chip.
          if (t.status === 'completed') return;
          byRole[t.task_role].push({ user_id: t.assigned_user.id, batches: t.batches_assigned });
        });
        prefill[item.id] = byRole;
      });
      setAssignments(prefill);
      // Mark items as saved if the server has ANY assigned task (including completed).
      const savedMap: Record<string, boolean> = {};
      ((planData.production_plan_items ?? []) as PlanItemFull[]).forEach(item => {
        const hasAssigned = (item.tasks ?? []).some((t: ExistingTask) => !!t.assigned_user);
        savedMap[item.id] = hasAssigned;
      });
      setSaved(savedMap);
      setSaveError({});
      if (planData.id) loadWorkload(planData.id);
    }).finally(() => setLoading(false));
  }, []);

  // ── Mutators ──────────────────────────────────────────────────────────────
  const addRow = (planItemId: string, role: TaskRole) => {
    setAssignments(prev => {
      const item = prev[planItemId] ?? { scaling: [], mixing: [], baking: [], repacking: [] };
      return { ...prev, [planItemId]: { ...item, [role]: [...item[role], { user_id: '', batches: 0 }] } };
    });
    setSaved(s => ({ ...s, [planItemId]: false }));
    setSaveError(e => ({ ...e, [planItemId]: '' }));
  };

  const removeRow = (planItemId: string, role: TaskRole, idx: number) => {
    setAssignments(prev => {
      const item = prev[planItemId];
      const rows = [...item[role]];
      rows.splice(idx, 1);
      return { ...prev, [planItemId]: { ...item, [role]: rows } };
    });
    setSaved(s => ({ ...s, [planItemId]: false }));
    setSaveError(e => ({ ...e, [planItemId]: '' }));
  };

  const updateRow = (planItemId: string, role: TaskRole, idx: number, field: 'user_id' | 'batches', value: string | number) => {
    setAssignments(prev => {
      const item = prev[planItemId];
      const rows = [...item[role]];
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...prev, [planItemId]: { ...item, [role]: rows } };
    });
    setSaved(s => ({ ...s, [planItemId]: false }));
    setSaveError(e => ({ ...e, [planItemId]: '' }));
  };

  const ensureRow = (planItemId: string, role: TaskRole, totalBatches: number) => {
    setAssignments(prev => {
      const item = prev[planItemId] ?? { scaling: [], mixing: [], baking: [], repacking: [] };
      if (item[role].length > 0) return prev;
      return { ...prev, [planItemId]: { ...item, [role]: [{ user_id: '', batches: totalBatches }] } };
    });
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const roleSum = (planItemId: string, role: TaskRole): number =>
    (assignments[planItemId]?.[role] ?? []).reduce((s, r) => s + (Number(r.batches) || 0), 0);

  const roleValid = (planItemId: string, role: TaskRole, total: number): boolean => {
    const rows = assignments[planItemId]?.[role] ?? [];
    if (!rows.length) return true;
    return roleSum(planItemId, role) === total && rows.every(r => r.user_id);
  };

  const itemHasAnyAssignment = (planItemId: string): boolean =>
    STAGES.some(role => (assignments[planItemId]?.[role] ?? []).length > 0);

  const itemFullyValid = (planItemId: string, total: number): boolean =>
    STAGES.every(role => roleValid(planItemId, role, total));

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async (planItemId: string, total: number) => {
    if (!itemFullyValid(planItemId, total)) return;
    setSaving(planItemId);
    setSaveError(e => ({ ...e, [planItemId]: '' }));
    try {
      // Send all assigned roles in a single request to avoid partial-save failures.
      // Collect every role that has valid rows.
      const allAssignments: { assigned_to: string; task_role: string; batches_assigned: number }[] = [];
      for (const role of STAGES) {
        const rows = (assignments[planItemId]?.[role] ?? []).filter(r => r.user_id && r.batches > 0);
        for (const r of rows) {
          allAssignments.push({ assigned_to: r.user_id, task_role: role, batches_assigned: r.batches });
        }
      }
      if (!allAssignments.length) return;
      // One atomic call — the backend deletes old tasks for the submitted roles and
      // inserts new ones. Sending all roles together prevents partial-write state.
      await api.post('/production/assign', {
        plan_item_id: planItemId,
        assignments: allAssignments,
      });
      setSaved(s => ({ ...s, [planItemId]: true }));
      if (plan?.id) loadWorkload(plan.id);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to save assignments. Please try again.';
      setSaveError(prev => ({ ...prev, [planItemId]: msg }));
    } finally {
      setSaving(null);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const getEligible = (role: TaskRole, productId?: string, currentUserId?: string) => {
    const list = workers.filter(w => w.role === ROLE_TO_DB[role]);
    if (role === 'baking' && productId) {
      const specialists = list.filter(w => specialtyMap[w.id]?.has(productId));
      if (specialists.length > 0) {
        // If the currently assigned baker is not a specialist, include them anyway
        // so the dropdown shows the existing assignment and doesn't break validation.
        if (currentUserId && !specialists.find(w => w.id === currentUserId)) {
          const currentWorker = list.find(w => w.id === currentUserId);
          return currentWorker ? [...specialists, currentWorker] : specialists;
        }
        return specialists;
      }
    }
    return list;
  };
  const loadFor = (userId: string) => workload.find(w => w.user_id === userId);

  const planItems = (plan?.production_plan_items ?? []) as PlanItemFull[];

  return (
    <div style={S.page}>
      {/* Page header */}
      <div style={S.pageHeader}>
        <h1 style={S.pageTitle}>Task Assignment</h1>
        <p style={S.pageSub}>Assign workers per stage — batch counts must match the product total exactly.</p>
      </div>

      {/* Plan selector */}
      <div style={S.selectorCard}>
        <div style={{ flex: 1, maxWidth: 340 }}>
          <label style={S.label}>Work Day</label>
          <div style={{ position: 'relative' }}>
            <select
              className="input"
              value={selectedDate}
              onChange={e => loadPlan(e.target.value)}
              style={{ 
                paddingRight: 32,
                appearance: 'none',
                WebkitAppearance: 'none',
                MozAppearance: 'none',
                backgroundImage: 'none',
              }}
            >
              <option value="">Select a work day…</option>
              {plans.map(p => {
                const wd = p.production_date;
                const info = deliveryInfoByWorkDay[wd];
                const primary = info?.dates[0];
                const daysUntilDelivery = primary ? dayjs(primary).diff(dayjs().startOf('day'), 'day') : null;
                const urgencyLabel = daysUntilDelivery === 0
                  ? ' — delivery TODAY'
                  : daysUntilDelivery === 1
                  ? ' — delivery tomorrow'
                  : '';
                return (
                  <option key={p.id} value={wd}>
                    {dayjs(wd).format('ddd, MMM D, YYYY')}{urgencyLabel}
                  </option>
                );
              })}
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--gray-400)' }} />
          </div>

          {/* Delivery date indicator */}
          {selectedDate && (
            <div style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: isUrgent ? '#92400E' : 'var(--gray-500)',
              fontWeight: isUrgent ? 600 : 400,
            }}>
              <Truck size={13} style={{ color: isUrgent ? '#D97706' : 'var(--gray-400)' }} />
              {deliveryDate ? (
                <span>
                  {isUrgent ? '⚠ ' : ''}Delivery: {deliveryDayName}, {deliveryDateStr}
                  {extraDeliveryDates > 0 ? ` (+${extraDeliveryDates} more date${extraDeliveryDates > 1 ? 's' : ''})` : ''}
                </span>
              ) : (
                <span>No delivery info found for this work day yet.</span>
              )}
            </div>
          )}
        </div>

        {plan && (
          <button
            onClick={() => loadPlan(selectedDate)}
            className="btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        )}
      </div>

      {/* Delivery urgency banner (shown after plan loads) */}
      {plan && selectedDate && deliveryDate && (
        <div style={S.deliveryBanner(isUrgent)}>
          <Truck size={16} style={{ color: isUrgent ? '#D97706' : '#3B82F6', flexShrink: 0 }} />
          <div style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: isUrgent ? '#92400E' : '#1E40AF' }}>
              {isUrgent ? 'Urgent — ' : ''}Delivery deadline:
            </span>{' '}
            <span style={{ color: isUrgent ? '#92400E' : '#1D4ED8' }}>
              {deliveryDayName}, {deliveryDateStr}{extraDeliveryDates > 0 ? ` (+${extraDeliveryDates} more)` : ''}
            </span>
            <span style={{ color: 'var(--gray-500)', marginLeft: 8, fontSize: 12 }}>
              Complete all assignments before end of work day on {dayjs(selectedDate).format('MMM D')}.
            </span>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={S.loadingBox}>
          <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto', display: 'block' }} />
          <p style={{ marginTop: 10, fontSize: 13, color: 'var(--gray-400)', margin: '10px 0 0' }}>Loading plan…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && planItems.length === 0 && selectedDate && (
        <div style={{ ...S.loadingBox, color: 'var(--gray-500)' }}>
          <Users size={28} style={{ margin: '0 auto 10px', display: 'block', color: 'var(--gray-300)' }} />
          <p style={{ margin: 0, fontSize: 13 }}>No products found for this date.</p>
        </div>
      )}

      {/* Plan items */}
      <div>
        {planItems.map(item => {
          const product = item.products;
          if (!product) return null;

          const total       = item.total_batches;
          const isSaving    = saving === item.id;
          const isSaved     = saved[item.id];
          const valid       = itemFullyValid(item.id, total);
          const hasAny      = itemHasAnyAssignment(item.id);
          const saveDisabled = isSaving || !valid || !hasAny;

          return (
            <div key={item.id} style={S.itemCard}>

              {/* Product header */}
              <div style={S.itemHeader}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={S.productName}>{product.name}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={S.metaPill}>{total} {total === 1 ? 'batch' : 'batches'}</span>
                    <span style={S.metaPill}>{total * product.base_yield_qty} {product.yield_unit}</span>
                    {product.oven_temp_c  && <span style={S.metaPill}>{product.oven_temp_c}°C</span>}
                    {product.bake_time_min && <span style={S.metaPill}>{product.bake_time_min} min</span>}
                  </div>
                </div>
                <button
                  onClick={() => save(item.id, total)}
                  disabled={saveDisabled}
                  style={S.saveBtn(isSaved, saveDisabled, isSaving)}
                >
                  {isSaving
                    ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                    : isSaved
                    ? <><CheckCircle2 size={13} /> Saved</>
                    : 'Save Assignments'}
                </button>
              </div>

              {/* Role grid — 2 columns */}
              <div style={S.roleGrid}>
                {STAGES.map(role => {
                  const rows          = assignments[item.id]?.[role] ?? [];
                  // Pass the first assigned user's id so getEligible can include
                  // a non-specialist baker who was auto-assigned by the backend.
                  const firstUserId   = rows[0]?.user_id;
                  const eligible      = getEligible(role, product.id, firstUserId);
                  const sum           = roleSum(item.id, role);
                  const ok            = roleValid(item.id, role, total);
                  const completedTask = (item.tasks ?? []).find(t => t.task_role === role && t.status === 'completed');

                  return (
                    <div key={role} style={S.roleCard(ok, rows.length > 0)}>

                      {/* Role header */}
                      <div style={S.roleHeader}>
                        <span style={S.roleLabel}>{ROLE_LABELS[role]}</span>
                        {rows.length > 0 && (
                          <span style={S.batchBadge(ok)}>{sum} / {total}</span>
                        )}
                      </div>

                      {/* Completed chip */}
                      {completedTask && (
                        <div style={S.completedChip}>
                          <CheckCircle2 size={12} />
                          {completedTask.assigned_user?.full_name} — {completedTask.batches_assigned} {completedTask.batches_assigned === 1 ? 'batch' : 'batches'} done
                        </div>
                      )}

                      {/* Empty state */}
                      {rows.length === 0 ? (
                        <button onClick={() => ensureRow(item.id, role, total)} style={S.emptyAssignBtn}>
                          <Plus size={13} /> Assign worker
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {rows.map((row, idx) => {
                            // For each row, ensure its current user_id is always in the list
                            // (catches non-specialist bakers auto-assigned by backend).
                            const rowEligible = getEligible(role, product.id, row.user_id);
                            return (
                              <div key={idx} style={S.workerRow}>
                                {/* Worker dropdown */}
                                <div style={S.selectWrap}>
                                  <select
                                    style={S.workerSelect}
                                    value={row.user_id}
                                    onChange={e => updateRow(item.id, role, idx, 'user_id', e.target.value)}
                                  >
                                    <option value="">Select worker…</option>
                                    {rowEligible.length === 0
                                      ? <option disabled>No workers available</option>
                                      : rowEligible.map(w => {
                                          const wl     = loadFor(w.id);
                                          const suffix = wl?.is_overloaded
                                            ? ' (overloaded)'
                                            : (!wl || wl.batches_assigned === 0)
                                            ? ' (free)'
                                            : '';
                                          return <option key={w.id} value={w.id}>{w.full_name}{suffix}</option>;
                                        })}
                                  </select>
                                  <ChevronDown size={13} style={S.chevron} />
                                </div>

                                {/* Batch count — min 1 to prevent zero-batch rows */}
                                <input
                                  type="number"
                                  min={1}
                                  max={total}
                                  style={S.batchInput}
                                  value={row.batches}
                                  onChange={e => updateRow(item.id, role, idx, 'batches', Number(e.target.value))}
                                />

                                {/* Remove */}
                                <button onClick={() => removeRow(item.id, role, idx)} style={S.removeBtn} title="Remove">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            );
                          })}

                          {/* Add another worker */}
                          <button onClick={() => addRow(item.id, role)} style={S.addWorkerBtn}>
                            <Plus size={12} /> Add worker
                          </button>

                          {/* Validation error */}
                          {!ok && rows.length > 0 && (
                            <p style={S.errorRow}>
                              <AlertTriangle size={11} />
                              {sum > total
                                ? `Over by ${sum - total} ${sum - total === 1 ? 'batch' : 'batches'}`
                                : sum < total
                                ? `Short by ${total - sum} ${total - sum === 1 ? 'batch' : 'batches'}`
                                : 'Select a worker for every row'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Save error banner — shown below the role grid */}
              {saveError[item.id] && (
                <div style={{
                  margin: '0 20px 16px',
                  padding: '10px 14px',
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#B91C1C',
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  {saveError[item.id]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}