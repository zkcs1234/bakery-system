import { useEffect, useState } from 'react';
import { PackageCheck, Loader2, CheckCircle2, PlayCircle } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import type { Task } from '../../types';

export default function RepackerDashboard() {
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [taskError, setTaskError] = useState<{ taskId: string; message: string } | null>(null);
  const today = dayjs().format('YYYY-MM-DD');
  const [selectedDate, setSelectedDate] = useState(today);
  const isTodaySelected = selectedDate === today;

  const fetchTasks = (date = selectedDate) => {
    setLoading(true);
    setLoadError('');
    api.get(`/tasks/my?date=${date}`)
      .then(r => setTasks(r.data.tasks ?? []))
      .catch((e: unknown) => {
        setLoadError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load tasks');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchTasks(selectedDate); }, [selectedDate]);

  const updateStatus = async (id: string, status: 'in_progress' | 'completed') => {
    if (!isTodaySelected) {
      setTaskError({ taskId: id, message: 'You can only update tasks for today.' });
      return;
    }

    setUpdating(id);
    setLoadError('');
    setTaskError(null);
    try {
      await api.patch(`/tasks/${id}/status`, { status });
      fetchTasks();
    } catch (e: unknown) {
      const errorMsg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error 
        ?? 'Failed to update task status';
      setTaskError({ taskId: id, message: errorMsg });
    } finally {
      setUpdating(null);
    }
  };

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  // Group tasks by product for packing queue
  const pendingTasks    = tasks.filter(t => t.status !== 'completed');
  const completedTasks  = tasks.filter(t => t.status === 'completed');

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Packing Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">{dayjs(selectedDate).format('dddd, MMMM D')}</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="input max-w-[180px]"
          />
        </div>
      </div>

      {loadError && <div className="shortage-alert">{loadError}</div>}
      {!isTodaySelected && (
        <div className="card-sm bg-wheat-50 border border-wheat-100 text-sm text-gray-600">
          <p className="font-semibold text-gray-700">Future task view</p>
          <p className="mt-1">You can view packing tasks for {dayjs(selectedDate).format('MMMM D, YYYY')}, but only today&apos;s tasks can be started or completed.</p>
        </div>
      )}

      <div className="card-sm bg-blue-50 border border-blue-100 text-sm text-gray-600">
        <p className="font-semibold text-gray-700">📦 Packing Queue Rules</p>
        <p className="mt-1">You can only pack products after the baker has completed baking them. Tasks will appear here once the baker marks the baking work as done.</p>
      </div>

      {/* Progress */}
      <div className="card-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Packing Progress</span>
          <span className="text-sm font-bold text-teal-700">{completedCount}/{tasks.length}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill bg-teal-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-1">{progress}% packed</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_,i) => (
            <div key={i} className="h-16 bg-white rounded-lg animate-pulse border border-wheat-100" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <PackageCheck size={32} className="mx-auto mb-2 text-gray-300" />
          <p>No packing tasks for {isTodaySelected ? 'today' : dayjs(selectedDate).format('MMMM D, YYYY')}</p>
          <p className="text-xs mt-1">Tasks activate once bakers mark products as complete</p>
        </div>
      ) : (
        <>
          {/* Active packing tasks */}
          {pendingTasks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">To Pack</p>
              {pendingTasks.map(task => {
                const planItem = task.production_plan_items as { products?: { name: string; base_yield_qty: number; yield_unit: string } } | null;
                const product  = planItem?.products;
                const totalUnits = product ? product.base_yield_qty * task.batches_assigned : 0;

                return (
                  <div key={task.id}
                    className={`bg-white rounded-lg border shadow-card overflow-hidden
                      ${task.is_priority ? 'border-orange-300 bg-orange-50/30' : 'border-wheat-100'}`}>

                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        task.status === 'in_progress' ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-400'}`}>
                        {task.status === 'in_progress' ? <PackageCheck size={18} /> : <PackageCheck size={18} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-800 text-sm">{product?.name ?? 'Unknown'}</p>
                          {task.is_priority && (
                            <span className="badge-orange text-xs">PRIORITY — Label Separately</span>
                          )}
                          <span className={`badge text-xs ${task.status === 'in_progress' ? 'badge-blue' : 'badge-gray'}`}>
                            {task.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {task.batches_assigned} batch{task.batches_assigned > 1 ? 'es' : ''}
                          {totalUnits > 0 && ` · ${totalUnits} ${product?.yield_unit}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {task.status === 'pending' && (
                          <button onClick={() => updateStatus(task.id, 'in_progress')}
                            disabled={updating === task.id || !isTodaySelected} className="btn-secondary btn-sm">
                            {updating === task.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <PlayCircle size={12} />}
                            Start
                          </button>
                        )}
                        {task.status === 'in_progress' && (
                          <button onClick={() => updateStatus(task.id, 'completed')}
                            disabled={updating === task.id || !isTodaySelected} className="btn-success btn-sm">
                            {updating === task.id
                              ? <Loader2 size={12} className="animate-spin" />
                              : <CheckCircle2 size={12} />}
                            Confirm Pack
                          </button>
                        )}
                      </div>
                    </div>
                    {taskError?.taskId === task.id && (
                      <div className="bg-red-50 border-t border-red-100 px-4 py-2 text-sm text-red-700">
                        <p className="font-semibold">⚠️ Cannot Start</p>
                        <p className="text-xs mt-0.5">{taskError.message}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Completed */}
          {completedTasks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Packed ✓</p>
              {completedTasks.map(task => {
                const planItem = task.production_plan_items as { products?: { name: string } } | null;
                const product  = planItem?.products;
                return (
                  <div key={task.id} className="bg-white rounded-lg border border-sage-100 shadow-card opacity-70 flex items-center gap-3 px-4 py-3">
                    <CheckCircle2 size={18} className="text-sage-500 flex-shrink-0" />
                    <p className="text-sm font-medium text-gray-600 flex-1">{product?.name}</p>
                    <span className="badge-green text-xs">Packed</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
