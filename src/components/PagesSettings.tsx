import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import {
  currentValues,
  optionsFor,
  PAGES,
  type PrefField,
  patchOf,
  prefsAsPatch,
  savedPrefs,
  sectionCounts,
} from '#shared/pages';
import {
  PAGE_KEYS,
  type PageKey,
  type PagePrefs,
  type Snapshot,
  settingsOf,
} from '#shared/types';
import { Segmented } from '@/components/inputs/Segmented';
import { SelectField } from '@/components/inputs/SelectField';
import { defaultTaskView } from '@/components/tasks/TaskLayouts';
import { Button } from '@/components/ui/button';
import { useDatapad } from '@/hooks/useDatapad';
import { useSpaces } from '@/providers/DatapadProvider';
import { usePagePrefs } from '@/providers/PagePrefsProvider';
import { useToast } from '@/providers/ToastProvider';

/** A field's default here: Tasks opens on the table on desktop only. */
function defaultOf(page: PageKey, field: PrefField): string {
  return page === 'tasks' && field.key === 'view'
    ? defaultTaskView()
    : field.def;
}

function isSaved(prefs: PagePrefs): boolean {
  return Object.keys(prefs).length > 0;
}

function describeSections(prefs: PagePrefs): string {
  const { closed, open } = sectionCounts(prefs);
  if (closed + open === 0) return 'Sections open and close as they start.';
  const parts = [
    closed > 0 && `${closed} ${closed === 1 ? 'section' : 'sections'} closed`,
    open > 0 && `${open} ${open === 1 ? 'section' : 'sections'} open`,
  ].filter(Boolean);
  return `${parts.join(', ')} as you left ${closed + open === 1 ? 'it' : 'them'}.`;
}

/**
 * Settings → Pages (#186): what each page remembers in the open space (its
 * layout, sort and grouping, filters, and sections left open or closed),
 * with the controls the page itself uses. A change here is saved at once;
 * Reset puts one page back to its defaults, Reset all every page, both
 * with Undo.
 */
export function PagesSettings() {
  const { state, actions } = useDatapad();
  const { name } = useSpaces().current;
  const { save } = usePagePrefs();
  const { show } = useToast();

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const pages = settingsOf(state).pages ?? {};
  const anySaved = PAGE_KEYS.some((page) => isSaved(pages[page] ?? {}));

  const reset = (page: PageKey) => {
    const before = savedPrefs(state, page);
    if (!actions.resetPagePrefs({ page })) return;
    show(`${PAGES[page].label} is back to its defaults`, () =>
      actions.setPagePrefs({ page, patch: prefsAsPatch(before) }),
    );
  };

  const resetAll = () => {
    const before = PAGE_KEYS.flatMap((page) => {
      const prefs = pages[page];
      return prefs && isSaved(prefs)
        ? [
            {
              type: 'setPagePrefs' as const,
              page,
              patch: prefsAsPatch(prefs),
            },
          ]
        : [];
    });
    if (!actions.resetPagePrefs({ page: null })) return;
    show('Every page is back to its defaults', () => {
      if (before.length > 0) actions.batch({ ops: before });
    });
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Each page remembers its layout, sort and grouping, filters and the
          sections you open or close, as you change them. They are saved with{' '}
          {name}, so every device you use opens pages the same way. A link that
          names its own settings still shows them. The search text is never
          saved.
        </p>
        <Button
          variant="outline"
          className="press h-11 self-start desk:h-8"
          disabled={!anySaved}
          onClick={resetAll}
        >
          <ArrowCounterClockwiseIcon />
          Reset all
        </Button>
      </div>
      <ul aria-label="Pages" className="flex flex-col gap-4">
        {PAGE_KEYS.map((page) => (
          <li key={page}>
            <PageCard
              page={page}
              prefs={pages[page] ?? {}}
              state={state}
              onChange={(key, value, def) =>
                save(
                  page,
                  patchOf({ [key]: value === def ? null : value }),
                  true,
                )
              }
              onReset={() => reset(page)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function PageCard({
  page,
  prefs,
  state,
  onChange,
  onReset,
}: {
  page: PageKey;
  prefs: PagePrefs;
  state: Snapshot;
  onChange: (key: string, value: string, def: string) => void;
  onReset: () => void;
}) {
  const spec = PAGES[page];
  const values = currentValues(page, prefs, state);
  const saved = isSaved(prefs);
  const titleId = `page-prefs-${page}`;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 border p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={titleId} className="flex-1 text-sm font-semibold">
          {spec.label}
        </h3>
        <span className="text-xs text-muted-foreground">
          {saved ? 'Saved' : 'Defaults'}
        </span>
        <Button
          variant="outline"
          className="press h-11 desk:h-8"
          disabled={!saved}
          aria-label={`Reset ${spec.label}`}
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
        {spec.fields.map((field) => {
          const def = defaultOf(page, field);
          const value = values[field.key] ?? def;
          const options = optionsFor(field, state);
          const change = (next: string) => onChange(field.key, next, def);
          return field.control === 'segmented' ? (
            <Segmented
              key={field.key}
              legend={field.label}
              value={value}
              options={options}
              onChange={change}
              className={options.length > 3 ? 'sm:col-span-2' : undefined}
            />
          ) : (
            <SelectField
              key={field.key}
              label={field.label}
              value={value}
              options={options}
              onChange={change}
            />
          );
        })}
      </div>
      {spec.sections && (
        <p className="text-xs text-muted-foreground">
          {describeSections(prefs)}
        </p>
      )}
    </section>
  );
}
