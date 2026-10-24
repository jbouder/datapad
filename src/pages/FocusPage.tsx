import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * Focus: what needs attention today. The buckets arrive in M5; until then
 * this is the signed-in landing page.
 */
export function FocusPage() {
  usePageTitle('Focus');
  return (
    <section
      aria-labelledby="focus-title"
      className="enter flex flex-col gap-2"
    >
      <h1 id="focus-title" className="text-page-title">
        Focus
      </h1>
      <p className="text-state">
        Nothing to focus on yet. Projects, tasks and notes are on their way.
      </p>
    </section>
  );
}
