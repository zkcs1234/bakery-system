import { useEffect, useState, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  FlameKindling, Loader2, CheckCircle2, PlayCircle, Thermometer,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Timer, Wind, Plus, Minus, CheckCheck, RotateCcw,
  Flame, AlertTriangle, Package, Shapes,
} from 'lucide-react';
import api from '../../lib/api';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { Task } from '../../types';
import ReportIssueButton from '../../components/shared/ReportIssueButton';

dayjs.extend(isoWeek);

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
type WeekTasks = Record<string, Task[]>;

/* Outcome of a single baking load */
interface BakeOutcome {
  good:       number;   // pieces/units that came out OK
  nasunog:    number;   // burned
  hilaw:      number;   // underbaked / raw inside
  depormado:  number;   // misshapen, crushed, broken
  bumagsak:   number;   // collapsed / sunken
  note:       string;
}

interface LoadState {
  loadNumber:       number;
  batches:          number;        // batches in this load
  completedStepIds: string[];
  outcome:          BakeOutcome | null;
  isDone:           boolean;
}

/* ─────────────────────────────────────────────
   Baking steps
───────────────────────────────────────────── */
type BakeStep = {
  id:          string;
  label:       string;
  hint?:       string;
  icon:        LucideIcon;
  durationMin?: number;
};

const BAKE_STEPS: BakeStep[] = [
  { id: 'preheat',  label: 'Preheat oven',         hint: 'Reach target temp before loading — use thermometer', icon: Thermometer, durationMin: 15 },
  { id: 'proof',    label: 'Final proof / rest',    hint: 'Let shaped dough proof in warm spot before baking',   icon: Wind,        durationMin: 20 },
  { id: 'load',     label: 'Load trays into oven',  hint: 'Even spacing — dont crowd; egg wash if required',    icon: Package                    },
  { id: 'bake',     label: 'Bake',                  hint: 'Dont open oven in the first half of bake time',      icon: FlameKindling               },
  { id: 'pull',     label: 'Pull and cool',          hint: 'Transfer to wire rack immediately — log outcomes below', icon: CheckCheck               },
];

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
const TRINIDAD_BRANCH = 'trinidad';

function getWeekDates(anchor: dayjs.Dayjs): dayjs.Dayjs[] {
  const monday = anchor.isoWeekday(1);
  return Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
}

function getBranchName(task: Task): string {
  const ppi = task.production_plan_items as { production_plans?: { branches?: { name?: string }; branch_name?: string }; branch_name?: string } | null;
  return (
    ppi?.production_plans?.branches?.name ??
    ppi?.production_plans?.branch_name ??
    ppi?.branch_name ??
    ''
  ).toLowerCase();
}

function isTrinidad(task: Task): boolean {
  return getBranchName(task).includes(TRINIDAD_BRANCH);
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const rankA = isTrinidad(a) ? (a.is_priority ? 0 : 1) : (a.is_priority ? 2 : 3);
    const rankB = isTrinidad(b) ? (b.is_priority ? 0 : 1) : (b.is_priority ? 2 : 3);
    return rankA - rankB;
  });
}

function emptyOutcome(): BakeOutcome {
  return { good: 0, nasunog: 0, hilaw: 0, depormado: 0, bumagsak: 0, note: '' };
}

function outcomeTotalBad(o: BakeOutcome) {
  return o.nasunog + o.hilaw + o.depormado + o.bumagsak;
}

/* ─────────────────────────────────────────────
   BakingStepTracker
───────────────────────────────────────────── */
interface StepTrackerProps {
  steps:            BakeStep[];
  completedStepIds: string[];
  onToggleStep:     (id: string) => void;
  isToday:          boolean;
  taskStatus:       string;
  ovenTempC:        number | null;
  bakeTimeMin:      number | null;
}

