import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps, type Route } from '@/lib/router';

/** An address that names nothing, or a project that is gone. */
export function NotFoundPage({
  what = 'page',
  back = { name: 'focus' },
  backLabel = 'Go to Focus',
}: {
  what?: string;
  back?: Route;
  backLabel?: string;
}) {
  usePageTitle('Not found');
  return (
    <section
      aria-labelledby="not-found-title"
      className="enter flex flex-col gap-3"
    >
      <h1 id="not-found-title" className="text-page-title">
        Not found
      </h1>
      <p className="text-state">
        There is no {what} here. It may have been deleted, or the link is wrong.
      </p>
      <p>
        <a {...linkProps(back)} className="underline underline-offset-4">
          {backLabel}
        </a>
      </p>
    </section>
  );
}
