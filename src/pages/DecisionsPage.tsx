import { PlusIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import {
  DEFAULT_DECISION_FILTERS,
  type DecisionFilters,
  selectDecisions,
} from '#shared/decisions';
import { DECISION_STATUSES, type DecisionStatus } from '#shared/types';
import { DecisionList } from '@/components/decisions/DecisionList';
import { useDecisionPanel } from '@/components/decisions/DecisionPanelProvider';
import { DECISION_LABELS } from '@/components/decisions/DecisionStatus';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { useToday } from '@/hooks/useNow';
import { usePageTitle } from '@/hooks/usePageTitle';
import { withViewTransition } from '@/lib/motion';
import { setQuery, useQuery } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';

const STATUS_OPTIONS: { value: DecisionStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  ...DECISION_STATUSES.map((s) => ({ value: s, label: DECISION_LABELS[s] })),
];

function useDecisionFilters(): DecisionFilters {
  const query = useQuery();
  const status = query.get('status') ?? '';
  return {
    status: (DECISION_STATUSES as readonly string[]).includes(status)
      ? (status as DecisionStatus)
      : DEFAULT_DECISION_FILTERS.status,
    project: query.get('project') ?? '',
    q: query.get('q') ?? '',
  };
}

/**
 * Every decision, grouped by project: why things are the way they are,
 * findable months later. Filter by status, project and text (kept in the
 * URL); a row opens its panel.
 */
export function DecisionsPage() {
  usePageTitle('Decisions');
  const { state } = useDatapad();
  const { newDecision } = useDecisionPanel();
  const { active } = useMotion();
  const today = useToday();
  const filters = useDecisionFilters();

  const groups = useMemo(
    () => (state ? selectDecisions(state, filters) : []),
    [state, filters],
  );
  const any = state ? Object.keys(state.decisions).length > 0 : false;
  const projectOptions = useMemo(
    () => [
      { value: '', label: 'All projects' },
      ...Object.values(state?.projects ?? {})
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name })),
      { value: 'general', label: 'General' },
    ],
    [state?.projects],
  );

  const change = (patch: Record<string, string | null>, animate = true) =>
    setQuery(
      patch,
      animate
        ? {
            transition: (update) =>
              withViewTransition(update, active, 'filter'),
          }
        : {},
    );

  return (
    <section
      aria-labelledby="decisions-title"
      className="enter flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="decisions-title" className="text-page-title flex-1">
          Decisions
        </h1>
        <Button
          className="press"
          onClick={() =>
            newDecision(
              filters.project && filters.project !== 'general'
                ? filters.project
                : null,
            )
          }
        >
          <PlusIcon weight="bold" />
          New decision
        </Button>
      </div>

      {any && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.6fr)_1fr_1fr] sm:items-end">
          <Segmented
            legend="Status"
            value={filters.status}
            onChange={(v) => change({ status: v || null })}
            options={STATUS_OPTIONS}
          />
          <SelectField
            label="Project"
            value={filters.project}
            options={projectOptions}
            onChange={(v) => change({ project: v || null })}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="decision-find" className="text-xs font-medium">
              Find
            </label>
            <Input
              id="decision-find"
              type="search"
              value={filters.q}
              placeholder="Title or why"
              autoComplete="off"
              onChange={(e) => change({ q: e.target.value || null }, false)}
              className="h-11 text-base desk:h-8 desk:text-xs"
            />
          </div>
        </div>
      )}

      {!state ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !any ? (
        <p className="text-state">
          No decisions yet. Record one from a project page, from a note with
          /decision, or with New decision.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-state">None match these filters.</p>
      ) : (
        groups.map((g) => (
          <section
            key={g.id}
            aria-labelledby={`decisions-${g.id}`}
            className="flex flex-col gap-2"
          >
            <h2
              id={`decisions-${g.id}`}
              className="font-heading text-sm font-semibold"
            >
              {g.label}{' '}
              <span className="count font-sans text-xs font-normal text-muted-foreground tabular-nums">
                {g.rows.length}
              </span>
            </h2>
            <DecisionList
              decisions={g.rows}
              people={state.people}
              today={today}
              label={`Decisions in ${g.label}`}
              empty=""
            />
          </section>
        ))
      )}
    </section>
  );
}
