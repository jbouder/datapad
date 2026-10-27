import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyPagePatch,
  currentValues,
  effectiveQuery,
  hasPagePrefs,
  legacyPrefs,
  mergePatches,
  type PrefDefaults,
  planChange,
  savedPrefs,
} from '#shared/pages';
import { type PagePrefsPatch, PagePrefsPatchSchema } from '#shared/protocol';
import { PAGE_KEYS, type PageKey, type PagePrefs } from '#shared/types';
import { useDatapad } from '@/hooks/useDatapad';
import { pinQuery, setQuery, useQuery } from '@/lib/router';
import { useSpaces } from '@/providers/DatapadProvider';

/**
 * Saved page preferences (#186): each page's layout, sort, grouping,
 * filters and sections, stored with the open space's data so they follow
 * you to every device. A change saves itself: quick changes are held for
 * `SAVE_DELAY_MS` and sent as one `setPagePrefs`, and anything still held
 * goes out when the tab is hidden or closed.
 *
 * A page reads them once, when it opens with the server's state (an open
 * page is never changed under you by another tab or device); its address
 * wins key by key (`effectiveQuery`).
 */

/** How long quick changes wait to go out as one. */
export const SAVE_DELAY_MS = 500;

/** The browser keys used before #186, carried over once. */
const LEGACY = ['datapad:view:', 'datapad:focus:', 'datapad:section:'];

interface PagePrefsApi {
  /** A page's preferences right now, with changes not sent yet. */
  read: (page: PageKey) => PagePrefs;
  /** Save a change; `now` sends it at once instead of after the pause. */
  save: (page: PageKey, patch: PagePrefsPatch, now?: boolean) => void;
  /**
   * The open space's live state is in and anything carried over from this
   * browser applied: what a page opens with from here on is settled.
   */
  ready: boolean;
}

const PagePrefsContext = createContext<PagePrefsApi | null>(null);

function legacyEntries(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !LEGACY.some((prefix) => key.startsWith(prefix))) continue;
      const value = localStorage.getItem(key);
      if (value !== null) out.push([key, value]);
    }
  } catch {
    // No storage: nothing to carry over.
  }
  return out;
}

