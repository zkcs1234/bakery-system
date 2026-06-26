import { useEffect, useState } from 'react';
import { Loader2, Trash2, Star, GraduationCap, CheckCircle2, Save, ChevronDown } from 'lucide-react';
import api from '../../lib/api';
import type { User, Product } from '../../types';

interface Specialty {
  id: string;
  user_id: string;
  product_id: string;
  proficiency: 'expert' | 'standard' | 'learning';
  notes: string | null;
  products?: { id: string; name: string; dough_type: string };
}

const PROFICIENCY_META: Record<
  string,
  { label: string; activeStyle: React.CSSProperties; icon: React.ReactNode }
> = {
  expert: {
    label: 'Expert',
    activeStyle: { border: '1.5px solid #0F6E56', background: '#E1F5EE', color: '#085041' },
    icon: <Star size={12} />,
  },
  standard: {
    label: 'Standard',
    activeStyle: { border: '1.5px solid #185FA5', background: '#E6F1FB', color: '#0C447C' },
    icon: <CheckCircle2 size={12} />,
  },
  learning: {
    label: 'Learning',
    activeStyle: { border: '1.5px solid #BA7517', background: '#FAEEDA', color: '#633806' },
    icon: <GraduationCap size={12} />,
  },
};

const BADGE_STYLES: Record<string, React.CSSProperties> = {
  expert:   { background: '#E1F5EE', color: '#085041', border: '0.5px solid #5DCAA5' },
  standard: { background: '#E6F1FB', color: '#0C447C', border: '0.5px solid #85B7EB' },
  learning: { background: '#FAEEDA', color: '#633806', border: '0.5px solid #FAC775' },
};

