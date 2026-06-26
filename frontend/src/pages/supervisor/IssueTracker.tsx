import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, PackagePlus, XCircle, AlertOctagon, HelpCircle, CheckCircle2, Eye } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

interface Issue {
  id: string;
  issue_type: 'excess_ingredient'|'shortage_mistake'|'cancellation'|'quality_issue'|'other';
  description: string;
  excess_batches: number | null;
  affected_batches: number | null;
  status: 'open'|'acknowledged'|'resolved';
  resolution: string | null;
  created_at: string;
  reported_by_user?: { id: string; full_name: string; role: string };
  resolved_by_user?: { id: string; full_name: string };
  production_plan_items?: {
    id: string; total_batches: number;
    products?: { id: string; name: string; dough_type: string; yield_unit: string };
    production_plans?: { production_date: string };
    tasks?: { id: string; task_role: string; batches_assigned: number; assigned_user?: { full_name: string } }[];
  };
  orders?: { id: string; branches?: { name: string } };
}

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  excess_ingredient: { label: 'Excess / Overproduction', icon: <PackagePlus size={13} />, color: '#B45309', bg: '#FFFBEB' },
  shortage_mistake:  { label: 'Shortage / Mistake',      icon: <AlertOctagon size={13} />, color: '#C0392B', bg: '#FEF0F0' },
  cancellation:      { label: 'Order Cancellation',      icon: <XCircle size={13} />,      color: '#7A8299', bg: '#F5F7FA' },
  quality_issue:     { label: 'Quality Issue',           icon: <AlertTriangle size={13} />,color: '#C2410C', bg: '#FFF7ED' },
  other:             { label: 'Other',                   icon: <HelpCircle size={13} />,   color: '#185FA5', bg: '#EEF6FD' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  open:         { label: 'Open',         color: '#C0392B', bg: '#FEF0F0' },
  acknowledged: { label: 'Acknowledged', color: '#B45309', bg: '#FFFBEB' },
  resolved:     { label: 'Resolved',     color: '#1A7A4A', bg: '#EAF8F2' },
};

