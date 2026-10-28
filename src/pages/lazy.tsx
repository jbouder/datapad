import { type ComponentType, use } from 'react';
import type { Route } from '@/lib/router';

/**
 * The pages most visits never open, each its own chunk, so the entry stays
 * small (`scripts/budget.ts` holds it to a budget in CI). AppShell renders
 * them inside the page's error boundary and a Suspense with a quiet
 * fallback: a chunk that fails to load shows "Reload this view" like any
 * page that throws.
 *
 * A page whose chunk is already here renders straight away, without
 * suspending even once: main.tsx loads the first page's chunk before the
 * first render, and AppShell fetches the rest once the browser is idle.
 */

interface LazyPage<P> {
  (props: P): React.ReactNode;
  /** Fetch the chunk; resolves once the page can render without waiting. */
  preload: () => Promise<unknown>;
}

function lazyPage<P extends object>(
  load: () => Promise<ComponentType<P>>,
): LazyPage<P> {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const preload = () => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // Let the next attempt (opening the page again) fetch it afresh.
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  // biome-ignore lint/correctness/noComponentHookFactories: called once per page, at module level below, never while rendering
  const Page = (props: P) => {
    // Suspends until the chunk is here; a failed fetch throws to the error
    // boundary, and its Reload this view tries the fetch again.
    const Loaded = loaded ?? use(preload());
    return <Loaded {...props} />;
  };
  return Object.assign(Page, { preload });
}

export const DigestPage = lazyPage(() =>
  import('@/pages/DigestPage').then((m) => m.DigestPage),
);
export const HelpPage = lazyPage(() =>
  import('@/pages/HelpPage').then((m) => m.HelpPage),
);
export const MeetingPage = lazyPage(() =>
  import('@/pages/MeetingPage').then((m) => m.MeetingPage),
);
export const SettingsPage = lazyPage(() =>
  import('@/pages/SettingsPage').then((m) => m.SettingsPage),
);
export const TaskPage = lazyPage(() =>
  import('@/pages/TaskPage').then((m) => m.TaskPage),
);
export const WhiteboardPage = lazyPage(() =>
  import('@/pages/WhiteboardPage').then((m) => m.WhiteboardPage),
);

const LAZY: Partial<
  Record<Route['name'], { preload: () => Promise<unknown> }>
> = {
  digest: DigestPage,
  help: HelpPage,
  meeting: MeetingPage,
  settings: SettingsPage,
  people: SettingsPage,
  orgs: SettingsPage,
  task: TaskPage,
  whiteboard: WhiteboardPage,
};

/** Load the chunk `route` renders, if it is a lazy page. Never rejects. */
export function preloadRoute(route: Route): Promise<void> {
  const page = LAZY[route.name];
  return page
    ? page.preload().then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

/** Load every lazy page's chunk. Never rejects. */
export function preloadPages(): void {
  for (const page of new Set(Object.values(LAZY))) {
    page?.preload().catch(() => undefined);
  }
}
