import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Edit2, AlertTriangle, Loader2, Wifi, WifiOff } from 'lucide-react';
import api from '../../lib/api';
import type { Ingredient } from '../../types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface LowStockAlert {
  id: string;
  created_at: string;
  users: { full_name: string; role: string } | null;
  meta: {
    production_date: string;
    shortage_count: number;
    shortages: {
      ingredient_id: string;
      ingredient_name: string;
      shortage_g: number;
    }[];
  } | null;
}

interface IngredientRow extends Ingredient {
  computed_status: string;
  amount_value?: number;
  amount_display?: string;
  amount_unit?: string;
}

interface IngForm {
  name: string;
  unit: string;
  current_stock_g: number;
  reorder_threshold_g: number;
  amount_value: number;
  amount_display: string;
  amount_unit: string;
}

const EMPTY_FORM: IngForm = {
  name: '',
  unit: 'g',
  current_stock_g: 0,
  reorder_threshold_g: 0,
  amount_value: 0,
  amount_display: '',
  amount_unit: '',
};

function stockBadge(status: string) {
  if (status === 'out_of_stock') return 'badge-red';
  if (status === 'critical') return 'badge-red';
  if (status === 'low') return 'badge-amber';
  return 'badge-green';
}

function stockLabel(status: string) {
  if (status === 'out_of_stock') return 'Out of Stock';
  if (status === 'critical') return 'Critical';
  if (status === 'low') return 'Low';
  return 'Sufficient';
}

