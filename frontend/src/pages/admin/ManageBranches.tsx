// ManageBranches.tsx
import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit2, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import type { Branch } from '../../types';

interface BranchForm { name: string; address: string; contact: string; }

export function ManageBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>({ name: '', address: '', contact: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fetchBranches = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const resp = await api.get('/branches');
      setBranches(resp.data.branches ?? []);
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to load branches'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const open = (b?: Branch) => {
    setEditBranch(b ?? null);
    setForm(
      b
        ? { name: b.name, address: b.address ?? '', contact: b.contact ?? '' }
        : { name: '', address: '', contact: '' }
    );
    setSaveError('');
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (editBranch) await api.patch(`/branches/${editBranch.id}`, form);
      else await api.post('/branches', form);
      setShowModal(false);
      await fetchBranches();
    } catch (e: unknown) {
      setSaveError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Save failed'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Branches</h1>
          <p className="text-sm text-gray-500 mt-0.5">{branches.length} branches</p>
        </div>
        <button onClick={() => open()} className="btn-primary">
          <Plus size={16} /> Add Branch
        </button>
      </div>

      <div className="space-y-2">
        {error && <div className="shortage-alert">{error}</div>}
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-16 bg-white rounded-lg animate-pulse border border-wheat-100"
            />
          ))
        ) : (
          branches.map((b) => (
            <div key={b.id} className="card flex items-center gap-4">
              <div className="w-9 h-9 bg-crust-100 rounded-lg flex items-center justify-center text-crust-600 text-lg flex-shrink-0">
                🏪
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800">{b.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {b.address ?? 'No address'} {b.contact ? `· ${b.contact}` : ''}
                </p>
              </div>
              <span className={b.is_active ? 'badge-green' : 'badge-gray'}>
                {b.is_active ? 'Active' : 'Inactive'}
              </span>
              <button
                onClick={() => open(b)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"
              >
                <Edit2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-card-lg w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-display text-lg font-semibold">
                {editBranch ? 'Edit Branch' : 'Add Branch'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {saveError && <div className="shortage-alert">{saveError}</div>}
              {(['name', 'address', 'contact'] as const).map((field) => (
                <div key={field}>
                  <label className="label capitalize">{field}</label>
                  <input
                    className="input"
                    value={form[field]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [field]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManageBranches;

