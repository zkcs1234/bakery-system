/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import supabase from '../lib/supabase';

const TABLE_COLUMNS: Record<string, string> = {
  ingredients: 'id, name, unit, current_stock_g, reorder_threshold_g, stock_status',
  products: 'id, name, dough_type, base_yield_qty, yield_unit, oven_temp_c, bake_time_min, is_active',
  branches: 'id, name, address, contact, is_active',
  users: 'id, full_name, email, role, branch_id, mixer_team, is_active',
  tasks: 'id, plan_item_id, assigned_to, task_role, batches_assigned, status, is_priority, started_at, completed_at',
  orders: 'id, branch_id, delivery_date, work_day, status, is_special, created_at',
};

const REALTIME_DEBOUNCE_MS = 400;

function subscribeToTable(
  table: string,
  handler: (payload: any) => void,
  setSubscribed: (v: boolean) => void
) {
  const channel = supabase
    .channel(`public:${table}:perf`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload: any) => handler(payload)
    )
    .subscribe((status) => setSubscribed(status === 'SUBSCRIBED'));

  return channel;
}

export function useRealtimeSubscription<T extends { id?: string }>(
  table: string
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const fetchInitial = async () => {
      try {
        setLoading(true);
        const columns = TABLE_COLUMNS[table] ?? 'id';

        try {
          const { data: rows, error: fetchErr } = await supabase
            .from(table)
            .select(columns);
          if (!fetchErr && rows) {
            if (!cancelled) setData(rows as unknown as T[]);
            return;
          }
        } catch {
          // fall through to backend API
        }

        try {
          const resp = await fetch(`/api/${table}`);
          if (resp.ok) {
            const json = await resp.json();
            const arr = json[table] ?? json.data ?? Object.values(json).find(v => Array.isArray(v));
            if (Array.isArray(arr) && !cancelled) {
              setData(arr as T[]);
              return;
            }
          }
        } catch {
          // ignore
        }

        if (!cancelled) setData([]);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const scheduleRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchInitial();
      }, REALTIME_DEBOUNCE_MS);
    };

    fetchInitial();

    channel = subscribeToTable(table, (payload: any) => {
      const eventType = (payload.eventType || payload.type) as 'INSERT' | 'UPDATE' | 'DELETE';

      if (eventType === 'INSERT') {
        const newRecord = payload.new as T;
        setData((prev) => {
          const exists = prev.some((p) => (p as any).id === (newRecord as any).id);
          return exists ? prev : [...prev, newRecord];
        });
        scheduleRefetch();
      } else if (eventType === 'UPDATE') {
        const newRecord = payload.new as T;
        setData((prev) => prev.map((p) => ((p as any).id === (newRecord as any).id ? newRecord : p)));
        scheduleRefetch();
      } else if (eventType === 'DELETE') {
        const oldRecord = payload.old as T;
        setData((prev) => prev.filter((p) => (p as any).id !== (oldRecord as any).id));
      }
    }, setIsSubscribed) as unknown as RealtimeChannel;

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [table]);

  return { data, loading, error, isSubscribed, setData } as const;
}

export function useRealtimeIngredients() {
  const { data, loading, error, isSubscribed, setData } = useRealtimeSubscription<any>('ingredients');
  return { ingredients: data, loading, error, isSubscribed, setIngredients: setData } as const;
}

export function useRealtimeProducts() {
  const { data, loading, error, isSubscribed, setData } = useRealtimeSubscription<any>('products');
  return { products: data, loading, error, isSubscribed, setProducts: setData } as const;
}

export function useRealtimeBranches() {
  const { data, loading, error, isSubscribed, setData } = useRealtimeSubscription<any>('branches');
  return { branches: data, loading, error, isSubscribed, setBranches: setData } as const;
}

export function useRealtimeUsers() {
  const { data, loading, error, isSubscribed, setData } = useRealtimeSubscription<any>('users');
  return { users: data, loading, error, isSubscribed, setUsers: setData } as const;
}

export function useRealtimeTasks() {
  const { data, loading, error, isSubscribed, setData } = useRealtimeSubscription<any>('tasks');
  return { tasks: data, loading, error, isSubscribed, setTasks: setData } as const;
}

export function useRealtimeOrders() {
  const { data, loading, error, isSubscribed, setData } = useRealtimeSubscription<any>('orders');
  return { orders: data, loading, error, isSubscribed, setOrders: setData } as const;
}

export default useRealtimeSubscription;