function formatGrams(g: number, unit: string) {
  if (unit === 'pcs') return `${Math.floor(g)} pcs`;
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kg`;
  return `${g.toFixed(0)} g`;
}

export default function ManageIngredients() {
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editIng, setEditIng] = useState<IngredientRow | null>(null);
  const [form, setForm] = useState<IngForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [filter, setFilter] = useState<'all' | 'alerts'>('all');

  const fetchIngredients = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError('');
      const resp = await api.get('/ingredients');
      setIngredients(resp.data.ingredients ?? []);
    } catch (e: unknown) {
      setLoadError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to load ingredients'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLowStockAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError('');
    try {
      const r = await api.get('/reports/logs?limit=5&action=LOW_STOCK_ALERT');
      setLowStockAlerts(r.data.logs ?? []);
    } catch (e: unknown) {
      setAlertsError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to load low stock alerts'
      );
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIngredients();
    fetchLowStockAlerts();
    const interval = setInterval(fetchLowStockAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchIngredients, fetchLowStockAlerts]);

  const alerts = useMemo(
    () => ingredients.filter((i) => i.computed_status !== 'sufficient'),
    [ingredients]
  );

  const alertIngredientIds = useMemo(() => {
    return new Set(
      lowStockAlerts.flatMap(
        (alert) => alert.meta?.shortages?.map((item) => item.ingredient_id) ?? []
      )
    );
  }, [lowStockAlerts]);

  const displayed = filter === 'alerts' ? alerts : ingredients;

  const openCreate = () => {
    setEditIng(null);
    setForm(EMPTY_FORM);
    setSaveError('');
    setShowModal(true);
  };

  const openEdit = (i: IngredientRow) => {
    setEditIng(i);
    setForm({
      name: i.name,
      unit: i.unit,
      current_stock_g: Number(i.current_stock_g),
      reorder_threshold_g: Number(i.reorder_threshold_g),
      amount_value: i.amount_value ?? 0,
      amount_display: i.amount_display ?? '',
      amount_unit: i.amount_unit ?? '',
    });
    setSaveError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (editIng) await api.patch(`/ingredients/${editIng.id}`, form);
      else await api.post('/ingredients', form);
      setShowModal(false);
      await fetchIngredients();
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
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Ingredients</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {ingredients.length} ingredients · {alerts.length} alerts
            {lowStockAlerts.length > 0 &&
              ` · ${lowStockAlerts.length} low stock alert${lowStockAlerts.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={16} /> Add Ingredient
        </button>
      </div>

      {loadError && <div className="shortage-alert">{loadError}</div>}
      {alerts.length > 0 && (
        <div className="shortage-alert flex items-center gap-2">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>
            <strong>
              {alerts.length} ingredient{alerts.length > 1 ? 's' : ''}
            </strong>{' '}
            need restocking
          </span>
        </div>
      )}
      {alertsError && <div className="shortage-alert mt-3">{alertsError}</div>}

      {lowStockAlerts.length > 0 && (
        <div className="card-sm border border-red-200 bg-red-50 text-sm text-gray-700">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600" />
              <div>
                <p className="font-semibold text-red-700">Recent low stock alerts</p>
                <p className="text-xs text-gray-500">Scaler-logged shortages and affected ingredients.</p>
              </div>
            </div>
            <span className="badge-red text-xs">{lowStockAlerts.length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {lowStockAlerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-red-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {alert.meta?.shortage_count ?? 0} shortage
                      {(alert.meta?.shortage_count ?? 0) > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-500">{dayjs(alert.created_at).fromNow()} — {alert.meta?.production_date}</p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    {alert.users ? alert.users.full_name : 'System'}
                  </span>
                </div>
                <ul className="mt-3 space-y-2 text-xs text-gray-600">
                  {alert.meta?.shortages?.map((item) => (
                    <li key={item.ingredient_id} className="flex justify-between gap-3">
                      <span>{item.ingredient_name}</span>
                      <span className="font-semibold text-red-600">-{item.shortage_g}g</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {(['all', 'alerts'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn-sm rounded-lg ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
          >
            {f === 'all' ? `All (${ingredients.length})` : `Alerts (${alerts.length})`}
          </button>
        ))}
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Unit</th>
              <th>Current Stock</th>
              <th>Reorder Level</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : (
              displayed.map((ing) => (
                <tr
                  key={ing.id}
                  className={
                    ing.computed_status !== 'sufficient'
                      ? 'bg-amber-50/40'
                      : alertIngredientIds.has(ing.id)
                        ? 'bg-red-50/40'
                        : ''
                  }
                >
                  <td className="font-medium text-gray-800">
                    {ing.name}
                    {alertIngredientIds.has(ing.id) && (
                      <span className="ml-2 badge-red text-xs">Low stock alert</span>
                    )}
                  </td>
                  <td className="text-gray-500 uppercase text-xs">{ing.unit}</td>
                  <td>
                    {ing.amount_display && ing.amount_unit ? (
                      <div className="flex flex-col leading-tight">
                        <span className="font-semibold text-sm text-gray-800">
                          {ing.amount_display} {ing.amount_unit}
                        </span>
                        <span className="text-xs text-gray-400 font-mono">
                          {formatGrams(Number(ing.current_stock_g), ing.unit)}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-sm text-gray-800">
                        {formatGrams(Number(ing.current_stock_g), ing.unit)}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-sm text-gray-400">
                    {ing.reorder_threshold_g >= 1000
                      ? `${(Number(ing.reorder_threshold_g) / 1000).toFixed(1)} kg`
                      : `${Number(ing.reorder_threshold_g)} g`}
                  </td>
                  <td>
                    {alertIngredientIds.has(ing.id) ? (
                      <span className="badge-red">
                        <AlertTriangle size={10} className="mr-1" /> Low stock alert
                      </span>
                    ) : (
                      <span className={stockBadge(ing.computed_status)}>
                        {ing.computed_status !== 'sufficient' && (
                          <AlertTriangle size={10} className="mr-1" />
                        )}
                        {stockLabel(ing.computed_status)}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end">
                      <button
                        onClick={() => openEdit(ing)}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Edit2 size={14} />
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
          <div className="bg-white rounded-xl shadow-card-lg w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-display text-lg font-semibold">{editIng ? 'Edit Ingredient' : 'Add Ingredient'}</h2>
            </div>
            <div className="p-6 space-y-4">
              {saveError && <div className="shortage-alert">{saveError}</div>}

              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className="label">Unit</label>
                <select
                  className="input"
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                >
                  {['g', 'kg', 'ml', 'l', 'pcs'].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Current Stock (grams)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.current_stock_g}
                  onChange={(e) => setForm((f) => ({ ...f, current_stock_g: +e.target.value }))}
                />
              </div>

              <div>
                <label className="label">Reorder Threshold (grams)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.reorder_threshold_g}
                  onChange={(e) => setForm((f) => ({ ...f, reorder_threshold_g: +e.target.value }))}
                />
              </div>

              <div className="border-t border-gray-100 pt-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-3">Human-Readable Amount</p>
                <div className="space-y-3">
                  <div>
                    <label className="label">Amount Value</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step="any"
                      value={form.amount_value}
                      onChange={(e) => setForm((f) => ({ ...f, amount_value: +e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Amount Display</label>
                    <input
                      className="input"
                      placeholder="e.g. 2, 1½, ¾"
                      value={form.amount_display}
                      onChange={(e) => setForm((f) => ({ ...f, amount_display: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Amount Unit</label>
                    <select
                      className="input"
                      value={form.amount_unit}
                      onChange={(e) => setForm((f) => ({ ...f, amount_unit: e.target.value }))}
                    >
                      <option value="">— none —</option>
                      {['cup', 'cups', 'tbsp', 'tsp', 'g', 'kg', 'ml', 'l', 'pcs', 'oz', 'lb'].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
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

      {/* NOTE: we removed realtime hooks for admin stability with your auth model */}
    </div>
  );
}