function BakingStepTracker({
  steps, completedStepIds, onToggleStep, isToday, taskStatus, ovenTempC, bakeTimeMin,
}: StepTrackerProps) {
  const canInteract = isToday && taskStatus === 'in_progress';

  return (
    <div className="space-y-1.5 mb-3">
      {steps.map((step, idx) => {
        const isDone   = completedStepIds.includes(step.id);
        const prevDone = idx === 0 || completedStepIds.includes(steps[idx - 1].id);
        const isActive = !isDone && prevDone;
        const Icon     = step.icon;

        /* inject live specs into the bake step */
        const hintText = step.id === 'bake'
          ? [
              step.hint,
              ovenTempC   ? `Target: ${ovenTempC}°C` : null,
              bakeTimeMin ? `Time: ${bakeTimeMin} min` : null,
            ].filter(Boolean).join(' · ')
          : step.hint;

        const duration = step.id === 'bake' && bakeTimeMin ? bakeTimeMin : step.durationMin;

        return (
          <div
            key={step.id}
            onClick={() => canInteract && prevDone && onToggleStep(step.id)}
            className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-all
              ${isDone
                ? 'bg-sage-50 border-sage-100'
                : isActive
                  ? 'bg-red-50/60 border-red-200 shadow-sm'
                  : 'bg-white border-wheat-100 opacity-50'}
              ${canInteract && prevDone ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'}`}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0
              ${isDone
                ? 'bg-sage-500 border-sage-500'
                : isActive
                  ? 'border-red-400 bg-white'
                  : 'border-gray-200 bg-white'}`}
            >
              {isDone
                ? <CheckCircle2 size={12} className="text-white" />
                : <Icon size={11} className={isActive ? 'text-red-500' : 'text-gray-300'} />
              }
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`text-xs font-medium
                  ${isDone ? 'text-sage-700 line-through' : isActive ? 'text-red-800' : 'text-gray-400'}`}>
                  {step.label}
                </p>
                {duration && isActive && (
                  <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-100 rounded px-1.5 py-0.5">
                    <Timer size={9} />~{duration} min
                  </span>
                )}
              </div>
              {hintText && (isActive || isDone) && (
                <p className="text-xs text-gray-400 mt-0.5">{hintText}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   BakeOutcomeLogger — fill in results per load
───────────────────────────────────────────── */
interface OutcomeLoggerProps {
  outcome:       BakeOutcome;
  onChange:      (o: BakeOutcome) => void;
  onSubmit:      () => void;
  submitting:    boolean;
  submitError:   string;
  canSubmit:     boolean;
}

const OUTCOME_FIELDS: Array<{
  key:   keyof Omit<BakeOutcome, 'note'>;
  label: string;
  emoji: string;
  color: string;
  bg:    string;
  border:string;
}> = [
  { key: 'good',      label: 'OK / Good',   emoji: '✓', color: 'text-sage-700',   bg: 'bg-sage-50',    border: 'border-sage-200'   },
  { key: 'nasunog',   label: 'Nasunog',     emoji: '🔥', color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-red-200'    },
  { key: 'hilaw',     label: 'Hilaw',       emoji: '⚠', color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-200'  },
  { key: 'depormado', label: 'Depormado',   emoji: '⬡', color: 'text-orange-700', bg: 'bg-orange-50',  border: 'border-orange-200' },
  { key: 'bumagsak',  label: 'Bumagsak',   emoji: '↓', color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-200' },
];

function BakeOutcomeLogger({ outcome, onChange, onSubmit, submitting, submitError, canSubmit }: OutcomeLoggerProps) {
  const set = (key: keyof Omit<BakeOutcome, 'note'>, val: number) =>
    onChange({ ...outcome, [key]: Math.max(0, val) });

  const totalBad  = outcomeTotalBad(outcome);
  const totalAll  = outcome.good + totalBad;

  return (
    <div className="border border-red-100 bg-red-50/30 rounded-lg px-3 py-2.5 space-y-2.5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Load outcomes — how many pieces?
      </p>

      {/* Outcome counters */}
      <div className="grid grid-cols-1 gap-1.5">
        {OUTCOME_FIELDS.map(({ key, label, emoji, color, bg, border }) => (
          <div key={key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${bg} ${border}`}>
            <span className="text-sm w-5 text-center select-none">{emoji}</span>
            <span className={`flex-1 text-xs font-medium ${color}`}>{label}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => set(key, outcome[key] - 1)}
                className="w-6 h-6 rounded-full border border-white bg-white shadow-sm text-gray-500 flex items-center justify-center hover:bg-gray-50 transition-colors"
              >
                <Minus size={11} />
              </button>
              <input
                type="number"
                min={0}
                value={outcome[key]}
                onChange={e => set(key, parseInt(e.target.value) || 0)}
                className="w-12 text-center text-sm font-bold border border-white bg-white rounded-md py-0.5 focus:outline-none focus:ring-1 focus:ring-red-300"
              />
              <button
                onClick={() => set(key, outcome[key] + 1)}
                className="w-6 h-6 rounded-full border border-white bg-white shadow-sm text-gray-500 flex items-center justify-center hover:bg-gray-50 transition-colors"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Totals summary */}
      {totalAll > 0 && (
        <div className="flex items-center gap-3 px-1 text-xs">
          <span className="text-gray-400">Total: <strong className="text-gray-700">{totalAll}</strong></span>
          <span className="text-sage-600">✓ {outcome.good} good</span>
          {totalBad > 0 && <span className="text-red-600">✗ {totalBad} rejected</span>}
          {totalAll > 0 && (
            <span className="ml-auto font-medium text-gray-500">
              {Math.round((outcome.good / totalAll) * 100)}% yield
            </span>
          )}
        </div>
      )}

      {/* Note */}
      <input
        type="text"
        value={outcome.note}
        onChange={e => onChange({ ...outcome, note: e.target.value })}
        placeholder="Optional note (e.g. oven ran hot, trays rotated late…)"
        className="input w-full text-sm"
      />

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      <button
        onClick={onSubmit}
        disabled={submitting || !canSubmit}
        className={`w-full btn-sm flex items-center justify-center gap-2 font-medium transition-all
          ${canSubmit
            ? 'btn-success'
            : 'bg-gray-100 text-gray-300 cursor-not-allowed rounded-lg border border-gray-200'}`}
      >
        {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={14} />}
        {canSubmit ? 'Log outcomes & complete load' : 'Enter outcome counts first'}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   BatchLoadPlanner — set batches per oven load
───────────────────────────────────────────── */
interface PlannerProps {
  totalBatches:          number;
  batchesPerLoad:        number;
  onChangeBatchesPerLoad:(n: number) => void;
  ovenTempC:             number | null;
  bakeTimeMin:           number | null;
}

function BatchLoadPlanner({ totalBatches, batchesPerLoad, onChangeBatchesPerLoad, ovenTempC, bakeTimeMin }: PlannerProps) {
  const loadCount         = Math.ceil(totalBatches / batchesPerLoad);
  const lastLoadBatches   = totalBatches % batchesPerLoad || batchesPerLoad;

  return (
    <div className="bg-wheat-50 border border-wheat-200 rounded-lg px-4 py-3 space-y-2">
      {/* Oven specs banner */}
      {(ovenTempC || bakeTimeMin) && (
        <div className="flex items-center gap-3 pb-2 border-b border-wheat-100">
          {ovenTempC && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
              <Thermometer size={13} className="text-red-500" />
              {ovenTempC}°C
            </div>
          )}
          {bakeTimeMin && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-700">
              <Timer size={13} className="text-orange-500" />
              {bakeTimeMin} min/load
            </div>
          )}
        </div>
      )}

      {/* Batches per load picker */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-700">Baking plan</p>
          <p className="text-xs text-gray-400">Batches per oven load?</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangeBatchesPerLoad(Math.max(1, batchesPerLoad - 1))}
            className="w-7 h-7 rounded-full border border-wheat-200 bg-white text-gray-500 flex items-center justify-center hover:border-red-300 hover:text-red-700 transition-colors"
          >
            <Minus size={12} />
          </button>
          <div className="w-10 text-center">
            <p className="text-lg font-bold text-red-700 leading-none">{batchesPerLoad}</p>
            <p className="text-xs text-gray-400">per load</p>
          </div>
          <button
            onClick={() => onChangeBatchesPerLoad(Math.min(totalBatches, batchesPerLoad + 1))}
            disabled={batchesPerLoad >= totalBatches}
            className="w-7 h-7 rounded-full border border-wheat-200 bg-white text-gray-500 flex items-center justify-center hover:border-red-300 hover:text-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Load breakdown pills */}
      <div className="flex items-stretch gap-2">
        {Array.from({ length: loadCount }, (_, i) => {
          const isLast      = i === loadCount - 1;
          const batchesHere = isLast ? lastLoadBatches : batchesPerLoad;
          return (
            <div key={i} className="flex-1 bg-white border border-wheat-100 rounded-md px-2 py-1.5 text-center min-w-0">
              <p className="text-xs font-semibold text-red-700">L{i + 1}</p>
              <p className="text-xs text-gray-400 truncate">{batchesHere}×</p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 text-center">
        {loadCount} oven load{loadCount > 1 ? 's' : ''} · {totalBatches} total batch{totalBatches > 1 ? 'es' : ''}
        {bakeTimeMin && loadCount > 1 ? ` · ~${bakeTimeMin * loadCount} min total bake time` : ''}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   BakingLoadPanel — one load's full UI
───────────────────────────────────────────── */
interface LoadPanelProps {
  load:             LoadState;
  totalLoads:       number;
  ovenTempC:        number | null;
  bakeTimeMin:      number | null;
  taskId:           string;
  isToday:          boolean;
  taskStatus:       string;
  onToggleStep:     (loadNum: number, stepId: string) => void;
  onCompleteLoad:   (loadNum: number, outcome: BakeOutcome) => Promise<void>;
}

function BakingLoadPanel({
  load, totalLoads, ovenTempC, bakeTimeMin,
  taskId, isToday, taskStatus,
  onToggleStep, onCompleteLoad,
}: LoadPanelProps) {
  const [outcome, setOutcome]       = useState<BakeOutcome>(emptyOutcome);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const allStepsDone  = BAKE_STEPS.every(s => load.completedStepIds.includes(s.id));
  const pullDone      = load.completedStepIds.includes('pull');
  const canLog        = pullDone && isToday && taskStatus === 'in_progress';
  const canSubmit     = canLog && (outcome.good + outcomeTotalBad(outcome)) > 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      /* POST bake outcome to API */
      await api.post(`/tasks/${taskId}/bake-outcome`, {
        load_number: load.loadNumber,
        batches:     load.batches,
        ...outcome,
      });
      await onCompleteLoad(load.loadNumber, outcome);
    } catch (e: unknown) {
      setSubmitError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to log outcome'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`rounded-lg border overflow-hidden
      ${load.isDone ? 'border-sage-100 bg-sage-50/30' : 'border-red-200 bg-white shadow-sm'}`}
    >
      {/* Load header */}
      <div className={`flex items-center gap-3 px-3 py-2.5
        ${load.isDone ? 'bg-sage-50/60' : 'bg-red-50/50'}`}
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold
          ${load.isDone ? 'bg-sage-500 text-white' : 'bg-red-500 text-white'}`}
        >
          {load.isDone ? <CheckCircle2 size={14} /> : load.loadNumber}
        </div>
        <div className="flex-1">
          <p className={`text-xs font-semibold ${load.isDone ? 'text-sage-700' : 'text-red-800'}`}>
            Load {load.loadNumber} of {totalLoads}
          </p>
          <p className="text-xs text-gray-400">
            {load.batches} batch{load.batches > 1 ? 'es' : ''} this load
            {load.isDone && load.outcome && (() => {
              const total = load.outcome.good + outcomeTotalBad(load.outcome);
              const yield_ = total ? Math.round((load.outcome.good / total) * 100) : 0;
              return ` · ${load.outcome.good}/${total} good (${yield_}% yield)`;
            })()}
          </p>
        </div>
        {load.isDone && load.outcome && outcomeTotalBad(load.outcome) > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 border border-orange-100 rounded-full px-2 py-0.5">
            <AlertTriangle size={9} />
            {outcomeTotalBad(load.outcome)} rejected
          </span>
        )}
        {load.isDone && (!load.outcome || outcomeTotalBad(load.outcome) === 0) && (
          <span className="badge-green text-xs">Done</span>
        )}
      </div>

      {/* Load body */}
      {!load.isDone && (
        <div className="px-3 py-3 space-y-3">
          {/* Steps */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Baking steps</p>
            <BakingStepTracker
              steps={BAKE_STEPS}
              completedStepIds={load.completedStepIds}
              onToggleStep={id => onToggleStep(load.loadNumber, id)}
              isToday={isToday}
              taskStatus={taskStatus}
              ovenTempC={ovenTempC}
              bakeTimeMin={bakeTimeMin}
            />
          </div>

          {/* Outcome logger — unlocks after "Pull and cool" step */}
          {pullDone ? (
            <BakeOutcomeLogger
              outcome={outcome}
              onChange={setOutcome}
              onSubmit={handleSubmit}
              submitting={submitting}
              submitError={submitError}
              canSubmit={canSubmit}
            />
          ) : (
            <div className="text-xs text-gray-400 italic text-center py-2 border border-dashed border-wheat-200 rounded-lg">
              Outcome logging unlocks after "Pull and cool"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   TaskCard — fully revised with load-based baking
───────────────────────────────────────────── */
interface TaskCardProps {
  task:           Task;
  isToday:        boolean;
  updating:       string | null;
  allTasks:       Task[];
  onUpdateStatus: (id: string, status: 'in_progress' | 'completed') => void;
}

function TaskCard({ task, isToday, updating, allTasks, onUpdateStatus }: TaskCardProps) {
  const [expanded, setExpanded]           = useState(false);
  const [batchesPerLoad, setBatchesPerLoad] = useState(1);
  const [loads, setLoads]                 = useState<LoadState[]>([]);
  const [started, setStarted]             = useState(false);

  const planItem  = task.production_plan_items as {
    products?:        { name: string; oven_temp_c: number | null; bake_time_min: number | null };
    production_plans?: { branches?: { name?: string }; branch_name?: string };
    branch_name?:     string;
  } | null;
  const product    = planItem?.products;
  const ovenTempC  = product?.oven_temp_c  ?? null;
  const bakeTimeMin= product?.bake_time_min?? null;
  const trinidad   = isTrinidad(task);

  /* mixer gate */
  const planTasks    = (task.production_plan_items as { tasks?: Array<{ task_role?: string; status?: string }> } | null)?.tasks ?? [];
  const mixerTasks   = planTasks.filter(t => t.task_role === 'mixing');
  const mixerNotDone = mixerTasks.length > 0 && mixerTasks.some(t => t.status !== 'completed');

  const branchLabel = (() => {
    const ppi = task.production_plan_items as { production_plans?: { branches?: { name?: string }; branch_name?: string }; branch_name?: string } | null;
    return ppi?.production_plans?.branches?.name ?? ppi?.production_plans?.branch_name ?? ppi?.branch_name ?? null;
  })();

  /* build load states */
  const initLoads = (bpl: number): LoadState[] => {
    const total  = task.batches_assigned;
    const count  = Math.ceil(total / bpl);
    return Array.from({ length: count }, (_, i) => {
      const isLast  = i === count - 1;
      const batches = isLast ? (total % bpl || bpl) : bpl;
      return { loadNumber: i + 1, batches, completedStepIds: [], outcome: null, isDone: false };
    });
  };

  const handleStartBaking = async () => {
    if (!isToday || mixerNotDone) return;
    await onUpdateStatus(task.id, 'in_progress');
    setLoads(initLoads(batchesPerLoad));
    setStarted(true);
  };

  const handleToggleStep = (loadNum: number, stepId: string) => {
    setLoads(prev => prev.map(l => {
      if (l.loadNumber !== loadNum) return l;
      const already = l.completedStepIds.includes(stepId);
      return {
        ...l,
        completedStepIds: already
          ? l.completedStepIds.filter(id => id !== stepId)
          : [...l.completedStepIds, stepId],
      };
    }));
  };

  const handleCompleteLoad = async (loadNum: number, outcome: BakeOutcome) => {
    const updatedLoads = loads.map(l =>
      l.loadNumber === loadNum ? { ...l, isDone: true, outcome } : l
    );
    setLoads(updatedLoads);
    /* all loads done → complete task */
    if (updatedLoads.every(l => l.isDone)) {
      await onUpdateStatus(task.id, 'completed');
    }
  };

  const handleResetPlan = () => { setStarted(false); setLoads([]); };

  const doneLoads     = loads.filter(l => l.isDone).length;
  const currentIdx    = loads.findIndex(l => !l.isDone);

  /* aggregate yield across all completed loads */
  const yieldSummary = loads
    .filter(l => l.isDone && l.outcome)
    .reduce(
      (acc, l) => {
        const o = l.outcome!;
        acc.good      += o.good;
        acc.nasunog   += o.nasunog;
        acc.hilaw     += o.hilaw;
        acc.depormado += o.depormado;
        acc.bumagsak  += o.bumagsak;
        return acc;
      },
      { good: 0, nasunog: 0, hilaw: 0, depormado: 0, bumagsak: 0 }
    );
  const yieldTotal = yieldSummary.good + outcomeTotalBad(yieldSummary as BakeOutcome);

  return (
    <div className={`border-b border-wheat-100 last:border-b-0
      ${task.is_priority ? 'bg-orange-50/40' : ''}
      ${task.status === 'completed' ? 'opacity-70' : ''}`}
    >
      {/* Task header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
          ${task.status === 'completed'   ? 'bg-sage-100 text-sage-600'
          : task.status === 'in_progress' ? 'bg-red-100 text-red-600'
          : 'bg-gray-100 text-gray-400'}`}
        >
          {task.status === 'completed' ? <CheckCircle2 size={18} /> : <FlameKindling size={18} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800 text-sm">{product?.name ?? 'Unknown'}</p>
            {task.is_priority && <span className="badge-orange text-xs animate-pulse">🔥 PRIORITY</span>}
            {trinidad && (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold bg-crust-50 text-crust-700 border border-crust-200 rounded-full px-2 py-0.5">
                Trinidad
              </span>
            )}
            <span className={`badge text-xs
              ${task.status === 'completed'   ? 'badge-green'
              : task.status === 'in_progress' ? 'badge-red'
              : 'badge-gray'}`}
            >
              {task.status.replace('_', ' ')}
            </span>
          </div>

          {/* Oven specs row */}
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Thermometer size={11} />
              {ovenTempC ? `${ovenTempC}°C` : '—'}
            </span>
            <span className="flex items-center gap-1">
              <Timer size={11} />
              {bakeTimeMin ? `${bakeTimeMin} min` : '—'}
            </span>
            <span className="flex items-center gap-1">
              <Shapes size={11} />
              {task.batches_assigned} batch{task.batches_assigned > 1 ? 'es' : ''}
            </span>
            {branchLabel && <span className="text-gray-300">· {branchLabel}</span>}
          </div>

          {/* Live load progress + yield when in-progress */}
          {task.status === 'in_progress' && started && loads.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              Load {doneLoads + 1}/{loads.length}
              {yieldTotal > 0 && ` · ${yieldSummary.good}/${yieldTotal} good so far`}
            </p>
          )}
        </div>

        {/* Load progress dots + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {task.status === 'in_progress' && started && loads.length > 0 && (
            <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-full px-2 py-1">
              {loads.map((l, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors
                    ${l.isDone ? 'bg-sage-500' : i === currentIdx ? 'bg-red-500' : 'bg-gray-200'}`}
                />
              ))}
            </div>
          )}
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-wheat-100 px-4 py-3 bg-wheat-50/50 space-y-3">

          {/* ── PENDING: planner ── */}
          {task.status === 'pending' && (
            <>
              <BatchLoadPlanner
                totalBatches={task.batches_assigned}
                batchesPerLoad={batchesPerLoad}
                onChangeBatchesPerLoad={setBatchesPerLoad}
                ovenTempC={ovenTempC}
                bakeTimeMin={bakeTimeMin}
              />
              {mixerNotDone && (
                <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} />
                  Waiting for mixer to complete this product before baking
                </div>
              )}
              <button
                onClick={e => { e.stopPropagation(); handleStartBaking(); }}
                disabled={updating === task.id || !isToday || mixerNotDone}
                title={mixerNotDone ? 'Waiting for mixer' : !isToday ? 'Today only' : undefined}
                className="btn-secondary btn-sm w-full flex items-center justify-center gap-2"
              >
                {updating === task.id
                  ? <Loader2 size={12} className="animate-spin" />
                  : <PlayCircle size={12} />}
                Start baking · {Math.ceil(task.batches_assigned / batchesPerLoad)} load{Math.ceil(task.batches_assigned / batchesPerLoad) > 1 ? 's' : ''}
              </button>
            </>
          )}

          {/* ── IN PROGRESS: loads ── */}
          {task.status === 'in_progress' && started && (
            <>
              <div className="space-y-2">
                {loads.map((load, idx) => {
                  /* Done loads — compact summary */
                  if (load.isDone) {
                    const o     = load.outcome!;
                    const total = o.good + outcomeTotalBad(o);
                    const yield_= total ? Math.round((o.good / total) * 100) : 0;
                    const hasBad= outcomeTotalBad(o) > 0;
                    return (
                      <div key={load.loadNumber}
                        className="rounded-lg border border-sage-100 bg-sage-50/40 px-3 py-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-5 h-5 rounded-full bg-sage-500 flex items-center justify-center flex-shrink-0">
                            <CheckCircle2 size={11} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-sage-700">
                              Load {load.loadNumber} — {load.batches} batch{load.batches > 1 ? 'es' : ''}
                            </p>
                            <p className="text-xs text-gray-500">
                              {o.good}/{total} good · {yield_}% yield
                              {o.nasunog  > 0 && ` · ${o.nasunog} nasunog 🔥`}
                              {o.hilaw    > 0 && ` · ${o.hilaw} hilaw ⚠`}
                              {o.depormado> 0 && ` · ${o.depormado} depormado`}
                              {o.bumagsak > 0 && ` · ${o.bumagsak} bumagsak`}
                            </p>
                          </div>
                          {hasBad && (
                            <Flame size={13} className="text-orange-400 flex-shrink-0" />
                          )}
                        </div>
                        {o.note && (
                          <p className="text-xs text-gray-400 italic mt-1 pl-7">{o.note}</p>
                        )}
                      </div>
                    );
                  }

                  /* Waiting loads */
                  if (idx !== currentIdx) {
                    return (
                      <div key={load.loadNumber}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-wheat-100 bg-gray-50/50 opacity-50"
                      >
                        <div className="w-5 h-5 rounded-full border-2 border-gray-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-gray-400">{load.loadNumber}</span>
                        </div>
                        <p className="text-xs text-gray-400">
                          Load {load.loadNumber} — {load.batches} batch{load.batches > 1 ? 'es' : ''} · waiting
                        </p>
                      </div>
                    );
                  }

                  /* Active load */
                  return (
                    <BakingLoadPanel
                      key={load.loadNumber}
                      load={load}
                      totalLoads={loads.length}
                      ovenTempC={ovenTempC}
                      bakeTimeMin={bakeTimeMin}
                      taskId={task.id}
                      isToday={isToday}
                      taskStatus={task.status}
                      onToggleStep={handleToggleStep}
                      onCompleteLoad={handleCompleteLoad}
                    />
                  );
                })}
              </div>

              {/* Reset */}
              <button
                onClick={e => { e.stopPropagation(); handleResetPlan(); }}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mx-auto"
              >
                <RotateCcw size={11} />
                Reset baking plan
              </button>
            </>
          )}

          {/* ── COMPLETED: yield summary + report ── */}
          {task.status === 'completed' && (
            <div className="space-y-3">
              {/* Yield summary card */}
              {yieldTotal > 0 && (
                <div className="bg-white border border-wheat-100 rounded-lg px-3 py-2.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Final yield summary
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <p className="text-xl font-bold text-sage-600">{yieldSummary.good}</p>
                      <p className="text-xs text-gray-400">good</p>
                    </div>
                    <div className="flex-1 h-3 rounded-full overflow-hidden bg-gray-100 flex">
                      <div
                        className="bg-sage-400 transition-all"
                        style={{ width: `${(yieldSummary.good / yieldTotal) * 100}%` }}
                      />
                      {outcomeTotalBad(yieldSummary as BakeOutcome) > 0 && (
                        <div
                          className="bg-red-300"
                          style={{ width: `${(outcomeTotalBad(yieldSummary as BakeOutcome) / yieldTotal) * 100}%` }}
                        />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-gray-700">
                        {Math.round((yieldSummary.good / yieldTotal) * 100)}%
                      </p>
                      <p className="text-xs text-gray-400">yield</p>
                    </div>
                  </div>
                  {/* Breakdown of bad */}
                  {outcomeTotalBad(yieldSummary as BakeOutcome) > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-wheat-100">
                      {yieldSummary.nasunog   > 0 && <span className="text-xs text-red-600 bg-red-50 rounded px-1.5 py-0.5">🔥 {yieldSummary.nasunog} nasunog</span>}
                      {yieldSummary.hilaw     > 0 && <span className="text-xs text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">⚠ {yieldSummary.hilaw} hilaw</span>}
                      {yieldSummary.depormado > 0 && <span className="text-xs text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">⬡ {yieldSummary.depormado} depormado</span>}
                      {yieldSummary.bumagsak  > 0 && <span className="text-xs text-purple-600 bg-purple-50 rounded px-1.5 py-0.5">↓ {yieldSummary.bumagsak} bumagsak</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Issue report */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400 italic">Report a problem with this batch</p>
                <ReportIssueButton planItemId={task.plan_item_id} taskId={task.id} productName={product?.name ?? ''} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   BakerDashboard — outer shell (unchanged structure)
───────────────────────────────────────────── */
export default function BakerDashboard() {
  const today = dayjs().format('YYYY-MM-DD');

  const [anchor, setAnchor] = useState(() => dayjs());
  const weekDates = getWeekDates(anchor);
  const weekStart = weekDates[0];
  const weekEnd   = weekDates[6];

  const [weekTasks, setWeekTasks]     = useState<WeekTasks>({});
  const [weekLoading, setWeekLoading] = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [expanded, setExpanded]       = useState<string | null>(today);
  const [updating, setUpdating]       = useState<string | null>(null);

  const fetchWeek = useCallback(async (dates: dayjs.Dayjs[]) => {
    setWeekLoading(true);
    setLoadError('');
    try {
      const results = await Promise.all(
        dates.map(d =>
          api.get<{ tasks: Task[] }>(`/tasks/my?date=${d.format('YYYY-MM-DD')}`)
            .then(r => ({ date: d.format('YYYY-MM-DD'), tasks: r.data.tasks ?? [] }))
            .catch(() => ({ date: d.format('YYYY-MM-DD'), tasks: [] }))
        )
      );
      const map: WeekTasks = {};
      results.forEach(({ date, tasks }) => { map[date] = sortTasks(tasks); });
      setWeekTasks(map);
    } catch {
      setLoadError('Failed to load tasks for this week');
    } finally {
      setWeekLoading(false);
    }
  }, []);

  useEffect(() => { fetchWeek(weekDates); }, [anchor]);

  const shiftWeek = (dir: 1 | -1) => {
    setAnchor(a => a.add(dir * 7, 'day'));
    setExpanded(null);
  };

  const goToday = () => {
    setAnchor(dayjs());
    setExpanded(today);
  };

  const updateStatus = async (taskId: string, status: 'in_progress' | 'completed') => {
    setUpdating(taskId);
    setLoadError('');
    try {
      await api.patch(`/tasks/${taskId}/status`, { status });
      const r = await api.get<{ tasks: Task[] }>(`/tasks/my?date=${today}`);
      setWeekTasks(prev => ({ ...prev, [today]: sortTasks(r.data.tasks ?? []) }));
    } catch (e: unknown) {
      setLoadError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to update task status'
      );
    } finally {
      setUpdating(null);
    }
  };

  const toggleExpanded = (date: string) =>
    setExpanded(prev => (prev === date ? null : date));

  const todayTasks = weekTasks[today] ?? [];
  const doneCount  = todayTasks.filter(t => t.status === 'completed').length;
  const totalCount = todayTasks.length;
  const progress   = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Baking Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {weekStart.format('MMM D')} – {weekEnd.format('MMM D, YYYY')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftWeek(-1)} className="btn-secondary btn-sm flex items-center gap-1">
            <ChevronLeft size={14} /> Prev
          </button>
          <button onClick={goToday} className="btn-secondary btn-sm">Today</button>
          <button onClick={() => shiftWeek(1)} className="btn-secondary btn-sm flex items-center gap-1">
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {loadError && <div className="shortage-alert">{loadError}</div>}

      <div className="card-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Today's Oven Progress</span>
          <span className="text-sm font-bold text-red-700">{doneCount}/{totalCount}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill bg-red-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-1">{progress}% complete</p>
      </div>

      {weekLoading ? (
        <div className="space-y-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-12 bg-white rounded-lg animate-pulse border border-wheat-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {weekDates.map(day => {
            const dateStr  = day.format('YYYY-MM-DD');
            const isToday  = dateStr === today;
            const isPast   = day.isBefore(dayjs(), 'day');
            const dayTasks = weekTasks[dateStr] ?? [];
            const isOpen   = expanded === dateStr;
            const dayDone  = dayTasks.filter(t => t.status === 'completed').length;
            const allDone  = dayTasks.length > 0 && dayDone === dayTasks.length;

            if (isPast) {
              if (dayTasks.length === 0) return null;
              return (
                <div key={dateStr} className="rounded-lg border border-wheat-100 bg-gray-50/60 px-4 py-2.5 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${allDone ? 'bg-sage-400' : 'bg-amber-300'}`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-400 font-medium">{day.format('ddd, MMM D')}</span>
                  </div>
                  {allDone ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-sage-600 bg-sage-50 border border-sage-100 rounded-full px-2.5 py-0.5">
                      <CheckCircle2 size={10} /> {dayDone}/{dayTasks.length} complete
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-0.5">
                      <FlameKindling size={10} /> {dayDone}/{dayTasks.length} done
                    </span>
                  )}
                </div>
              );
            }

            return (
              <div key={dateStr} className={`bg-white rounded-lg border shadow-card overflow-hidden
                ${isToday ? 'border-red-400' : 'border-wheat-100'}`}
              >
                <div
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${isToday ? 'bg-wheat-50' : 'bg-white'}`}
                  onClick={() => toggleExpanded(dateStr)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 text-sm">{day.format('dddd')}</p>
                      {isToday && <span className="badge-orange text-xs">TODAY</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{day.format('MMMM D, YYYY')}</p>
                  </div>
                  <div className="text-xs text-gray-400">
                    {dayTasks.length === 0
                      ? <span className="text-gray-300">No tasks</span>
                      : <span>{dayDone}/{dayTasks.length}</span>}
                  </div>
                  {isOpen ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                </div>

                {isOpen && (
                  <div className="border-t border-wheat-100">
                    {dayTasks.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-gray-400">
                        <FlameKindling size={24} className="mx-auto mb-2 text-gray-300" />
                        No baking tasks for {day.format('MMMM D, YYYY')}
                      </div>
                    ) : (
                      <div className="space-y-px">
                        {(() => {
                          const trinidadTasks    = dayTasks.filter(isTrinidad);
                          const nonTrinidadTasks = dayTasks.filter(t => !isTrinidad(t));
                          return (
                            <>
                              {trinidadTasks.length > 0 && (
                                <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                                  <span className="text-xs font-semibold text-red-600 uppercase tracking-widest">Trinidad — Bake first</span>
                                  <div className="flex-1 h-px bg-red-100" />
                                </div>
                              )}
                              {trinidadTasks.map(task => (
                                <TaskCard key={task.id} task={task} isToday={isToday} updating={updating} allTasks={dayTasks} onUpdateStatus={updateStatus} />
                              ))}
                              {nonTrinidadTasks.length > 0 && (
                                <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Other branches</span>
                                  <div className="flex-1 h-px bg-gray-100" />
                                </div>
                              )}
                              {nonTrinidadTasks.map(task => (
                                <TaskCard key={task.id} task={task} isToday={isToday} updating={updating} allTasks={dayTasks} onUpdateStatus={updateStatus} />
                              ))}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}