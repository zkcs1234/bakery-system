import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Loader2, ShoppingCart, ChevronDown } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { Product } from '../../types';
import { DOUGH_TYPE_LABELS } from '../../types';

interface OrderItem { product_id: string; batches: number; }

/* ── Custom dropdown that always opens downward ─────────────────── */
function ProductSelect({
  value,
  products,
  onChange,
}: {
  value: string;
  products: Product[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = products.find(p => p.id === value);

  return (
    <div ref={ref} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input text-sm w-full flex items-center justify-between gap-2 text-left"
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? selected.name : '— Select product —'}
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown list — always below the trigger */}
      {open && (
        <ul
          className="absolute left-0 top-full mt-1 z-50 w-full bg-white border border-wheat-200 rounded-lg shadow-lg max-h-52 overflow-y-auto py-1"
        >
          <li>
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-wheat-50"
            >
              — Select product —
            </button>
          </li>
          {products.map(p => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-wheat-50 ${
                  p.id === value ? 'bg-crust-50 text-crust-700 font-medium' : 'text-gray-700'
                }`}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────── */
export default function PlaceOrder() {
  const navigate = useNavigate();
  const [products, setProducts]         = useState<Product[]>([]);
  const [deliveryDate, setDeliveryDate] = useState(dayjs().add(1, 'day').format('YYYY-MM-DD'));
  const [isSpecial, setIsSpecial]       = useState(false);
  const [specialNotes, setSpecialNotes] = useState('');
  const [items, setItems]               = useState<OrderItem[]>([{ product_id: '', batches: 1 }]);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');
  const [loadError, setLoadError]       = useState('');

  useEffect(() => {
    setLoadError('');
    api.get('/products/summary')
      .then(r => setProducts(r.data.products))
      .catch((e: unknown) => {
        setLoadError(
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? 'Failed to load products'
        );
      });
  }, []);

  const addItem    = () => setItems(i => [...i, { product_id: '', batches: 1 }]);
  const removeItem = (idx: number) => setItems(i => i.filter((_, k) => k !== idx));
  const updateItem = (idx: number, key: keyof OrderItem, val: string | number) =>
    setItems(i => { const copy = [...i]; ((copy[idx] as unknown) as Record<string, unknown>)[key] = val; return copy; });

  const handleSubmit = async () => {
    const validItems = items.filter(i => i.product_id && i.batches > 0);
    if (!validItems.length) { setError('Add at least one product'); return; }
    if (!deliveryDate)      { setError('Select a delivery date'); return; }

    setSubmitting(true); setError('');
    try {
      await api.post('/orders', {
        delivery_date: deliveryDate,
        is_special: isSpecial,
        ...(specialNotes.trim() ? { special_notes: specialNotes.trim() } : {}),
        items: validItems,
      });
      navigate('/branch', { replace: true });
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to place order'
      );
    } finally { setSubmitting(false); }
  };

  const selectedProduct = (id: string) => products.find(p => p.id === id);
  const totalUnits = items
    .filter(i => i.product_id)
    .reduce((sum, i) => {
      const p = selectedProduct(i.product_id);
      return sum + (p ? p.base_yield_qty * i.batches : 0);
    }, 0);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-800">Place Order</h1>
        <p className="text-sm text-gray-500 mt-0.5">Orders must be placed at least 1 day in advance</p>
      </div>

      {loadError && <div className="shortage-alert">{loadError}</div>}
      {error     && <div className="shortage-alert">{error}</div>}

      <div className="card-md space-y-5">
        {/* Delivery date */}
        <div>
          <label className="label">Delivery Date <span className="text-red-400">*</span></label>
          <input
            type="date"
            className="input max-w-xs"
            value={deliveryDate}
            min={dayjs().add(1, 'day').format('YYYY-MM-DD')}
            onChange={e => setDeliveryDate(e.target.value)}
          />
          <p className="text-sm text-gray-400 mt-1">
            Earliest: {dayjs().add(1, 'day').format('MMMM D')}
          </p>
        </div>

        {/* Product items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Products <span className="text-red-400">*</span></label>
            <button onClick={addItem} className="btn-secondary btn-sm">
              <Plus size={12} /> Add Product
            </button>
          </div>

          <div className="space-y-2">
            {items.map((item, idx) => {
              const p = selectedProduct(item.product_id);
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                  {/* Product selector */}
                  <div className="col-span-7">
                    <ProductSelect
                      value={item.product_id}
                      products={products}
                      onChange={id => updateItem(idx, 'product_id', id)}
                    />
                    {p && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {p.base_yield_qty} {p.yield_unit}/batch
                      </p>
                    )}
                  </div>

                  {/* Batch count */}
                  <div className="col-span-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        className="input text-sm"
                        value={item.batches}
                        onChange={e => updateItem(idx, 'batches', +e.target.value)}
                      />
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        batch{item.batches > 1 ? 'es' : ''}
                      </span>
                    </div>
                    {p && item.batches > 0 && (
                      <p className="text-xs text-sage-600 mt-0.5">
                        {p.base_yield_qty * item.batches} {p.yield_unit}
                      </p>
                    )}
                  </div>

                  {/* Remove */}
                  <div className="col-span-2 flex justify-end pt-1">
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(idx)}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {totalUnits > 0 && (
            <p className="text-xs text-crust-600 font-medium mt-2">
              Total: ~{totalUnits} units across {items.filter(i => i.product_id).length} product(s)
            </p>
          )}
        </div>

        {/* Special order */}
        <div className="border-t border-wheat-100 pt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isSpecial}
              onChange={e => setIsSpecial(e.target.checked)}
              className="accent-crust-600 w-4 h-4"
            />
            <span className="text-sm font-medium text-gray-700">Mark as Special Order</span>
            <span className="badge-orange text-xs">Requires supervisor approval</span>
          </label>
          {isSpecial && (
            <div className="mt-3">
              <label className="label">Special Instructions / Notes</label>
              <textarea
                className="input min-h-16 resize-none"
                rows={3}
                placeholder="Describe special requirements, custom packaging, etc."
                value={specialNotes}
                onChange={e => setSpecialNotes(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-3 justify-end">
        <button onClick={() => navigate('/branch')} className="btn-secondary">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
          {submitting
            ? <><Loader2 size={15} className="animate-spin" /> Placing Order…</>
            : <><ShoppingCart size={15} /> Place Order</>}
        </button>
      </div>
    </div>
  );
}