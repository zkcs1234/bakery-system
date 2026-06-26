import { useEffect, useState, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Blend, Loader2, CheckCircle2, PlayCircle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  AlertTriangle, X, Plus, Minus, FlaskConical,
  Droplets, Timer, Wind, CheckCheck, RotateCcw,
} from 'lucide-react';
import ReportIssueButton from '../../components/shared/ReportIssueButton';
import api from '../../lib/api';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import type { Task } from '../../types';
import { DOUGH_TYPE_LABELS } from '../../types';

dayjs.extend(isoWeek);

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
interface VarianceEntry {
  ingredient_id: string;
  ingredient_name: string;
  type: 'over' | 'short';
  amount_g: number;
  note: string;
}

type WeekTasks = Record<string, Task[]>;

/* ─────────────────────────────────────────────
   Mixing process steps per dough type
   Steps reflect actual bakery mixing workflow.
   Each step has an icon, label, and optional hint.
───────────────────────────────────────────── */
type MixStep = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  durationMin?: number; // suggested minutes, for display only
};

const BASE_MIX_STEPS: MixStep[] = [
  { id: 'weigh_dry',  label: 'Weigh dry ingredients',  hint: 'Flour, salt, sugar, milk powder, yeast', icon: FlaskConical },
  { id: 'weigh_wet',  label: 'Weigh wet ingredients',  hint: 'Water, milk, eggs, butter, oil',         icon: Droplets    },
  { id: 'mix',        label: 'Mix to shaggy dough',    hint: 'Combine all — no dry pockets',           icon: Blend,      durationMin: 3  },
  { id: 'knead',      label: 'Knead / develop gluten', hint: 'Windowpane test before stopping',        icon: Wind,       durationMin: 10 },
  { id: 'done',       label: 'Round complete',          hint: 'Check dough temp, shape into ball',      icon: CheckCheck  },
];

const TANGZHONG_STEPS: MixStep[] = [
  { id: 'tangzhong',  label: 'Cook tangzhong starter', hint: 'Water + milk + bread flour — stir until thick paste, cool ≥15 min', icon: FlaskConical, durationMin: 15 },
  ...BASE_MIX_STEPS,
];

const BATTER_STEPS: MixStep[] = [
  { id: 'weigh_dry',  label: 'Weigh dry ingredients',  hint: 'Flour, leaveners, sugar, spices',        icon: FlaskConical },
  { id: 'weigh_wet',  label: 'Weigh wet ingredients',  hint: 'Eggs, oil/butter, liquids',              icon: Droplets    },
  { id: 'mix',        label: 'Fold to just combined',  hint: 'Do NOT overmix — a few lumps are fine',  icon: Blend,      durationMin: 2  },
  { id: 'done',       label: 'Round complete',          hint: 'Pour into molds promptly',               icon: CheckCheck  },
];

function getStepsForDoughType(doughType: string): MixStep[] {
  if (doughType === 'tangzhong')            return TANGZHONG_STEPS;
  if (doughType === 'batter_quick_mix')     return BATTER_STEPS;
  return BASE_MIX_STEPS;
}

/* ─────────────────────────────────────────────
   MixingRound state — held locally per TaskCard
───────────────────────────────────────────── */
interface RoundState {
  roundNumber: number;
  batches: number;          // batches in THIS round
  completedStepIds: string[];
  variances: VarianceEntry[];
  isDone: boolean;
}

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function getWeekDates(anchor: dayjs.Dayjs): dayjs.Dayjs[] {
  const monday = anchor.isoWeekday(1);
  return Array.from({ length: 7 }, (_, i) => monday.add(i, 'day'));
}

function getDoughType(task: Task): string {
  const planItem = task.production_plan_items as { products?: { dough_type: string } } | null;
  return planItem?.products?.dough_type ?? 'other';
}

function groupByDough(tasks: Task[]): Record<string, Task[]> {
  return tasks.reduce<Record<string, Task[]>>((acc, task) => {
    const dt = getDoughType(task);
    if (!acc[dt]) acc[dt] = [];
    acc[dt].push(task);
    return acc;
  }, {});
}

/* ─────────────────────────────────────────────
   IngredientRow — per-round ingredient display + variance logging
───────────────────────────────────────────── */
interface IngRowProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ing: any;
  taskId: string;
  batches: number;        // batches for THIS round
  isToday: boolean;
  taskStatus: string;
  onVarianceLogged: (v: VarianceEntry) => void;
}

