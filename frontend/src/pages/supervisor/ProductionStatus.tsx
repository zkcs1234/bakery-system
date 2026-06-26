import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, Scale, Blend, FlameKindling, PackageCheck, Clock, CheckCircle2, Circle } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { ProductionPlan } from '../../types';
import { DOUGH_TYPE_LABELS } from '../../types';

interface StageEntry {
  task_id: string;
  status: 'pending' | 'in_progress' | 'completed';
  batches_assigned: number;
  worker_name: string | null;
  is_priority: boolean;
  started_at: string | null;
  completed_at: string | null;
}

interface PipelineItem {
  plan_item_id: string;
  product_name: string;
  dough_type: string;
  total_batches: number;
  stages: Record<'scaling'|'mixing'|'baking'|'repacking', StageEntry[]>;
}

const STAGE_ORDER: ('scaling'|'mixing'|'baking'|'repacking')[] = ['scaling','mixing','baking','repacking'];
const STAGE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  scaling:   { label: 'Scaling',   icon: <Scale size={13} /> },
  mixing:    { label: 'Mixing',    icon: <Blend size={13} /> },
  baking:    { label: 'Baking',    icon: <FlameKindling size={13} /> },
  repacking: { label: 'Repacking', icon: <PackageCheck size={13} /> },
};

function StagePill({ entry }: { entry: StageEntry }) {
  const color = entry.status === 'completed' ? '#1A7A4A'
    : entry.status === 'in_progress' ? '#B45309' : '#9DA4B8';
  const bg = entry.status === 'completed' ? '#EAF8F2'
    : entry.status === 'in_progress' ? '#FFFBEB' : '#F5F7FA';
  const Icon = entry.status === 'completed' ? CheckCircle2 : entry.status === 'in_progress' ? Clock : Circle;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: bg, border: `1px solid ${color}33`, borderRadius: 6,
      padding: '4px 8px', fontSize: 11,
    }}>
      <Icon size={11} style={{ color, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: 'var(--gray-800)' }}>{entry.worker_name ?? '—'}</span>
      <span style={{ color: 'var(--gray-400)' }}>· {entry.batches_assigned}b</span>
      {entry.is_priority && <span style={{ color: '#C2410C', fontWeight: 700 }}>★</span>}
    </div>
  );
}

export default function ProductionStatus() {
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [pipeline, setPipeline] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    api.get('/production/plans').then(r => setPlans(r.data.plans ?? []));
  }, []);

  const load = useCallback((date: string) => {
    if (!date) return;
    setLoading(true);
    api.get(`/production/pipeline/${date}`)
      .then(r => setPipeline(r.data.pipeline ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedDate) {
      load(selectedDate);
    }
  }, [selectedDate, load]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!autoRefresh || !selectedDate) return;
    const interval = setInterval(() => load(selectedDate), 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedDate, load]);

  // Overall progress per product
  const productProgress = (item: PipelineItem) => {
    const allStages = STAGE_ORDER.flatMap(s => item.stages[s]);
    if (!allStages.length) return 0;
    const completed = allStages.filter(s => s.status === 'completed').length;
    return Math.round((completed / allStages.length) * 100);
  };


  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Production Status</h1>
        <p className="page-subtitle">Live pipeline — what every worker is doing, per product</p>
      </div>

      {/* Date selectors */}
      <div className="card-md" style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ flex: 1, maxWidth: 280 }}>
          <label className="label">Work Day</label>
          <select className="input" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}>
            <option value="">— Select a date —</option>
            {plans.map(p => (
              <option key={p.id} value={p.production_date}>{dayjs(p.production_date).format('MMMM D, YYYY')}</option>
            ))}
          </select>
        </div>

        {selectedDate && (
          <>
            <button onClick={() => load(selectedDate)} className="btn-secondary btn-sm"><RefreshCw size={13} /> Refresh</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gray-600)', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: 'var(--blue-700)' }} />
              Auto-refresh (15s)
            </label>
          </>
        )}
      </div>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
          <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto' }} />
        </div>
      )}

      {!loading && selectedDate && pipeline.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
          No production plan items for this date yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pipeline.map(item => {
          const progress = productProgress(item);
          return (
            <div key={item.plan_item_id} className="card-md">
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-900)' }}>{item.product_name}</span>
                    <span className="badge-blue" style={{ fontSize: 10 }}>
                      {DOUGH_TYPE_LABELS[item.dough_type as keyof typeof DOUGH_TYPE_LABELS] ?? item.dough_type}
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: '2px 0 0' }}>{item.total_batches} total batches</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 16, fontWeight: 700, color: progress === 100 ? 'var(--green-600)' : 'var(--blue-800)', margin: 0 }}>{progress}%</p>
                  <p style={{ fontSize: 10, color: 'var(--gray-400)', margin: 0 }}>complete</p>
                </div>
              </div>

              {/* Overall progress bar */}
              <div className="progress-bar" style={{ marginBottom: 12 }}>
                <div className="progress-fill" style={{ width: `${progress}%`, background: progress === 100 ? 'var(--green-600)' : 'var(--blue-700)' }} />
              </div>

              {/* Stage columns */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {STAGE_ORDER.map((stage, i) => {
                  const entries = item.stages[stage];
                  return (
                    <div key={stage}>
                      <p style={{
                        fontSize: 10, fontWeight: 700, color: 'var(--gray-500)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <span style={{ color: 'var(--blue-700)' }}>{STAGE_META[stage].icon}</span>
                        {STAGE_META[stage].label}
                        {i < 3 && <span style={{ marginLeft: 'auto', color: 'var(--gray-300)' }}>→</span>}
                      </p>
                      {entries.length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--gray-300)', fontStyle: 'italic', padding: '4px 8px' }}>Not assigned</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {entries.map(e => <StagePill key={e.task_id} entry={e} />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}