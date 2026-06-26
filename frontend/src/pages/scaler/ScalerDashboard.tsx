import { useEffect, useState, useCallback } from 'react';
import {
  Scale, Loader2, CheckCircle2, PlayCircle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  AlertTriangle, X,
} from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { Ingredient, Task } from '../../types';

dayjs.extend(isoWeek);

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface IngredientReport {
  pull_list: any[];
  shortage_list: Array<{
    ingredient_id: string;
    ingredient_name: string;
    unit: string;
    required_g: number;
    available_g: number;
    shortage_g: number;
    is_sufficient: boolean;
    is_optional: boolean;
  }>;
  has_shortages: boolean;
  total_products: number;
  total_batches: number;
}

interface VarianceEntry {
  ingredient_id: string;
  ingredient_name: string;
  type: 'over' | 'short';
  amount_g: number;
  note: string;
}

interface RebalanceRow {
  ingredient_id: string;
  name: string;
  planned_g: number | null;
  adjusted_g: number | null;
}

interface RebalanceProposal {
  triggerIngredientId: string;
  triggerIngredientName: string;
  deviationPct: number;
  isShort: boolean;
  effectiveBatches: number;
  rows: RebalanceRow[];
}

type WeekTasks = Record<string, Task[]>;

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
const TRINIDAD_BRANCH = 'trinidad';

function getWeekDates(anchor: dayjs.Dayjs): dayjs.Dayjs[] {
  const monday = anchor.isoWeekday(1);
  return Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
}

function getBranchName(task: Task): string {
  const ppi = task.production_plan_items as any;
  return (
    ppi?.production_plans?.branches?.name ??
    ppi?.production_plans?.branch_name ??
    ppi?.branch_name ??
    ''
  ).toLowerCase();
}

function isTrinidad(task: Task): boolean {
  return getBranchName(task).includes(TRINIDAD_BRANCH);
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const rankA = isTrinidad(a) ? (a.is_priority ? 0 : 1) : (a.is_priority ? 2 : 3);
    const rankB = isTrinidad(b) ? (b.is_priority ? 0 : 1) : (b.is_priority ? 2 : 3);
    return rankA - rankB;
  });
}

const DEFAULT_TOLERANCE_PCT = 8;
const CRITICAL_TOLERANCE_PCT = 3;
const CRITICAL_INGREDIENT_KEYWORDS = ['butter', 'salt', 'yeast', 'sugar', 'shortening', 'margarine', 'oil'];

function getTolerancePct(ing: any): number {
  if (typeof ing?.tolerance_pct === 'number') return ing.tolerance_pct;
  const name = (ing?.ingredients?.name ?? '').toLowerCase();
  return CRITICAL_INGREDIENT_KEYWORDS.some(k => name.includes(k))
    ? CRITICAL_TOLERANCE_PCT
    : DEFAULT_TOLERANCE_PCT;
}

function formatGrams(g: number | null): string {
  if (g == null || !isFinite(g)) return '—';
  return g >= 1000 ? `${(g / 1000).toFixed(3)} kg` : `${g.toFixed(1)} g`;
}

