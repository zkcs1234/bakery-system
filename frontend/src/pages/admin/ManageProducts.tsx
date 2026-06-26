/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Plus, Edit2, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useRealtimeIngredients } from '../../hooks/useRealtimeData.tsx';
import type { Product, Ingredient, DoughType } from '../../types';
import { DOUGH_TYPE_LABELS } from '../../types';

const DOUGH_BADGE: Record<DoughType, string> = {
  lean_hard_yeast:  'badge-gray',
  enriched_yeast:   'badge-amber',
  tangzhong:        'badge-blue',
  batter_quick_mix: 'badge-green',
};

interface RecipeRow { ingredient_id: string; amount_g: number; notes: string; is_optional: boolean; amount_value?: number; amount_display?: string; amount_unit?: string }

interface ProductForm {
  name: string; dough_type: DoughType; base_yield_qty: number; yield_unit: string;
  oven_temp_c: number | ''; bake_time_min: number | '';
  ingredients: RecipeRow[];
}

const EMPTY_FORM: ProductForm = {
  name: '', dough_type: 'lean_hard_yeast', base_yield_qty: 1, yield_unit: 'pcs',
  oven_temp_c: '', bake_time_min: '', ingredients: [],
};

export default function ManageProducts() {
  const { ingredients: realtimeIngredients, loading: ingredientsLoading, error: ingredientsError } = useRealtimeIngredients();

  const [products, setProducts]       = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loadError, setLoadError]     = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [showModal, setShowModal]     = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form, setForm]               = useState<ProductForm>(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState('');

  // Load full product catalog (with recipes) from API; realtime for ingredients only
  useEffect(() => {
    setProductsLoading(true);
    api.get('/products')
      .then(r => setProducts(r.data.products ?? []))
      .catch(() => setLoadError('Failed to load products'))
      .finally(() => setProductsLoading(false));
  }, []);

  useEffect(() => {
    setIngredients(realtimeIngredients as Ingredient[]);
    if (ingredientsError) setLoadError(ingredientsError);
  }, [realtimeIngredients, ingredientsError]);

  const openCreate = () => {
    setEditProduct(null);
    setForm({ ...EMPTY_FORM, ingredients: [{ ingredient_id: '', amount_g: 0, notes: '', is_optional: false, amount_value: 0, amount_display: '', amount_unit: '' }] });
    setSaveError(''); setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setForm({
      name: p.name, dough_type: p.dough_type,
      base_yield_qty: p.base_yield_qty, yield_unit: p.yield_unit,
      oven_temp_c: p.oven_temp_c ?? '', bake_time_min: p.bake_time_min ?? '',
      ingredients: (p.recipe_ingredients ?? []).map(r => ({
        ingredient_id: r.ingredient_id,
        amount_g: r.amount_g,
        amount_value: r.amount_value ?? 0,
        amount_display: r.amount_display ?? '',
        amount_unit: r.amount_unit ?? '',
        notes: r.notes ?? '', is_optional: r.is_optional,
      })),
    });
    setSaveError(''); setShowModal(true);
  };

  const addIngRow = () => setForm(f => ({ ...f, ingredients: [...f.ingredients, { ingredient_id: '', amount_g: 0, notes: '', is_optional: false }] }));
  const removeIngRow = (i: number) => setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, idx) => idx !== i) }));
  const updateIngRow = (i: number, key: keyof RecipeRow, val: string | number | boolean) =>
    setForm(f => { const rows = [...f.ingredients]; ((rows[i] as unknown) as Record<string, unknown>)[key] = val; return { ...f, ingredients: rows }; });

  const handleSave = async () => {
    setSaving(true); setSaveError('');
    try {
      if (editProduct) {
        await api.patch(`/products/${editProduct.id}`, {
          name: form.name, dough_type: form.dough_type,
          base_yield_qty: form.base_yield_qty, yield_unit: form.yield_unit,
          oven_temp_c: form.oven_temp_c || null, bake_time_min: form.bake_time_min || null,
        });
        await api.put(`/products/${editProduct.id}/recipe`, {
          ingredients: form.ingredients.filter(r => r.ingredient_id),
        });
      } else {
        await api.post('/products', {
          name: form.name, dough_type: form.dough_type,
          base_yield_qty: form.base_yield_qty, yield_unit: form.yield_unit,
          oven_temp_c: form.oven_temp_c || null, bake_time_min: form.bake_time_min || null,
          ingredients: form.ingredients.filter(r => r.ingredient_id),
        });
      }
      setShowModal(false);
      const refreshed = await api.get('/products');
      setProducts(refreshed.data.products ?? []);
    } catch (e: unknown) {
      setSaveError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Products & Recipes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {products.length} products configured
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus size={16} /> Add Product</button>
      </div>

      {/* Product list */}
      <div className="space-y-2">
        {loadError && <div className="shortage-alert">{loadError}</div>}
        {productsLoading || ingredientsLoading ? (
          [...Array(4)].map((_, i) => <div key={i} className="h-16 bg-white rounded-lg animate-pulse border border-wheat-100" />)
        ) : products.map((p: any) => (
          <div key={p.id} className="bg-white rounded-lg border border-wheat-100 shadow-card overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-wheat-50 transition-colors"
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 text-sm">{p.name}</span>
                  <span className={(DOUGH_BADGE as any)[p.dough_type as any]}>{(DOUGH_TYPE_LABELS as any)[p.dough_type as any]}</span>
                  {!p.is_active && <span className="badge-gray">Inactive</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Yield: {p.base_yield_qty} {p.yield_unit}
                  {p.oven_temp_c ? ` · ${p.oven_temp_c}°C` : ''}
                  {p.bake_time_min ? ` · ${p.bake_time_min} min` : ''}
                  · {p.recipe_ingredients?.length ?? 0} ingredients
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={e => { e.stopPropagation(); openEdit(p); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600">
                  <Edit2 size={14} />
                </button>
                {expanded === p.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </div>
            </div>

            {/* Recipe detail */}
            {expanded === p.id && (
              <div className="border-t border-wheat-100 px-4 py-3 bg-wheat-50/50">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recipe (per batch)</p>
                {(p.recipe_ingredients ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No recipe configured</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {(p.recipe_ingredients ?? []).map((r: any) => (
                      <div key={r.id} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="w-2 h-2 rounded-full bg-crust-300 flex-shrink-0" />
                        <span className="font-medium">{r.ingredients?.name}</span>
                        <span className="text-gray-400">— {r.amount_g}g</span>
                        {r.notes && <span className="text-gray-400 italic truncate">({r.notes})</span>}
                        {r.is_optional && <span className="badge-gray text-xs">optional</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-card-lg w-full max-w-2xl my-4">
            <div className="px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="font-display text-lg font-semibold text-gray-800">
                {editProduct ? 'Edit Product' : 'Create Product'}
              </h2>
            </div>
            <div className="p-6 space-y-5">
              {saveError && <div className="shortage-alert">{saveError}</div>}

              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Product Name</label>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Dough Type</label>
                  <select className="input" value={form.dough_type}
                    onChange={e => setForm(f => ({ ...f, dough_type: e.target.value as DoughType }))}>
                    {(Object.entries(DOUGH_TYPE_LABELS) as [DoughType, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Yield Unit</label>
                  <input className="input" value={form.yield_unit} onChange={e => setForm(f => ({ ...f, yield_unit: e.target.value }))} placeholder="pcs, loaves, rolls…" />
                </div>
                <div>
                  <label className="label">Base Yield Qty</label>
                  <input className="input" type="number" min={1} value={form.base_yield_qty}
                    onChange={e => setForm(f => ({ ...f, base_yield_qty: +e.target.value }))} />
                </div>
                <div>
                  <label className="label">Oven Temp (°C)</label>
                  <input className="input" type="number" value={form.oven_temp_c}
                    onChange={e => setForm(f => ({ ...f, oven_temp_c: e.target.value ? +e.target.value : '' }))} />
                </div>
                <div>
                  <label className="label">Bake Time (min)</label>
                  <input className="input" type="number" value={form.bake_time_min}
                    onChange={e => setForm(f => ({ ...f, bake_time_min: e.target.value ? +e.target.value : '' }))} />
                </div>
              </div>

              {/* Recipe builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Recipe Ingredients (per batch)</label>
                  <button onClick={addIngRow} className="btn-secondary btn-sm"><Plus size={12} /> Add</button>
                </div>
                <div className="space-y-2">
                  {form.ingredients.map((row, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-5">
                        <select className="input text-xs" value={row.ingredient_id}
                          onChange={e => updateIngRow(i, 'ingredient_id', e.target.value)}>
                          <option value="">— Ingredient —</option>
                          {ingredients.map(ing => (
                            <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <input className="input text-xs" type="number" placeholder="g" value={row.amount_g || ''}
                          onChange={e => updateIngRow(i, 'amount_g', +e.target.value)} />
                      </div>
                      <div className="col-span-3">
                        <input className="input text-xs" placeholder="Notes" value={row.notes}
                          onChange={e => updateIngRow(i, 'notes', e.target.value)} />
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        <input type="checkbox" checked={row.is_optional}
                          onChange={e => updateIngRow(i, 'is_optional', e.target.checked)}
                          title="Optional" className="accent-crust-600" />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => removeIngRow(i)} className="text-red-400 hover:text-red-600 p-1">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Checkbox = optional ingredient</p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end sticky bottom-0 bg-white rounded-b-xl">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
