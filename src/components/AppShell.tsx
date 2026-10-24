import { useEffect } from 'react';
import { TopBar } from '@/components/TopBar';
import { withViewTransition } from '@/lib/motion';
import { setRouteTransition, useRoute } from '@/lib/router';
import { FocusPage } from '@/pages/FocusPage';
import { HelpPage } from '@/pages/HelpPage';
import { useEmail } from '@/providers/DatapadProvider';
import { useMotion } from '@/providers/MotionProvider';

/**
 * The top bar and one page. Route changes run inside a `page` view
 * transition so the page lifts out and the next settles in while the bar
 * holds still. M2 adds the rail (desktop) and the bottom tab bar (mobile).
 */
export function AppShell() {
  const route = useRoute();
  const { active } = useMotion();
  const email = useEmail();

  useEffect(() => {
    setRouteTransition((update) => withViewTransition(update, active, 'page'));
  }, [active]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <TopBar route={route} email={email} />
      {/* Keyed by route so each page mounts fresh and its entrances replay. */}
      <main
        id="main"
        key={route.name}
        className="page mx-auto flex w-full max-w-(--content-max) min-w-0 flex-1 flex-col px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6"
      >
        {route.name === 'focus' && <FocusPage />}
        {route.name === 'help' && <HelpPage />}
      </main>
    </div>
  );
}
