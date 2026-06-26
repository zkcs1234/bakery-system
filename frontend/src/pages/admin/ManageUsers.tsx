import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Search, Edit2, UserX, UserCheck, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import type { User, Branch, UserRole, MixerTeam } from '../../types';
import { ROLE_LABELS } from '../../types';

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'badge-purple',
  supervisor: 'bg-blue-100 text-blue-700 badge',
  branch_manager: 'badge-amber',
  scaler: 'badge-sage',
  mixer: 'bg-amber-100 text-amber-700 badge',
  baker: 'badge-red',
  repacker: 'bg-teal-100 text-teal-700 badge',
};

interface UserFormData {
  full_name: string;
  email: string;
  password: string;
  role: UserRole;
  branch_id: string;
  mixer_team: MixerTeam | '';
}

const EMPTY_FORM: UserFormData = {
  full_name: '',
  email: '',
  password: '',
  role: 'scaler',
  branch_id: '',
  mixer_team: '',
};

export default function ManageUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [usersResp, branchesResp] = await Promise.all([
        api.get('/users'),
        api.get('/branches'),
      ]);
      setUsers(usersResp.data.users ?? []);
      setBranches(branchesResp.data.branches ?? []);
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to load users'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.includes(q)
    );
  }, [users, search]);

  const openCreate = () => {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setSaveError('');
    setShowModal(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({
      full_name: u.full_name,
      email: u.email,
      password: '',
      role: u.role,
      branch_id: u.branch_id ?? '',
      mixer_team: (u.mixer_team as MixerTeam | null) ?? '',
    });
    setSaveError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (editUser) {
        const payload: Partial<UserFormData> = {
          full_name: form.full_name,
          role: form.role,
          branch_id: form.branch_id || undefined,
          mixer_team: form.mixer_team || undefined,
        };
        await api.patch(`/users/${editUser.id}`, payload);
      } else {
        await api.post('/users', {
          ...form,
          branch_id: form.branch_id || null,
          mixer_team: form.mixer_team || null,
        });
      }
      setShowModal(false);
      await fetchData();
    } catch (e: unknown) {
      setSaveError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Save failed'
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: User) => {
    await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
    await fetchData();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">{users.length} total accounts</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={16} /> Add User
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-9"
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="shortage-alert">{error}</div>}

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Mixer Team</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  Loading users…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  No users found
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-gray-800">{u.full_name}</td>
                  <td className="text-gray-500">{u.email}</td>
                  <td>
                    <span className={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role]}</span>
                  </td>
                  <td className="text-gray-500">{u.branches?.name ?? '—'}</td>
                  <td className="text-gray-500">
                    {u.mixer_team
                      ? u.mixer_team.replace('team_', 'Team ').toUpperCase()
                      : '—'}
                  </td>
                  <td>
                    <span className={u.is_active ? 'badge-green' : 'badge-gray'}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => toggleActive(u)}
                        className={
                          'p-1.5 rounded-lg transition-colors ' +
                          (u.is_active
                            ? 'text-gray-400 hover:bg-red-50 hover:text-red-500'
                            : 'text-gray-400 hover:bg-sage-50 hover:text-sage-600')
                        }
                      >
                        {u.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-card-lg w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-display text-lg font-semibold text-gray-800">
                {editUser ? 'Edit User' : 'Create User'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {saveError && <div className="shortage-alert">{saveError}</div>}
              <div>
                <label className="label">Full Name</label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </div>

              {!editUser && (
                <>
                  <div>
                    <label className="label">Email</label>
                    <input
                      className="input"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input
                      className="input"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="label">Role</label>
                <select
                  className="input"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>

              {form.role === 'branch_manager' && (
                <div>
                  <label className="label">Branch</label>
                  <select
                    className="input"
                    value={form.branch_id}
                    onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))}
                  >
                    <option value="">— Select branch —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {form.role === 'mixer' && (
                <div>
                  <label className="label">Mixer Team</label>
                  <select
                    className="input"
                    value={form.mixer_team}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mixer_team: e.target.value as MixerTeam }))
                    }
                  >
                    <option value="">— Select team —</option>
                    <option value="team_a">Team A — Lean/Hard Yeast</option>
                    <option value="team_b">Team B — Enriched & Tangzhong</option>
                    <option value="team_c">Team C — Batter/Quick Mix</option>
                  </select>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
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

