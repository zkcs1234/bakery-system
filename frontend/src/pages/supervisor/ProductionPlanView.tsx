import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, Truck, Info } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { ProductionPlan, IngredientEngineResult, Order } from '../../types';

// NOTE: this assumes `Order` has `work_day: string | null`, and that the
// backend matches approved orders onto a plan by `work_day === production_date`
// (manually assigned per order), not the old delivery_date - 1 rule.

export default function ProductionPlanView() {
  const { date } = useParams<{ date: string }>();
  const [plan, setPlan]     = useState<ProductionPlan | null>(null);
  const [report, setReport] = useState<IngredientEngineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [relatedOrders, setRelatedOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'products' | 'tasks'>('products');
  const [generating, setGenerating] = useState(false);

  // Work day comes straight from the URL param now — it's whatever the
  // supervisor manually assigned per order, no longer derived from delivery date.
  const workDay = date ?? dayjs().format('YYYY-MM-DD');

  const approvedRelated = useMemo(() => relatedOrders.filter(o => o.status === 'approved'), [relatedOrders]);
  const pendingRelated  = useMemo(() => relatedOrders.filter(o => o.status === 'pending'), [relatedOrders]);
  const rejectedRelated = useMemo(() => relatedOrders.filter(o => o.status === 'rejected'), [relatedOrders]);

  // A plan can now combine branches with different actual delivery dates
  // (they just happen to share a work day), so group rather than assume one date.
  const deliveryGroups = useMemo(() => {
    const map: Record<string, number> = {};
    approvedRelated.forEach(o => { map[o.delivery_date] = (map[o.delivery_date] ?? 0) + 1; });
    return Object.entries(map)
      .map(([deliveryDate, count]) => ({ deliveryDate, count }))
      .sort((a, b) => dayjs(a.deliveryDate).diff(dayjs(b.deliveryDate)));
  }, [approvedRelated]);

  const soonestDelivery   = deliveryGroups[0]?.deliveryDate;
  const daysUntilSoonest  = soonestDelivery ? dayjs(soonestDelivery).diff(dayjs().startOf('day'), 'day') : null;
  const isUrgent  = daysUntilSoonest !== null && daysUntilSoonest <= 1;
  const isOverdue = daysUntilSoonest !== null && daysUntilSoonest < 0;

  const fetchPlan = () => {
    if (!date) return;
    setLoading(true);
    setError('');
    api.get(`/production/plans/${date}`)
      .then((r) => {
        setPlan(r.data.plan);
        setReport(r.data.ingredient_report);
      })
      .catch((e: unknown) => {
        const raw = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setError(raw ?? 'No plan for this date');
      })
      .finally(() => setLoading(false));
  };
  useEffect(fetchPlan, [date]);

  // Independently fetch which orders are actually scheduled onto this work day,
  // so delivery info here is accurate whether or not a plan has been generated yet.
  useEffect(() => {
    if (!workDay) return;
    api.get(`/orders?work_day=${encodeURIComponent(workDay)}`)
      .then(r => {
        const orders: Order[] = r.data.orders ?? [];
        setRelatedOrders(orders);
      })
      .catch(() => {});
  }, [workDay]);

  const generatePlan = async () => {
    if (!workDay) return;
    setGenerating(true); setError('');
    try {
      const response = await api.post('/production/generate', { production_date: workDay });
      const generatedPlan: ProductionPlan = {
        ...response.data.plan,
        production_plan_items: response.data.plan_items,
      };
      setPlan(generatedPlan);
      setReport(response.data.ingredient_report);
      setError('');
      fetchPlan();
    } catch (e: unknown) {
      const response = (e as { response?: { data?: { error?: string; plan?: any; plan_items?: any; ingredient_report?: any } } })?.response?.data;
      const raw = response?.error;

      if (response?.plan) {
        const generatedPlan: ProductionPlan = {
          ...response.plan,
          production_plan_items: response.plan_items ?? [],
        };
        setPlan(generatedPlan);
        setReport(response.ingredient_report ?? null);
        setError(raw ?? 'Ingredient shortage detected. Contact supplier before proceeding.');
      } else {
        setError(
          raw?.startsWith('No approved orders found for work day')
            ? 'Cannot generate plan: no orders are scheduled for this work day yet.'
            : raw ?? 'Failed to generate plan'
        );
      }
    } finally { setGenerating(false); }
  };

  const planItems = plan?.production_plan_items ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/supervisor" className="p-2 rounded-lg text-gray-400 hover:bg-wheat-100 hover:text-gray-600">
          <ChevronLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-display font-bold text-gray-800">
            Production Plan — {dayjs(workDay).format('MMMM D, YYYY')}
          </h1>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <p className="text-xs text-gray-400">Work day: {dayjs(workDay).format('MMM D')}</p>
            {deliveryGroups.map(g => {
              const days = dayjs(g.deliveryDate).diff(dayjs().startOf('day'), 'day');
              const overdue = days < 0;
              const urgent = !overdue && days <= 1;
              return (
                <span
                  key={g.deliveryDate}
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    overdue ? 'bg-red-100 text-red-700' : urgent ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  <Truck size={11} />
                  {dayjs(g.deliveryDate).format('ddd, MMM D')} · {g.count} {g.count === 1 ? 'order' : 'orders'}
                </span>
              );
            })}
          </div>
          {plan && (
            <p className="text-xs text-gray-400 mt-0.5">
              Generated {dayjs(plan.generated_at).format('MMM D [at] h:mm A')}
            </p>
          )}
        </div>
        <button onClick={generatePlan} disabled={generating} className="btn-secondary btn-sm">
          {generating ? <><Loader2 size={13} className="animate-spin" /> Re-generating…</> : '↺ Re-generate for this work day'}
        </button>
        <Link to={`/supervisor/assign?date=${date}`} className="btn-primary btn-sm">Assign Tasks</Link>
      </div>

      {/* Delivery callout — driven by the orders actually scheduled here, not a +1 day assumption */}
      {deliveryGroups.length > 0 && (
        <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${
          isOverdue ? 'bg-red-50 border border-red-200' : isUrgent ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-100'
        }`}>
          <Truck size={16} className={isOverdue ? 'text-red-500' : isUrgent ? 'text-amber-500' : 'text-blue-400'} />
          <div className="flex-1 text-sm">
            <span className={`font-semibold ${isOverdue ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-blue-700'}`}>
              {isOverdue ? 'Overdue — ' : isUrgent ? 'Urgent — ' : ''}
              {deliveryGroups.length === 1
                ? dayjs(deliveryGroups[0].deliveryDate).format('dddd, MMMM D, YYYY')
                : `${deliveryGroups.length} delivery dates`}
            </span>
            <span className="text-gray-500 ml-2 text-xs">
              All production for this plan must be ready by end of {dayjs(workDay).format('MMM D')}.
            </span>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-gray-500">{approvedRelated.length} approved</span>
            {pendingRelated.length > 0 && (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertTriangle size={11} /> {pendingRelated.length} pending
              </span>
            )}
          </div>
        </div>
      )}

      {/* No orders scheduled on this work day at all */}
      {!loading && relatedOrders.length === 0 && (
        <div className="rounded-lg px-4 py-3 bg-gray-50 border border-gray-200 flex items-start gap-2 text-sm text-gray-500">
          <Info size={15} className="mt-0.5 flex-shrink-0 text-gray-400" />
          <span>No orders are currently scheduled for this work day.</span>
        </div>
      )}

      {/* Orders scheduled but none approved yet */}
      {relatedOrders.length > 0 && approvedRelated.length === 0 && (
        <div className="rounded-lg px-4 py-3 bg-orange-50 border border-orange-200 flex items-start gap-2 text-sm text-orange-700">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-orange-500" />
          <span>
            Orders are scheduled for this work day but <strong>none are approved</strong> yet.
            Approve them before dispatching tasks to workers.
          </span>
        </div>
      )}

      {/* Error / empty */}
      {error && !plan && (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-4">{error}</p>
          {relatedOrders.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-4 text-left text-sm text-gray-600">
              <div className="rounded-lg border border-wheat-200 bg-wheat-50 p-3">
                <p className="text-xs uppercase text-gray-500">Pending</p>
                <p className="text-lg font-semibold">{pendingRelated.length}</p>
              </div>
              <div className="rounded-lg border border-wheat-200 bg-wheat-50 p-3">
                <p className="text-xs uppercase text-gray-500">Approved</p>
                <p className="text-lg font-semibold">{approvedRelated.length}</p>
              </div>
              <div className="rounded-lg border border-wheat-200 bg-wheat-50 p-3">
                <p className="text-xs uppercase text-gray-500">Rejected</p>
                <p className="text-lg font-semibold">{rejectedRelated.length}</p>
              </div>
            </div>
          )}
          {approvedRelated.length > 0 ? (
            <button onClick={generatePlan} disabled={generating} className="btn-primary">
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : 'Generate Plan for This Work Day'}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
                <Info size={13} />
                Assign approved orders to this work day before generating a plan.
              </div>
              <Link to="/supervisor" className="btn-secondary btn-sm mt-1">Back to Dashboard</Link>
            </div>
          )}
        </div>
      )}

      {loading && !plan && (
        <div className="card text-center py-12 text-gray-400">Loading plan…</div>
      )}

      {/* Ingredient shortage alert (when plan loads but has shortages) */}
      {plan && error && (
        <div className="rounded-lg px-4 py-3 bg-red-50 border border-red-200 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {plan && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Products',       value: planItems.length },
              { label: 'Total Batches',  value: report ? report.total_batches : planItems.reduce((acc, it) => acc + (it.total_batches ?? 0), 0) },
              { label: 'Material Lines', value: report ? report.pull_list.length : 0 },
            ].map(s => (
              <div key={s.label} className="card text-center py-3">
                <p className="text-xl font-bold text-gray-800">{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-wheat-200">
            {(['products', 'tasks'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                  activeTab === tab ? 'border-crust-600 text-crust-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                {tab}
              </button>
            ))}
          </div>

          {/* Products tab */}
          {activeTab === 'products' && (
            <div className="space-y-2">
              <div className="card overflow-hidden">
                <table className="table">
                  <thead>
                    <tr><th>Product</th><th>Batches</th><th>Total Units</th><th>Oven</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {planItems.map(item => {
                      const p = item.products as {
                        name: string; base_yield_qty: number; yield_unit: string;
                        oven_temp_c: number | null; bake_time_min: number | null
                      } | null;
                      return (
                        <tr key={item.id}>
                          <td className="font-medium">{p?.name}</td>
                          <td className="font-mono">{item.total_batches}</td>
                          <td className="font-mono">{(item.total_batches * (p?.base_yield_qty ?? 1))} {p?.yield_unit}</td>
                          <td>{p?.oven_temp_c ? `${p.oven_temp_c}°C` : '—'}</td>
                          <td>{p?.bake_time_min ? `${p.bake_time_min} min` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="card text-center py-8 text-gray-500">
              <p className="mb-1">Assign tasks to workers from the Task Assignment page.</p>
              {deliveryGroups.length > 0 && (
                <p className="text-xs text-gray-400 mb-3">
                  Delivery is <strong className={isUrgent ? 'text-amber-600' : 'text-gray-600'}>
                    {deliveryGroups.length === 1 ? dayjs(deliveryGroups[0].deliveryDate).format('dddd, MMMM D, YYYY') : `spread across ${deliveryGroups.length} dates`}
                  </strong> — complete assignments before end of work day.
                </p>
              )}
              <Link to={`/supervisor/assign?date=${date}`} className="btn-primary">Go to Task Assignment</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}