export default function WorkerSpecialties() {
  const [workers, setWorkers]           = useState<User[]>([]);
  const [products, setProducts]         = useState<Product[]>([]);
  const [specialties, setSpecialties]   = useState<Specialty[]>([]);
  const [selectedWorker, setSelectedWorker]   = useState<string>('');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [proficiency, setProficiency]   = useState<'expert' | 'standard' | 'learning'>('standard');
  const [notes, setNotes]               = useState('');
  const [saving, setSaving]             = useState(false);
  const [loading, setLoading]           = useState(true);
  const [openWorkers, setOpenWorkers]   = useState<Set<string>>(new Set());

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      api.get('/users'),
      api.get('/products/summary'),
      api.get('/specialties'),
    ]).then(([u, p, s]) => {
      setWorkers(u.data.users.filter((w: User) => w.role === 'baker' && w.is_active));
      setProducts(p.data.products.filter((pr: Product) => pr.is_active));
      setSpecialties(s.data.specialties ?? []);
    }).finally(() => setLoading(false));
  };
  useEffect(fetchAll, []);

  const workerSpecialties = (userId: string) =>
    specialties.filter(s => s.user_id === userId);

  const toggleProduct = (id: string) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleWorkerOpen = (id: string) => {
    setOpenWorkers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!selectedWorker || selectedProducts.size === 0) return;
    setSaving(true);
    try {
      await api.post('/specialties', {
        user_id: selectedWorker,
        product_ids: Array.from(selectedProducts),
        proficiency,
        notes: notes || undefined,
      });
      setSelectedProducts(new Set());
      setNotes('');
      fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const removeSpecialty = async (id: string) => {
    await api.delete(`/specialties/${id}`);
    setSpecialties(prev => prev.filter(s => s.id !== id));
  };

  const updateProficiency = async (id: string, value: string) => {
    setSpecialties(prev =>
      prev.map(s => s.id === id ? { ...s, proficiency: value as Specialty['proficiency'] } : s)
    );
    await api.patch(`/specialties/${id}`, { proficiency: value });
  };

  const canSave = !!selectedWorker && selectedProducts.size > 0 && !saving;

  const saveLabel = saving
    ? 'Saving…'
    : !selectedWorker
      ? 'Select a baker first'
      : selectedProducts.size === 0
        ? 'Select at least one product'
        : `Save ${selectedProducts.size} product${selectedProducts.size > 1 ? 's' : ''} for this baker`;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>

      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Worker specialties</h1>
        <p className="page-subtitle" style={{ marginTop: 2 }}>
          Assign product specialties to active bakers
        </p>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--gray-400)' }}>
          <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto' }} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.45fr', gap: 14, alignItems: 'start' }}>

          {/* ── LEFT: assignment form ── */}
          <div className="card-md" style={{ padding: 18 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--gray-900)', marginBottom: 14, paddingBottom: 12, borderBottom: '0.5px solid var(--gray-200)' }}>
              Assign specialty
            </p>

            {/* Baker picker */}
            <div style={{ marginBottom: 14 }}>
              <label className="label">Baker</label>
              <select
                className="input"
                value={selectedWorker}
                onChange={e => setSelectedWorker(e.target.value)}
              >
                <option value="">Select a baker…</option>
                {workers.map(w => (
                  <option key={w.id} value={w.id}>{w.full_name}</option>
                ))}
              </select>
            </div>

            {/* Proficiency toggle */}
            <div style={{ marginBottom: 14 }}>
              <label className="label">Proficiency</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['expert', 'standard', 'learning'] as const).map(level => {
                  const meta = PROFICIENCY_META[level];
                  const isActive = proficiency === level;
                  return (
                    <button
                      key={level}
                      onClick={() => setProficiency(level)}
                      style={{
                        flex: 1,
                        padding: '7px 0',
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 8,
                        border: '0.5px solid var(--gray-200)',
                        background: 'var(--gray-50)',
                        color: 'var(--gray-500)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        transition: 'all 0.12s ease',
                        ...(isActive ? meta.activeStyle : {}),
                      }}
                    >
                      {meta.icon}
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Product picker — flat list, no dough grouping */}
            <div style={{ marginBottom: 14 }}>
              <label className="label">Products</label>
              <div style={{
                maxHeight: 210,
                overflowY: 'auto',
                border: '0.5px solid var(--gray-200)',
                borderRadius: 8,
                padding: '6px 8px',
              }}>
                {products.map(p => (
                  <label key={p.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 6px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--gray-800)',
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedProducts.has(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      style={{ accentColor: '#185FA5', width: 14, height: 14, cursor: 'pointer' }}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 14 }}>
              <label className="label">
                Notes{' '}
                <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                className="input"
                placeholder="e.g. very fast with delicate doughs"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {/* Dynamic hint */}
            {selectedProducts.size > 0 && selectedWorker && (
              <p style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 10, lineHeight: 1.5 }}>
                {selectedProducts.size} product{selectedProducts.size > 1 ? 's' : ''} selected — confirm to save.
              </p>
            )}

            {/* Save CTA */}
            <button
              onClick={save}
              disabled={!canSave}
              style={{
                width: '100%',
                padding: '11px 0',
                minHeight: 44,
                borderRadius: 8,
                border: 'none',
                background: canSave ? '#1F3A93' : 'var(--gray-200)',
                color: canSave ? '#fff' : 'var(--gray-400)',
                fontWeight: 500,
                fontSize: 14,
                cursor: canSave ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'background 0.15s ease',
              }}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={14} />}
              {saveLabel}
            </button>
          </div>

          {/* ── RIGHT: worker specialty cards (accordion/dropdown) ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {workers.map(w => {
              const specs = workerSpecialties(w.id);
              const isOpen = openWorkers.has(w.id);

              return (
                <div key={w.id} style={{
                  background: 'var(--color-background-primary, #fff)',
                  border: '0.5px solid var(--gray-200)',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}>
                  {/* Clickable header */}
                  <div
                    onClick={() => toggleWorkerOpen(w.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 14px',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: '#E6F1FB', color: '#0C447C',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 500, flexShrink: 0,
                    }}>
                      {w.full_name.charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--gray-800)', margin: 0 }}>{w.full_name}</p>
                      <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: 0, textTransform: 'capitalize' }}>{w.role}</p>
                    </div>
                    <span style={{
                      fontSize: 11, color: 'var(--gray-400)',
                      background: 'var(--gray-100)',
                      borderRadius: 10, padding: '2px 8px', flexShrink: 0,
                    }}>
                      {specs.length} {specs.length === 1 ? 'specialty' : 'specialties'}
                    </span>
                    <ChevronDown
                      size={15}
                      style={{
                        color: 'var(--gray-400)',
                        flexShrink: 0,
                        marginLeft: 4,
                        transition: 'transform 0.2s ease',
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </div>

                  {/* Collapsible body */}
                  {isOpen && (
                    <div style={{
                      borderTop: '0.5px solid var(--gray-200)',
                      padding: '10px 14px',
                    }}>
                      {specs.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--gray-400)', fontStyle: 'italic', padding: '4px 0' }}>
                          No specialties assigned — can work any product
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {specs.map(s => (
                            <div key={s.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              background: 'var(--gray-50)',
                              border: '0.5px solid var(--gray-200)',
                              borderRadius: 6,
                              padding: '6px 10px',
                            }}>
                              <span style={{
                                flex: 1, fontSize: 12, color: 'var(--gray-800)',
                                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {s.products?.name}
                              </span>
                              <select
                                value={s.proficiency}
                                onChange={e => updateProficiency(s.id, e.target.value)}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 500,
                                  borderRadius: 4,
                                  padding: '2px 6px',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  ...BADGE_STYLES[s.proficiency],
                                }}
                              >
                                <option value="expert">Expert</option>
                                <option value="standard">Standard</option>
                                <option value="learning">Learning</option>
                              </select>
                              <button
                                onClick={() => removeSpecialty(s.id)}
                                title="Remove specialty"
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: 'var(--gray-400)', padding: 2, borderRadius: 4,
                                  display: 'flex', alignItems: 'center', flexShrink: 0,
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#E24B4A'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--gray-400)'; }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
