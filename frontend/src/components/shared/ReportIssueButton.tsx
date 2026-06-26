import { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import api from '../../lib/api';

interface Props {
  planItemId: string;
  taskId: string;
  productName: string;
}

const TYPES: { value: string; label: string }[] = [
  { value: 'excess_ingredient', label: 'Made too much / excess batches' },
  { value: 'shortage_mistake',  label: 'Mistake — wrong amount mixed/scaled' },
  { value: 'quality_issue',     label: 'Quality issue (burnt, underbaked, etc.)' },
  { value: 'cancellation',      label: 'Branch called to cancel' },
  { value: 'other',             label: 'Other' },
];

export default function ReportIssueButton({ planItemId, taskId, productName }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('excess_ingredient');
  const [desc, setDesc] = useState('');
  const [batches, setBatches] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!desc.trim()) return;
    setSending(true);
    try {
      await api.post('/issues', {
        issue_type: type,
        description: desc,
        plan_item_id: planItemId,
        task_id: taskId,
        excess_batches: type === 'excess_ingredient' ? Number(batches) || undefined : undefined,
        affected_batches: type === 'cancellation' ? Number(batches) || undefined : undefined,
      });
      setDone(true);
      setTimeout(() => { setOpen(false); setDone(false); setDesc(''); setBatches(''); }, 1200);
    } finally { setSending(false); }
  };

  return (
    <>
      <button onClick={e => { e.stopPropagation(); setOpen(true); }}
        style={{
          background: 'none', border: '1px solid var(--amber-100)', color: 'var(--amber-600)',
          borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
        <AlertTriangle size={11} /> Report Issue
      </button>

      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'fixed', inset: 0, background: 'rgba(10,22,40,0.45)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 18, width: '100%', maxWidth: 380 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--blue-900)', margin: 0 }}>Report Issue — {productName}</h3>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)' }}><X size={16} /></button>
            </div>

            {done ? (
              <div className="success-alert">Reported — supervisor will review.</div>
            ) : (
              <>
                <label className="label">Issue Type</label>
                <select className="input" style={{ marginBottom: 8 }} value={type} onChange={e => setType(e.target.value)}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>

                {(type === 'excess_ingredient' || type === 'cancellation') && (
                  <>
                    <label className="label">{type === 'excess_ingredient' ? 'Extra batches made' : 'Batches affected'}</label>
                    <input className="input" type="number" min={0} step={0.5} style={{ marginBottom: 8 }}
                      value={batches} onChange={e => setBatches(e.target.value)} />
                  </>
                )}

                <label className="label">Description</label>
                <textarea className="input" rows={3} style={{ resize: 'vertical', marginBottom: 10 }}
                  placeholder="Describe what happened…"
                  value={desc} onChange={e => setDesc(e.target.value)} />

                <button onClick={submit} disabled={!desc.trim() || sending}
                  className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  {sending ? <Loader2 size={13} className="animate-spin" /> : 'Submit Report'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