/* ─────────────────────────────────────────────
   Main component wrapper
───────────────────────────────────────────── */
export default function ScalerDashboard() {
  const today = dayjs().format('YYYY-MM-DD');
  const [anchor, setAnchor] = useState(() => dayjs());
  const weekDates = getWeekDates(anchor);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const [weekTasks, setWeekTasks] = useState<WeekTasks>({});
  const [weekLoading, setWeekLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(today);
  const [updating, setUpdating] = useState<string | null>(null);

  const [lowStock, setLowStock] = useState<
    (Ingredient & { shortage_g: number; computed_status?: string; reorder_threshold_g?: number })[]
  >([]);
  const [planShortages, setPlanShortages] = useState<IngredientReport | null>(null);
  const [stockError, setStockError] = useState('');
  const [alerting, setAlerting] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  const fetchWeek = useCallback(async (dates: dayjs.Dayjs[]) => {
    setWeekLoading(true);
    setLoadError('');
    try {
      const results = await Promise.all(
        dates.map(d =>
          api.get<{ tasks: Task[] }>(`/tasks/my?date=${d.format('YYYY-MM-DD')}`)
            .then(r => ({ date: d.format('YYYY-MM-DD'), tasks: r.data.tasks ?? [] }))
            .catch(() => ({ date: d.format('YYYY-MM-DD'), tasks: [] }))
        )
      );
      const map: WeekTasks = {};
      results.forEach(({ date, tasks }) => { map[date] = sortTasks(tasks); });
      setWeekTasks(map);
    } catch {
      setLoadError('Failed to load tasks for this week');
    } finally {
      setWeekLoading(false);
    }
  }, []);

  const fetchInventory = useCallback(() => {
    setStockError('');
    api.get('/reports/low-stock')
      .then(r => setLowStock(r.data.shortages ?? []))
      .catch((e: unknown) => {
        setStockError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load low stock information');
      });
    api.get(`/reports/plan-shortages/${today}`)
      .then(r => setPlanShortages(r.data.ingredient_report ?? null))
      .catch(() => setPlanShortages(null));
  }, [today]);

  useEffect(() => { fetchWeek(weekDates); }, [anchor]);
  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  const shiftWeek = (dir: 1 | -1) => {
    setAnchor(a => a.add(dir * 7, 'day'));
    setExpanded(null);
  };

  const goToday = () => {
    setAnchor(dayjs());
    setExpanded(today);
  };

  const updateStatus = async (taskId: string, date: string, status: 'in_progress' | 'completed') => {
    setUpdating(taskId);
    setLoadError('');
    try {
      await api.patch(`/tasks/${taskId}/status`, { status });
      const r = await api.get<{ tasks: Task[] }>(`/tasks/my?date=${date}`);
      setWeekTasks(prev => ({ ...prev, [date]: r.data.tasks ?? [] }));
    } catch (e: unknown) {
      setLoadError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update task status');
    } finally {
      setUpdating(null);
    }
  };

  const notifyAdmin = async () => {
    if (!lowStock.length) return;
    setAlertMessage('');
    setAlerting(true);
    setStockError('');
    try {
      await api.post('/reports/notify-shortage', {
        production_date: today,
        shortages: lowStock.map(item => ({
          ingredient_id: item.id,
          ingredient_name: item.name,
          shortage_g: item.shortage_g,
        })),
      });
      setAlertMessage('Admin has been notified about low stock.');
    } catch (e: unknown) {
      setStockError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to notify admin');
    } finally {
      setAlerting(false);
    }
  };

  const toggleExpanded = (date: string) => setExpanded(prev => (prev === date ? null : date));

  const todayTasks = weekTasks[today] ?? [];
  const doneCount = todayTasks.filter(t => t.status === 'completed').length;
  const totalCount = todayTasks.length;
  const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header - Design System */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="pageTitle text-blue-950 font-display">Scaling Tasks</h1>
          <p className="text-panelSubtitle text-slate-600 mt-1 font-body">
            {weekStart.format('MMM D')} – {weekEnd.format('MMM D, YYYY')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftWeek(-1)} className="btn-secondary btn-sm flex items-center gap-1">
            <ChevronLeft size={14} /> Prev
          </button>
          <button onClick={goToday} className="btn-secondary btn-sm">Today</button>
          <button onClick={() => shiftWeek(1)} className="btn-secondary btn-sm flex items-center gap-1">
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {loadError && <div className="alert alert-danger">{loadError}</div>}

      {/* KPI Row - Design System */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Total Tasks</span>
            <div className="kpi-icon-chip">
              <Scale size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{totalCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Completed</span>
            <div className="kpi-icon-chip">
              <CheckCircle2 size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{doneCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">In Progress</span>
            <div className="kpi-icon-chip">
              <PlayCircle size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{todayTasks.filter(t => t.status === 'in_progress').length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Progress</span>
            <div className="kpi-icon-chip">
              <Scale size={16} className="kpi-icon" />
            </div>
          </div>
          <div className="kpi-value">{progress}%</div>
          <div className="kpi-delta kpi-delta-flat mt-1">
            <span>—</span>
            <span>{doneCount}/{totalCount} done</span>
          </div>
        </div>
      </div>

      {/* Stock Alerts - Design System */}
      {planShortages && planShortages.shortage_list && planShortages.shortage_list.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Production Shortages</h2>
              <p className="panel-subtitle">Ingredients needed for today</p>
            </div>
            <button onClick={notifyAdmin} disabled={alerting} className="btn-secondary btn-sm">
              {alerting ? 'Notifying…' : 'Notify Admin'}
            </button>
          </div>
          <div className="p-4">
            <div className="space-y-2">
              {planShortages.shortage_list.map(item => (
                <div key={item.ingredient_id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-warningBg">
                  <AlertTriangle size={16} className="text-warning flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-ink font-body">{item.ingredient_name}</p>
                    <p className="text-xs text-slate-500 font-mono">Required {item.required_g}g · Available {item.available_g}g</p>
                  </div>
                  <span className="text-xs font-semibold text-warning font-mono">Short {item.shortage_g}g</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {alertMessage && <div className="alert alert-success">{alertMessage}</div>}
      {stockError && <div className="alert alert-danger">{stockError}</div>}

      {/* Week view - uses existing logic */}
      {weekLoading ? (
        <div className="space-y-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-12 bg-white rounded-lg animate-pulse border border-border" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {weekDates.map(day => {
            const dateStr = day.format('YYYY-MM-DD');
            const isToday = dateStr === today;
            const isPast = day.isBefore(dayjs(), 'day');
            const dayTasks = weekTasks[dateStr] ?? [];
            const isOpen = expanded === dateStr;
            const dayDone = dayTasks.filter(t => t.status === 'completed').length;
            const allDone = dayTasks.length > 0 && dayDone === dayTasks.length;

            if (isPast && dayTasks.length === 0) return null;

            return (
              <div key={dateStr} className={`panel overflow-hidden ${isToday ? 'ring-2 ring-blue-500' : ''}`}>
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-blue-50/30" onClick={() => toggleExpanded(dateStr)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink text-sm font-body">{day.format('dddd')}</p>
                      {isToday && <span className="status-pill status-pill-progress">TODAY</span>}
                    </div>
                    <p className="text-xs text-slate-500 font-mono">{day.format('MMMM D, YYYY')}</p>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {dayTasks.length === 0 ? <span className="text-slate-300">No tasks</span> : <span>{dayDone}/{dayTasks.length}</span>}
                  </div>
                  {isOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}