function IngredientRow({ ing, taskId, batches, isToday, taskStatus, onVarianceLogged }: IngRowProps) {
  const [showForm, setShowForm]       = useState(false);
  const [varType, setVarType]         = useState<'over' | 'short'>('over');
  const [varAmount, setVarAmount]     = useState('');
  const [varNote, setVarNote]         = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [submitted, setSubmitted]     = useState<VarianceEntry | null>(null);
  const [submitError, setSubmitError] = useState('');

  const amountUnit = ing.amount_unit?.trim() ? ing.amount_unit.trim() : '';

  const decimalToMixed = (value: number, maxDen = 16) => {
    if (!isFinite(value)) return String(value);
    const sign = value < 0 ? -1 : 1;
    value = Math.abs(value);
    const whole = Math.floor(value);
    const frac = value - whole;
    if (frac < 1e-9) return (sign * whole).toString();
    let best = { num: 0, den: 1, err: Infinity };
    for (let den = 1; den <= maxDen; den++) {
      const num = Math.round(frac * den);
      const err = Math.abs(frac - num / den);
      if (err < best.err) best = { num, den, err };
      if (err === 0) break;
    }
    const g = (a: number, b: number): number => b === 0 ? a : g(b, a % b);
    let num = best.num; let den = best.den;
    const gg = g(num, den);
    if (gg > 0) { num = Math.floor(num / gg); den = Math.floor(den / gg); }
    const parts = [];
    if (whole > 0) parts.push(String(whole));
    if (num > 0) parts.push(`${num}/${den}`);
    const out = parts.join(' ');
    return sign < 0 ? `-${out}` : out || '0';
  };

  const perGramLabel    = ing.amount_g != null ? `${ing.amount_g}g` : '';
  const perDisplayLabel = ing.amount_display
    ? `${ing.amount_display}${amountUnit ? ` ${amountUnit}` : ''}`
    : ing.amount_value != null && amountUnit
      ? `${decimalToMixed(ing.amount_value)}${amountUnit ? ` ${amountUnit}` : ''}`
      : '';

  const gramTotal = ing.total_amount_g != null ? ing.total_amount_g : (ing.amount_g != null ? ing.amount_g * batches : null);
  const totalGramLabel = gramTotal != null
    ? (gramTotal >= 1000 ? `${(gramTotal / 1000).toFixed(3)} kg` : `${gramTotal.toFixed(1)} g`)
    : '';

  const totalDisplayValue = ing.amount_value != null ? ing.amount_value * batches : null;
  const totalDisplayLabel = totalDisplayValue != null
    ? `${decimalToMixed(totalDisplayValue)}${amountUnit ? ` ${amountUnit}` : ''}`
    : (ing.amount_display ? `${ing.amount_display} × ${batches}` : '');

  const perCombined   = perDisplayLabel && perGramLabel ? `${perDisplayLabel} (${perGramLabel})` : perDisplayLabel || perGramLabel || '';
  const totalCombined = totalDisplayLabel && totalGramLabel ? `${totalDisplayLabel} (${totalGramLabel})` : totalDisplayLabel || totalGramLabel || '';

  const canLog = isToday && taskStatus === 'in_progress';

  const handleSubmit = async () => {
    const grams = parseFloat(varAmount);
    if (!grams || grams <= 0) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post(`/tasks/${taskId}/variance`, {
        ingredient_id:   ing.ingredients?.id,
        ingredient_name: ing.ingredients?.name,
        type:            varType,
        amount_g:        grams,
        note:            varNote.trim(),
      });
      const v: VarianceEntry = {
        ingredient_id:   ing.ingredients?.id,
        ingredient_name: ing.ingredients?.name,
        type:            varType,
        amount_g:        grams,
        note:            varNote.trim(),
      };
      setSubmitted(v);
      onVarianceLogged(v);
      setShowForm(false);
      setVarAmount('');
      setVarNote('');
    } catch (e: unknown) {
      setSubmitError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to log variance'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-wheat-100 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-700">{ing.ingredients?.name}</p>
          {ing.notes && <p className="text-xs text-gray-400 italic">{ing.notes}</p>}
          {ing.is_optional && <p className="text-xs text-gray-400">optional</p>}
          {submitted && (
            <span className={`inline-flex items-center gap-1 mt-1 text-xs font-medium rounded-full px-2 py-0.5
              ${submitted.type === 'over'
                ? 'bg-orange-50 text-orange-600 border border-orange-100'
                : 'bg-red-50 text-red-600 border border-red-100'}`}
            >
              <AlertTriangle size={9} />
              {submitted.type === 'over' ? 'Over' : 'Short'} by {submitted.amount_g}g
              {submitted.note ? ` · ${submitted.note}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-bold text-crust-700 font-mono">{totalCombined || '—'}</p>
            <p className="text-xs text-gray-400">{perCombined || '—'} × {batches}</p>
          </div>
          {canLog && !submitted && (
            <button
              onClick={() => setShowForm(v => !v)}
              className={`btn-xs flex items-center gap-1 flex-shrink-0 transition-colors
                ${showForm
                  ? 'btn-secondary text-gray-500'
                  : 'border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-md px-2 py-1 text-sm font-medium'}`}
              title="Log mixing discrepancy"
            >
              {showForm ? <X size={11} /> : <AlertTriangle size={11} />}
              {showForm ? 'Cancel' : 'Log issue'}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="border-t border-orange-100 bg-orange-50/60 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setVarType('over')}
              className={`flex-1 text-sm font-medium py-1.5 rounded-md border transition-colors
                ${varType === 'over' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-wheat-100 hover:border-orange-200'}`}
            >Over</button>
            <button
              onClick={() => setVarType('short')}
              className={`flex-1 text-sm font-medium py-1.5 rounded-md border transition-colors
                ${varType === 'short' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-500 border-wheat-100 hover:border-red-200'}`}
            >Short</button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="number" min="0" step="0.1" value={varAmount}
                onChange={e => setVarAmount(e.target.value)}
                placeholder="Amount" className="input w-full pr-7 text-sm"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">g</span>
            </div>
            <input
              type="text" value={varNote}
              onChange={e => setVarNote(e.target.value)}
              placeholder="Reason / note (optional)" className="input flex-[2] text-sm"
            />
          </div>
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <button
            onClick={handleSubmit}
            disabled={submitting || !varAmount || parseFloat(varAmount) <= 0}
            className="btn-secondary btn-xs w-full flex items-center justify-center gap-1"
          >
            {submitting && <Loader2 size={11} className="animate-spin" />}
            Submit log
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MixingStepTracker — step checklist for one round
───────────────────────────────────────────── */
interface StepTrackerProps {
  steps: MixStep[];
  completedStepIds: string[];
  onToggleStep: (id: string) => void;
  isToday: boolean;
  taskStatus: string;
}

function MixingStepTracker({ steps, completedStepIds, onToggleStep, isToday, taskStatus }: StepTrackerProps) {
  const canInteract = isToday && taskStatus === 'in_progress';

  return (
    <div className="space-y-1.5 mb-3">
      {steps.map((step, idx) => {
        const isDone     = completedStepIds.includes(step.id);
        const prevDone   = idx === 0 || completedStepIds.includes(steps[idx - 1].id);
        const isActive   = !isDone && prevDone;
        const Icon       = step.icon;

        return (
          <div
            key={step.id}
            onClick={() => canInteract && prevDone && onToggleStep(step.id)}
            className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-all
              ${isDone
                ? 'bg-sage-50 border-sage-100'
                : isActive
                  ? 'bg-amber-50/60 border-amber-200 shadow-sm'
                  : 'bg-white border-wheat-100 opacity-50'}
              ${canInteract && prevDone ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'}`}
          >
            {/* Step icon / check circle */}
            <div className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0
              ${isDone
                ? 'bg-sage-500 border-sage-500'
                : isActive
                  ? 'border-amber-400 bg-white'
                  : 'border-gray-200 bg-white'}`}
            >
              {isDone
                ? <CheckCircle2 size={12} className="text-white" />
                : <Icon size={11} className={isActive ? 'text-amber-500' : 'text-gray-300'} />
              }
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`text-xs font-medium ${isDone ? 'text-sage-700 line-through' : isActive ? 'text-amber-800' : 'text-gray-400'}`}>
                  {step.label}
                </p>
                {step.durationMin && isActive && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-100 rounded px-1.5 py-0.5">
                    <Timer size={9} />~{step.durationMin} min
                  </span>
                )}
              </div>
              {step.hint && (isActive || isDone) && (
                <p className="text-xs text-gray-400 mt-0.5">{step.hint}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MixingRoundPanel — one round's full UI
───────────────────────────────────────────── */
interface RoundPanelProps {
  round: RoundState;
  totalRounds: number;
  steps: MixStep[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ingredientList: any[];
  doughType: string;
  taskId: string;
  isToday: boolean;
  taskStatus: string;
  onToggleStep: (roundNum: number, stepId: string) => void;
  onVarianceLogged: (roundNum: number, v: VarianceEntry) => void;
  onCompleteRound: (roundNum: number) => void;
}

function MixingRoundPanel({
  round, totalRounds, steps, ingredientList, doughType,
  taskId, isToday, taskStatus,
  onToggleStep, onVarianceLogged, onCompleteRound,
}: RoundPanelProps) {
  const [ingExpanded, setIngExpanded] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compNames = Array.from(new Set((ingredientList ?? []).map((i: any) => i.recipe_components?.name ?? 'Main'))) as string[];

  const allStepsDone  = steps.every(s => round.completedStepIds.includes(s.id));
  const canComplete   = allStepsDone && isToday && taskStatus === 'in_progress' && !round.isDone;
  const canInteract   = isToday && taskStatus === 'in_progress';

  return (
    <div className={`rounded-lg border overflow-hidden
      ${round.isDone ? 'border-sage-100 bg-sage-50/30' : 'border-crust-200 bg-white shadow-sm'}`}
    >
      {/* Round header */}
      <div className={`flex items-center gap-3 px-3 py-2.5
        ${round.isDone ? 'bg-sage-50/60' : 'bg-crust-50'}`}
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold
          ${round.isDone ? 'bg-sage-500 text-white' : 'bg-crust-500 text-white'}`}
        >
          {round.isDone ? <CheckCircle2 size={14} /> : round.roundNumber}
        </div>
        <div className="flex-1">
          <p className={`text-xs font-semibold ${round.isDone ? 'text-sage-700' : 'text-crust-800'}`}>
            Round {round.roundNumber} of {totalRounds}
          </p>
          <p className="text-xs text-gray-400">
            {round.batches} batch{round.batches > 1 ? 'es' : ''} this round
            {round.variances.length > 0 && ` · ${round.variances.length} variance${round.variances.length > 1 ? 's' : ''} logged`}
          </p>
        </div>
        {round.isDone && (
          <span className="badge-green text-xs">Done</span>
        )}
      </div>

      {/* Round body — hidden when done */}
      {!round.isDone && (
        <div className="px-3 py-3 space-y-3">

          {/* Tangzhong warning (when relevant) */}
          {doughType === 'tangzhong' && !round.completedStepIds.includes('tangzhong') && (
            <div className="tangzhong-warning">
              <AlertTriangle size={13} />
              Cook tangzhong FIRST — water + milk + bread flour until thick paste, cool ≥15 min
            </div>
          )}

          {/* Step checklist */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Mixing steps</p>
            <MixingStepTracker
              steps={steps}
              completedStepIds={round.completedStepIds}
              onToggleStep={id => onToggleStep(round.roundNumber, id)}
              isToday={isToday}
              taskStatus={taskStatus}
            />
          </div>

          {/* Ingredient list — collapsible */}
          <div>
            <button
              onClick={() => setIngExpanded(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide w-full mb-1.5"
            >
              <FlaskConical size={11} />
              Ingredients ({round.batches} batch{round.batches > 1 ? 'es' : ''})
              {ingExpanded ? <ChevronUp size={11} className="ml-auto" /> : <ChevronDown size={11} className="ml-auto" />}
            </button>

            {ingExpanded && (
              <div className="space-y-2">
                {canInteract && taskStatus === 'in_progress' && (
                  <p className="text-xs text-orange-500 italic">
                    Tap "Log issue" kung sobra o kulang ang ingredient
                  </p>
                )}
                {compNames.map(compName => (
                  <div key={compName} className="mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{compName}</span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {(ingredientList ?? [])
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .filter((i: any) => (i.recipe_components?.name ?? 'Main') === compName)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .map((ing: any, idx: number) => (
                          <IngredientRow
                            key={idx}
                            ing={ing}
                            taskId={taskId}
                            batches={round.batches}
                            isToday={isToday}
                            taskStatus={taskStatus}
                            onVarianceLogged={v => onVarianceLogged(round.roundNumber, v)}
                          />
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Complete round button */}
          <button
            onClick={() => onCompleteRound(round.roundNumber)}
            disabled={!canComplete}
            className={`w-full btn-sm flex items-center justify-center gap-2 font-medium transition-all
              ${canComplete
                ? 'btn-success'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed rounded-lg border border-gray-200'}`}
          >
            <CheckCheck size={14} />
            {allStepsDone ? 'Mark round complete' : 'Complete all steps first'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   BatchRoundPlanner — lets mixer set batches-per-round
   before starting. Shows summary: N total batches,
   B per round → R rounds needed.
───────────────────────────────────────────── */
interface PlannerProps {
  totalBatches: number;
  batchesPerRound: number;
  onChangeBatchesPerRound: (n: number) => void;
}

function BatchRoundPlanner({ totalBatches, batchesPerRound, onChangeBatchesPerRound }: PlannerProps) {
  const roundCount = Math.ceil(totalBatches / batchesPerRound);
  const lastRoundBatches = totalBatches % batchesPerRound || batchesPerRound;

  return (
    <div className="bg-wheat-50 border border-wheat-200 rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-700">Mixing plan</p>
          <p className="text-xs text-gray-400">How many batches per mixing round?</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangeBatchesPerRound(Math.max(1, batchesPerRound - 1))}
            className="w-7 h-7 rounded-full border border-wheat-200 bg-white text-gray-500 flex items-center justify-center hover:border-crust-300 hover:text-crust-700 transition-colors"
          >
            <Minus size={12} />
          </button>
          <div className="w-10 text-center">
            <p className="text-lg font-bold text-crust-700 leading-none">{batchesPerRound}</p>
            <p className="text-xs text-gray-400">per round</p>
          </div>
          <button
            onClick={() => onChangeBatchesPerRound(Math.min(totalBatches, batchesPerRound + 1))}
            disabled={batchesPerRound >= totalBatches}
            className="w-7 h-7 rounded-full border border-wheat-200 bg-white text-gray-500 flex items-center justify-center hover:border-crust-300 hover:text-crust-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Summary breakdown */}
      <div className="flex items-stretch gap-2">
        {Array.from({ length: roundCount }, (_, i) => {
          const isLast       = i === roundCount - 1;
          const batchesHere  = isLast ? lastRoundBatches : batchesPerRound;
          return (
            <div key={i} className="flex-1 bg-white border border-wheat-100 rounded-md px-2 py-1.5 text-center">
              <p className="text-xs font-semibold text-crust-700">R{i + 1}</p>
              <p className="text-xs text-gray-400">{batchesHere} batch{batchesHere > 1 ? 'es' : ''}</p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 text-center">
        {roundCount} mixing round{roundCount > 1 ? 's' : ''} · {totalBatches} total batch{totalBatches > 1 ? 'es' : ''}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   TaskCard — fully revised with round-based mixing
───────────────────────────────────────────── */
interface TaskCardProps {
  task: Task;
  isToday: boolean;
  dateStr: string;
  updating: string | null;
  allTasks: Task[];
  onUpdateStatus: (id: string, date: string, status: 'in_progress' | 'completed') => void;
}

function TaskCard({ task, isToday, dateStr, updating, allTasks, onUpdateStatus }: TaskCardProps) {
  const [expanded, setExpanded]               = useState(false);
  const [batchesPerRound, setBatchesPerRound] = useState(2);
  const [startError, setStartError]           = useState('');

  const planItem  = task.production_plan_items as { products?: { name: string; dough_type: string }; tasks?: Array<{ task_role?: string; status?: string }> } | null;
  const product   = planItem?.products;
  const doughType = product?.dough_type ?? 'other';
  const steps     = getStepsForDoughType(doughType);

  // Scaler gate: read from planItem.tasks (populated by the /tasks/my endpoint's nested join)
  // This correctly reflects the scaler's task status regardless of who is logged in.
  const planTasks     = planItem?.tasks ?? [];
  const scalerTasks   = planTasks.filter(t => t.task_role === 'scaling');
  const scalerNotComplete = scalerTasks.length > 0 && scalerTasks.some(t => t.status !== 'completed');

  /* Build round states when user confirms plan */
  const initRounds = (bpr: number): RoundState[] => {
    const total  = task.batches_assigned;
    const count  = Math.ceil(total / bpr);
    return Array.from({ length: count }, (_, i) => {
      const isLast   = i === count - 1;
      const batches  = isLast ? (total % bpr || bpr) : bpr;
      return {
        roundNumber:      i + 1,
        batches,
        completedStepIds: [],
        variances:        [],
        isDone:           false,
      };
    });
  };

  // If the task is already in_progress (e.g. after a page refresh), auto-initialize
  // started=true and rounds so the mixer can see their work and continue.
  const [started, setStarted] = useState<boolean>(() => task.status === 'in_progress');
  const [rounds, setRounds]   = useState<RoundState[]>(() =>
    task.status === 'in_progress' ? initRounds(batchesPerRound) : []
  );

  const handleStartMixing = async () => {
    if (!isToday) return;
    if (scalerNotComplete) {
      setStartError('Scaling must be completed before mixing can begin.');
      return;
    }
    setStartError('');
    try {
      await onUpdateStatus(task.id, dateStr, 'in_progress');
      setRounds(initRounds(batchesPerRound));
      setStarted(true);
    } catch {
      // error is already shown in the parent via loadError
    }
  };

  const handleToggleStep = (roundNum: number, stepId: string) => {
    setRounds(prev => prev.map(r => {
      if (r.roundNumber !== roundNum) return r;
      const already = r.completedStepIds.includes(stepId);
      return {
        ...r,
        completedStepIds: already
          ? r.completedStepIds.filter(id => id !== stepId)
          : [...r.completedStepIds, stepId],
      };
    }));
  };

  const handleVarianceLogged = (roundNum: number, v: VarianceEntry) => {
    setRounds(prev => prev.map(r =>
      r.roundNumber === roundNum ? { ...r, variances: [...r.variances, v] } : r
    ));
  };

  const handleCompleteRound = async (roundNum: number) => {
    // Build the updated rounds array synchronously FIRST, then apply it to state.
    // Reading `rounds` directly and calling setRounds separately causes a stale
    // closure: setRounds is async so `rounds` still holds the old value when we
    // check allDone — meaning the task never gets marked completed.
    const updatedRounds = rounds.map(r =>
      r.roundNumber === roundNum ? { ...r, isDone: true } : r
    );
    setRounds(updatedRounds);

    const allDone = updatedRounds.every(r => r.isDone);
    if (allDone) {
      await onUpdateStatus(task.id, dateStr, 'completed');
    }
  };

  const handleResetPlan = () => {
    setStarted(false);
    setRounds([]);
  };

  const currentRoundIdx = rounds.findIndex(r => !r.isDone);
  const doneRoundsCount = rounds.filter(r => r.isDone).length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compNames = Array.from(new Set((task.ingredient_list ?? []).map((i: any) => i.recipe_components?.name ?? 'Main'))) as string[];

  return (
    <div className={`border-b border-wheat-100 last:border-b-0
      ${task.is_priority ? 'bg-orange-50/40' : ''}
      ${task.status === 'completed' ? 'opacity-70' : ''}`}
    >
      {/* Task header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
          ${task.status === 'completed'   ? 'bg-sage-100 text-sage-600'
          : task.status === 'in_progress' ? 'bg-amber-100 text-amber-600'
          : 'bg-gray-100 text-gray-400'}`}
        >
          {task.status === 'completed' ? <CheckCircle2 size={16} /> : <Blend size={16} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800 text-sm">{product?.name ?? 'Unknown'}</p>
            {task.is_priority && <span className="badge-orange text-xs">PRIORITY</span>}
            <span className="badge-blue text-xs">
              {DOUGH_TYPE_LABELS[doughType as keyof typeof DOUGH_TYPE_LABELS] ?? doughType}
            </span>
            <span className={`badge text-xs
              ${task.status === 'completed'   ? 'badge-green'
              : task.status === 'in_progress' ? 'badge-amber'
              : 'badge-gray'}`}
            >
              {task.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {task.batches_assigned} batch{task.batches_assigned > 1 ? 'es' : ''} total
            {started && rounds.length > 0 && ` · Round ${doneRoundsCount + 1}/${rounds.length}`}
          </p>
          <div className="mt-2">
            <ReportIssueButton planItemId={task.plan_item_id} taskId={task.id} productName={product?.name ?? ''} />
          </div>
        </div>

        {/* Action buttons (stop propagation) */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Not started yet */}
          {task.status === 'pending' && (
            <button
              onClick={e => { e.stopPropagation(); }}
              className="btn-secondary btn-sm opacity-50 cursor-default"
              title="Expand to configure mixing plan"
            >
              <Blend size={12} />
              Configure
            </button>
          )}
          {/* In progress — show round progress pill */}
          {task.status === 'in_progress' && started && (
            <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              {rounds.map((r, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors
                    ${r.isDone ? 'bg-sage-500' : i === currentRoundIdx ? 'bg-amber-500' : 'bg-gray-200'}`}
                />
              ))}
            </div>
          )}
          {expanded
            ? <ChevronUp size={14} className="text-gray-400" />
            : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-wheat-100 px-4 py-3 bg-wheat-50/50 space-y-3">

          {/* ── PENDING: planner ── */}
          {task.status === 'pending' && (
            <>
              <BatchRoundPlanner
                totalBatches={task.batches_assigned}
                batchesPerRound={batchesPerRound}
                onChangeBatchesPerRound={setBatchesPerRound}
              />
              {scalerNotComplete && (
                <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} />
                  Waiting for scaler to complete this product before mixing
                </div>
              )}
              {startError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} />
                  {startError}
                </div>
              )}
              <button
                onClick={e => { e.stopPropagation(); handleStartMixing(); }}
                disabled={updating === task.id || !isToday || !!scalerNotComplete}
                title={scalerNotComplete ? 'Waiting for scaler task to complete' : (!isToday ? 'Can only start today\'s tasks' : undefined)}
                className="btn-secondary btn-sm w-full flex items-center justify-center gap-2"
              >
                {updating === task.id
                  ? <Loader2 size={12} className="animate-spin" />
                  : <PlayCircle size={12} />}
                Start mixing · {Math.ceil(task.batches_assigned / batchesPerRound)} round{Math.ceil(task.batches_assigned / batchesPerRound) > 1 ? 's' : ''}
              </button>
            </>
          )}

          {/* ── IN PROGRESS: rounds ── */}
          {task.status === 'in_progress' && started && (
            <>
              {/* Rounds — show all, current one open, done ones collapsed */}
              <div className="space-y-2">
                {rounds.map((round, idx) => {
                  const isCurrent = idx === currentRoundIdx;
                  if (round.isDone) {
                    return (
                      <div key={round.roundNumber}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-sage-100 bg-sage-50/40"
                      >
                        <div className="w-5 h-5 rounded-full bg-sage-500 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 size={11} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-sage-700">
                            Round {round.roundNumber} — {round.batches} batch{round.batches > 1 ? 'es' : ''} complete
                          </p>
                          {round.variances.length > 0 && (
                            <p className="text-xs text-orange-500">
                              {round.variances.length} variance{round.variances.length > 1 ? 's' : ''} logged
                            </p>
                          )}
                        </div>
                        <span className="badge-green text-xs">Done</span>
                      </div>
                    );
                  }
                  if (!isCurrent) {
                    return (
                      <div key={round.roundNumber}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-wheat-100 bg-gray-50/50 opacity-50"
                      >
                        <div className="w-5 h-5 rounded-full border-2 border-gray-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-gray-400">{round.roundNumber}</span>
                        </div>
                        <p className="text-xs text-gray-400">
                          Round {round.roundNumber} — {round.batches} batch{round.batches > 1 ? 'es' : ''} · waiting
                        </p>
                      </div>
                    );
                  }
                  return (
                    <MixingRoundPanel
                      key={round.roundNumber}
                      round={round}
                      totalRounds={rounds.length}
                      steps={steps}
                      ingredientList={task.ingredient_list ?? []}
                      doughType={doughType}
                      taskId={task.id}
                      isToday={isToday}
                      taskStatus={task.status}
                      onToggleStep={handleToggleStep}
                      onVarianceLogged={handleVarianceLogged}
                      onCompleteRound={handleCompleteRound}
                    />
                  );
                })}
              </div>

              {/* Reset plan */}
              <button
                onClick={e => { e.stopPropagation(); handleResetPlan(); }}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mx-auto"
              >
                <RotateCcw size={11} />
                Reset mixing plan
              </button>
            </>
          )}

          {/* ── COMPLETED: summary ── */}
          {task.status === 'completed' && (
            <div className="flex flex-col items-center gap-1.5 py-4 text-center">
              <CheckCircle2 size={28} className="text-sage-500" />
              <p className="text-sm font-semibold text-sage-700">All batches mixed</p>
              <p className="text-xs text-gray-400">
                {task.batches_assigned} batch{task.batches_assigned > 1 ? 'es' : ''} complete
              </p>
              {/* Ingredient reference — read-only */}
              <details className="w-full mt-2">
                <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600">
                  View ingredient reference
                </summary>
                <div className="mt-2 space-y-2 text-left">
                  {compNames.map(compName => (
                    <div key={compName}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{compName}</p>
                      <div className="grid grid-cols-1 gap-1">
                        {(task.ingredient_list ?? [])
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          .filter((i: any) => (i.recipe_components?.name ?? 'Main') === compName)
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          .map((ing: any, idx: number) => (
                            <div key={idx} className="flex justify-between bg-white rounded border border-wheat-100 px-2.5 py-1.5">
                              <span className="text-xs text-gray-600">{ing.ingredients?.name}</span>
                              <span className="text-xs font-mono text-gray-500">
                                {ing.amount_g != null ? `${ing.amount_g * task.batches_assigned}g` : '—'}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MixerDashboard — unchanged outer shell
───────────────────────────────────────────── */
export default function MixerDashboard() {
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
      results.forEach(({ date, tasks }) => { map[date] = tasks; });
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

  const updateStatus = async (taskId: string, date: string, status: 'in_progress' | 'completed') => {
    setUpdating(taskId);
    setLoadError('');
    try {
      await api.patch(`/tasks/${taskId}/status`, { status });
      const r = await api.get<{ tasks: Task[] }>(`/tasks/my?date=${date}`);
      setWeekTasks(prev => ({ ...prev, [date]: r.data.tasks ?? [] }));
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

  const todayTasks  = weekTasks[today] ?? [];
  const doneCount   = todayTasks.filter(t => t.status === 'completed').length;
  const totalCount  = todayTasks.length;
  const progress    = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-800">Mixing Tasks</h1>
          <p className="text-sm text-gray-500 mt-0.5">{weekStart.format('MMM D')} – {weekEnd.format('MMM D, YYYY')}</p>
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
          <span className="text-sm font-medium text-gray-700">Today's Progress</span>
          <span className="text-sm font-bold text-crust-700">{doneCount}/{totalCount} tasks today</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill bg-crust-500" style={{ width: `${progress}%` }} />
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
                      <Blend size={10} /> {dayDone}/{dayTasks.length} done
                    </span>
                  )}
                </div>
              );
            }

            const doughGroups = groupByDough(dayTasks);

            return (
              <div key={dateStr} className={`bg-white rounded-lg border shadow-card overflow-hidden
                ${isToday ? 'border-crust-400' : 'border-wheat-100'}`}
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
                  {isOpen
                    ? <ChevronUp size={15} className="text-gray-400" />
                    : <ChevronDown size={15} className="text-gray-400" />}
                </div>

                {isOpen && (
                  <div className="border-t border-wheat-100">
                    {dayTasks.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-gray-400">
                        <Blend size={24} className="mx-auto mb-2 text-gray-300" />
                        No mixing tasks for {day.format('MMMM D, YYYY')}
                      </div>
                    ) : (
                      <div className="space-y-px">
                        {Object.entries(doughGroups).map(([doughType, groupTasks]) => (
                          <div key={doughType}>
                            <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-crust-400 flex-shrink-0" />
                              <span className="text-xs font-semibold text-crust-600 uppercase tracking-widest">
                                {DOUGH_TYPE_LABELS[doughType as keyof typeof DOUGH_TYPE_LABELS] ?? doughType}
                              </span>
                              <div className="flex-1 h-px bg-crust-100" />
                              {doughType === 'tangzhong' && (
                                <span className="tangzhong-warning text-xs">⏱ Prepare starter first</span>
                              )}
                            </div>
                            {groupTasks.map(task => (
                              <TaskCard
                                key={task.id}
                                task={task}
                                isToday={isToday}
                                dateStr={dateStr}
                                updating={updating}
                                allTasks={dayTasks}
                                onUpdateStatus={updateStatus}
                              />
                            ))}
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
      )}
    </div>
  );
}