export default function IssueTracker() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open'|'all'>('open');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolveDraft, setResolveDraft] = useState<Record<string, string>>({});
  const [redistribute, setRedistribute] = useState<Record<string, { task_id: string; batches: string }>>({});
  const [acting, setActing] = useState<string | null>(null);

  const fetch = () => {
    setLoading(true);
    const url = filter === 'open' ? '/issues' : '/issues';
    api.get(url).then(r => {
      let data: Issue[] = r.data.issues ?? [];
      if (filter === 'open') data = data.filter(i => i.status !== 'resolved');
      setIssues(data);
    }).finally(() => setLoading(false));
  };
  useEffect(fetch, [filter]);

  const acknowledge = async (id: string) => {
    setActing(id);
    await api.patch(`/issues/${id}/acknowledge`);
    fetch();
    setActing(null);
  };

  const resolve = async (issue: Issue) => {
    const resolution = resolveDraft[issue.id];
    if (!resolution?.trim()) return;
    setActing(issue.id);
    const redist = redistribute[issue.id];
    try {
      await api.patch(`/issues/${issue.id}/resolve`, {
        resolution,
        adjust_repack_task_id: redist?.task_id || undefined,
        adjust_batches: redist?.batches ? Number(redist.batches) : undefined,
      });
      fetch();
    } finally { setActing(null); }
  };

  const openCount = issues.filter(i => i.status === 'open').length;
  const ackCount  = issues.filter(i => i.status === 'acknowledged').length;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Issue Tracker</h1>
        <p className="page-subtitle">Production mistakes, excess stock, and order cancellations</p>
      </div>

      {/* Summary + filter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        {openCount > 0 && <span className="badge-red">{openCount} open</span>}
        {ackCount > 0 && <span className="badge-amber">{ackCount} acknowledged</span>}
        <div style={{ flex: 1 }} />
        {(['open','all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${filter === f ? 'var(--blue-800)' : 'var(--gray-300)'}`,
              background: filter === f ? 'var(--blue-800)' : '#fff',
              color: filter === f ? '#fff' : 'var(--gray-600)',
            }}>
            {f === 'open' ? 'Open & Acknowledged' : 'All Issues'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
          <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto' }} />
        </div>
      ) : issues.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
          <CheckCircle2 size={28} style={{ margin: '0 auto 8px', color: 'var(--green-600)', opacity: 0.5 }} />
          <p>No {filter === 'open' ? 'open' : ''} issues. Everything's running smoothly.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {issues.map(issue => {
            const tMeta = TYPE_META[issue.issue_type];
            const sMeta = STATUS_META[issue.status];
            const isExp = expanded === issue.id;
            const product = issue.production_plan_items?.products;
            const repackTasks = issue.production_plan_items?.tasks?.filter(t => t.task_role === 'repacking') ?? [];

            return (
              <div key={issue.id} className="card-md" style={{ borderLeft: `3px solid ${tMeta.color}` }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: tMeta.bg, color: tMeta.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{tMeta.icon}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>{tMeta.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: sMeta.color, background: sMeta.bg, borderRadius: 4, padding: '1px 6px' }}>
                        {sMeta.label}
                      </span>
                      {product && (
                        <span className="badge-blue" style={{ fontSize: 10 }}>{product.name}</span>
                      )}
                      {issue.orders?.branches?.name && (
                        <span className="badge-gray" style={{ fontSize: 10 }}>{issue.orders.branches.name}</span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--gray-700)', margin: '4px 0 0' }}>{issue.description}</p>
                    <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: '4px 0 0' }}>
                      Reported by {issue.reported_by_user?.full_name} ({issue.reported_by_user?.role}) · {dayjs(issue.created_at).fromNow()}
                      {issue.excess_batches != null && <> · <strong style={{ color: tMeta.color }}>{issue.excess_batches} excess batch{issue.excess_batches !== 1 ? 'es' : ''}</strong></>}
                      {issue.affected_batches != null && <> · <strong style={{ color: tMeta.color }}>{issue.affected_batches} affected batch{issue.affected_batches !== 1 ? 'es' : ''}</strong></>}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {issue.status === 'open' && (
                      <button onClick={() => acknowledge(issue.id)} disabled={acting === issue.id}
                        className="btn-secondary btn-sm">Acknowledge</button>
                    )}
                    {issue.status !== 'resolved' && (
                      <button onClick={() => setExpanded(isExp ? null : issue.id)} className="btn-ghost btn-sm">
                        <Eye size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Resolution shown if resolved */}
                {issue.status === 'resolved' && issue.resolution && (
                  <div className="success-alert" style={{ marginTop: 10, fontSize: 12 }}>
                    <strong>Resolution:</strong> {issue.resolution}
                    {issue.resolved_by_user && <span style={{ color: 'var(--gray-400)' }}> — {issue.resolved_by_user.full_name}</span>}
                  </div>
                )}

                {/* Expanded resolve panel */}
                {isExp && issue.status !== 'resolved' && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--gray-200)' }}>
                    {/* Repack redistribution helper */}
                    {issue.issue_type === 'cancellation' && repackTasks.length > 0 && (
                      <div style={{ marginBottom: 10, background: 'var(--blue-50)', border: '1px solid var(--blue-200)', borderRadius: 6, padding: 10 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue-800)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Redistribute Repacking
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--gray-600)', marginBottom: 8 }}>
                          An order was cancelled. Adjust the repacker's batch count to redistribute the extra stock across remaining branches.
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <select className="input" style={{ fontSize: 12 }}
                            value={redistribute[issue.id]?.task_id ?? ''}
                            onChange={e => setRedistribute(prev => ({ ...prev, [issue.id]: { task_id: e.target.value, batches: prev[issue.id]?.batches ?? '' } }))}>
                            <option value="">— Select repacker task —</option>
                            {repackTasks.map(t => (
                              <option key={t.id} value={t.id}>
                                {t.assigned_user?.full_name ?? 'Unassigned'} — currently {t.batches_assigned} batches
                              </option>
                            ))}
                          </select>
                          <input className="input" style={{ fontSize: 12, width: 100 }} type="number" min={0} placeholder="New batches"
                            value={redistribute[issue.id]?.batches ?? ''}
                            onChange={e => setRedistribute(prev => ({ ...prev, [issue.id]: { task_id: prev[issue.id]?.task_id ?? '', batches: e.target.value } }))} />
                        </div>
                      </div>
                    )}

                    <label className="label">Resolution / Instructions</label>
                    <textarea className="input" rows={2} style={{ resize: 'vertical', marginBottom: 8 }}
                      placeholder="e.g. Split the extra 1.5 batches of Pan de Sal: 1 to Branch North, 0.5 to Branch East"
                      value={resolveDraft[issue.id] ?? ''}
                      onChange={e => setResolveDraft(prev => ({ ...prev, [issue.id]: e.target.value }))} />

                    <button onClick={() => resolve(issue)} disabled={!resolveDraft[issue.id]?.trim() || acting === issue.id}
                      className="btn-primary btn-sm">
                      {acting === issue.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Mark Resolved
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
