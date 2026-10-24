import { ShortcutList } from '@/components/ShortcutList';
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
      <h2 className="font-heading text-lg font-semibold">Settings</h2>
      <p>
        The account button at the top right opens Settings: Appearance (theme
        and motion, remembered on this device), People, Orgs (including the
        default org new projects start in), Data (export and import) and
        Account. Theme, Motion and Sign out are in the menu itself too. When
        your device asks for reduced motion, Datapad never animates.
      </p>
      <h2 className="font-heading text-lg font-semibold">Keyboard</h2>
      <p>
        Press <kbd className="border bg-muted px-1.5 font-mono text-xs">?</kbd>{' '}
        anywhere for this list.
      </p>
      <ShortcutList />
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