export function PagePrefsProvider({ children }: { children: ReactNode }) {
  const { state, stale, actions, space } = useDatapad();
  const spaceId = useSpaces().current.id;
  const held = useRef(new Map<PageKey, PagePrefsPatch>());
  const timer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const current = stateRef.current;
    if (!current || held.current.size === 0) return;
    const ops = [...held.current]
      // Nothing to send for a change that changes nothing.
      .filter(([page, patch]) => {
        const before = savedPrefs(current, page);
        const after = applyPagePatch(before, patch) ?? {};
        return JSON.stringify(after) !== JSON.stringify(before);
      })
      .map(([page, patch]) => ({
        type: 'setPagePrefs' as const,
        page,
        patch,
      }));
    held.current.clear();
    const [only] = ops;
    if (ops.length === 1 && only) {
      actionsRef.current.setPagePrefs({ page: only.page, patch: only.patch });
    } else if (ops.length > 1) {
      actionsRef.current.batch({ ops });
    }
  }, []);

  const save = useCallback(
    (page: PageKey, patch: PagePrefsPatch, now = false) => {
      const before = held.current.get(page);
      held.current.set(page, before ? mergePatches(before, patch) : patch);
      window.clearTimeout(timer.current);
      if (now) flush();
      else timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const read = useCallback((page: PageKey): PagePrefs => {
    const current = stateRef.current;
    const saved = current ? savedPrefs(current, page) : {};
    const patch = held.current.get(page);
    return (patch ? applyPagePatch(saved, patch) : saved) ?? {};
  }, []);

  // Hidden or closing: what is held goes out now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  // Another space: what was held belonged to the one left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a switch only
  useEffect(() => {
    held.current.clear();
    window.clearTimeout(timer.current);
  }, [spaceId]);

  // Once per space, on its live state: a space that has never saved page
  // preferences takes what this browser remembered before #186.
  const carried = useRef(new Set<string>());
  const [settled, setSettled] = useState<string | null>(null);
  const live = state !== null && !stale && space === spaceId;
  useEffect(() => {
    if (!live || !state || carried.current.has(spaceId)) return;
    carried.current.add(spaceId);
    setSettled(spaceId);
    if (hasPagePrefs(state)) return;
    const found = legacyPrefs(legacyEntries());
    const ops = PAGE_KEYS.flatMap((page) => {
      const parsed = PagePrefsPatchSchema.safeParse(found[page]);
      return parsed.success
        ? [{ type: 'setPagePrefs' as const, page, patch: parsed.data }]
        : [];
    });
    if (ops.length > 0) actions.batch({ ops });
  }, [live, state, spaceId, actions]);

  const ready = live && settled === spaceId;
  const value = useMemo(() => ({ read, save, ready }), [read, save, ready]);
  return (
    <PagePrefsContext.Provider value={value}>
      {children}
    </PagePrefsContext.Provider>
  );
}

export function usePagePrefs(): PagePrefsApi {
  const value = useContext(PagePrefsContext);
  if (!value) {
    throw new Error('usePagePrefs must be used inside PagePrefsProvider');
  }
  return value;
}

/**
 * What a page (or a section) saved, as it opened: followed until the
 * space's live state is in (`ready`), then kept for as long as it is
 * open, so a change from another tab or device waits for the next visit.
 */
export function useOpening<T>(read: (prefs: PagePrefsApi) => T): T {
  const prefs = usePagePrefs();
  const spaceId = useSpaces().current.id;
  const frozen = useRef<{ space: string; value: T } | null>(null);
  if (frozen.current?.space === spaceId) return frozen.current.value;
  const value = read(prefs);
  if (prefs.ready) frozen.current = { space: spaceId, value };
  return value;
}

/** A page's saved values as it opened, without any it no longer has. */
function useOpeningValues(page: PageKey | null): Record<string, string> {
  const { state } = useDatapad();
  return useOpening(({ read }) =>
    state && page ? currentValues(page, read(page), state) : EMPTY,
  );
}

const EMPTY: Record<string, string> = {};

export interface ChangeOptions {
  replace?: boolean;
  transition?: (update: () => void) => void;
}

/**
 * A page's query: its address over its saved preferences (the address
 * wins), and a change that writes the address and saves the preference
 * (`planChange`). What the page saved is read as it opened, then follows
 * only the page's own changes. `defaults` are the ones that depend on the
 * device. With no page (the components page), it is the address alone.
 */
export function usePageQuery(
  page: PageKey | null,
  defaults?: PrefDefaults,
): [
  URLSearchParams,
  (changes: Record<string, string | null>, options?: ChangeOptions) => void,
] {
  const url = useQuery().toString();
  const opening = useOpeningValues(page);
  const { save } = usePagePrefs();
  /** This visit's own changes, over what it opened with (null: default). */
  const own = useRef<Record<string, string | null>>({});
  const base = withChanges(opening, own.current);
  const baseKey = JSON.stringify(base);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by value
  const query = useMemo(
    () =>
      page
        ? effectiveQuery(page, new URLSearchParams(url), base)
        : new URLSearchParams(url),
    [page, url, baseKey],
  );
  const baseRef = useRef(base);
  baseRef.current = base;
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const change = useCallback(
    (changes: Record<string, string | null>, options: ChangeOptions = {}) => {
      if (!page) {
        setQuery(changes, options);
        return;
      }
      const plan = planChange(
        page,
        changes,
        baseRef.current,
        defaultsRef.current,
      );
      // A new entry: the one left keeps what it showed, for Back.
      if (!options.replace) pinQuery(plan.pin);
      for (const [key, value] of Object.entries(plan.url)) {
        if (key in plan.pin) own.current[key] = value;
      }
      setQuery(plan.url, options);
      if (plan.patch) save(page, plan.patch);
    },
    [page, save],
  );
  return [query, change];
}

function withChanges(
  values: Record<string, string>,
  changes: Record<string, string | null>,
): Record<string, string> {
  const out = { ...values };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}
