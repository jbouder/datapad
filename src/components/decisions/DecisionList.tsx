import { formatDay } from '#shared/dates';
import type { Decision, Person } from '#shared/types';
import { useDecisionPanel } from '@/components/decisions/DecisionPanelProvider';
import { DecisionPill } from '@/components/decisions/DecisionStatus';
import { Initials } from '@/components/Initials';

/**
 * Decisions as rows: status, title (opens the panel), when, and who
 * decided. On the project page, the Decisions view and a person's pane.
 */
export function DecisionList({
  decisions,
  people,
  today,
  label,
  empty,
  showProject,
}: {
  decisions: Decision[];
  people: Record<string, Person>;
  today: string;
  label: string;
  empty: string;
  /** Name each one's project (cross-project lists). */
  showProject?: (decision: Decision) => string | null;
}) {
  const { openDecision } = useDecisionPanel();
  if (decisions.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul aria-label={label} className="flex flex-col border-t">
      {decisions.map((x) => {
        const project = showProject?.(x);
        const deciders = x.deciders
          .map((id) => people[id])
          .filter((p): p is Person => Boolean(p));
        return (
          <li
            key={x.id}
            data-decision-id={x.id}
            className="row flex items-center gap-2 border-b px-1 text-sm"
          >
            <DecisionPill status={x.status} />
            <button
              type="button"
              onClick={() => openDecision(x.id)}
              className="min-w-0 flex-1 truncate text-left outline-ring/50 hover:underline focus-visible:outline-2"
            >
              {x.title}
            </button>
            {project && (
              <span className="hidden max-w-40 shrink-0 truncate border px-1.5 py-0.5 text-xs text-muted-foreground desk:inline">
                {project}
              </span>
            )}
            {deciders.length > 0 && (
              <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                <span className="sr-only">Decided by: </span>
                {deciders.slice(0, 3).map((p) => (
                  <Initials key={p.id} person={p} />
                ))}
              </span>
            )}
            {x.decidedAt && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDay(x.decidedAt, today)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
