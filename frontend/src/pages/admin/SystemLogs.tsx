import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

interface LogEntry {
  id: string; action: string; entity: string | null; entity_id: string | null;
  meta: Record<string, unknown> | null; created_at: string;
  users: { full_name: string; role: string } | null;
}

const ACTION_COLOR: Record<string, string> = {
  LOGIN: 'badge-blue', LOGOUT: 'badge-gray',
  CREATE_USER: 'badge-green', UPDATE_USER: 'badge-amber', DEACTIVATE_USER: 'badge-red',
  CREATE_PRODUCT: 'badge-green', UPDATE_PRODUCT: 'badge-amber', UPDATE_RECIPE: 'badge-orange',
  PLACE_ORDER: 'badge-blue', APPROVE_ORDER: 'badge-green', REJECT_ORDER: 'badge-red',
  GENERATE_PRODUCTION_PLAN: 'badge-purple', ASSIGN_TASKS: 'badge-blue',
  LOW_STOCK_ALERT: 'badge-red',
  TASK_IN_PROGRESS: 'badge-amber', TASK_COMPLETED: 'badge-green',
};

export default function SystemLogs() {
  const [logs, setLogs]   = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal]    = useState(0);
  const [offset, setOffset]  = useState(0);
  const LIMIT = 50;

  const fetchLogs = useCallback(() => {
    setLoading(true);
    api.get(`/reports/logs?limit=${LIMIT}&offset=${offset}`)
      .then(r => { setLogs(r.data.logs); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, [offset]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">System Logs</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} total entries</p>
        </div>
        <button onClick={fetchLogs} className="btn-secondary btn-sm"><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400">Loading logs…</td></tr>
            ) : logs.map(log => (
              <tr key={log.id}>
                <td className="text-gray-400 text-xs whitespace-nowrap">
                  <span title={dayjs(log.created_at).format('YYYY-MM-DD HH:mm:ss')}>
                    {dayjs(log.created_at).fromNow()}
                  </span>
                </td>
                <td>
                  {log.users ? (
                    <div>
                      <p className="text-xs font-medium text-gray-700">{log.users.full_name}</p>
                      <p className="text-xs text-gray-400">{log.users.role}</p>
                    </div>
                  ) : <span className="text-gray-400 text-xs">System</span>}
                </td>
                <td>
                  <span className={ACTION_COLOR[log.action] ?? 'badge-gray'}>
                    {log.action.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="text-xs text-gray-500">
                  {log.entity ?? '—'}
                  {log.entity_id && <span className="text-gray-300 ml-1 font-mono text-xs">{log.entity_id.slice(0,8)}…</span>}
                </td>
                <td className="text-xs text-gray-400 max-w-xs truncate">
                  {log.meta ? JSON.stringify(log.meta) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setOffset(o => Math.max(0, o - LIMIT))} disabled={offset === 0} className="btn-secondary btn-sm">Previous</button>
          <button onClick={() => setOffset(o => o + LIMIT)} disabled={offset + LIMIT >= total} className="btn-secondary btn-sm">Next</button>
        </div>
      </div>
    </div>
  );
}
