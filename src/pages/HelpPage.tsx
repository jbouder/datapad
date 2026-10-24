import { usePageTitle } from '@/hooks/usePageTitle';
import { linkProps } from '@/lib/router';

/** Using Datapad. Self-hosting lives in the repository's docs, not here. */
export function HelpPage() {
  usePageTitle('Help');
  return (
    <article
      aria-labelledby="help-title"
      className="enter flex max-w-prose flex-col gap-4"
    >
      <h1 id="help-title" className="text-page-title">
        Help
      </h1>
      <p>
        Datapad is a private tracker for projects, tasks, notes, events and
        people. Only you can open it: every request is checked against your
        Cloudflare Access sign-in.
      </p>
      <h2 className="font-heading text-lg font-semibold">Preferences</h2>
      <p>
        The gear button holds Motion, Theme and Sign out. Motion and Theme are
        remembered on this device. When your device asks for reduced motion,
        Datapad never animates.
      </p>
      <p>
        <a
          {...linkProps({ name: 'focus' })}
          className="underline underline-offset-4"
        >
          Back to Focus
        </a>
      </p>
    </article>
  );
}
