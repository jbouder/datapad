import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DatapadMark } from '@/components/TopBar';
import { Button } from '@/components/ui/button';

interface Props {
  /** Named in the console line, to tell the page from the app. */
  where: 'page' | 'app';
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

/**
 * Catches an error thrown while rendering what is below it and shows
 * `fallback`, which can `reset` to mount it again. The error goes to this
 * browser's console and nowhere else. Data is never at risk: saved changes
 * are on the server, waiting ones in the local queue, and a note being
 * written is a draft in sessionStorage, so it comes back with the view.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[datapad] the ${this.props.where} stopped working:`,
      error,
      info.componentStack,
    );
  }

  reset = () => this.setState({ failed: false });

  render() {
    return this.state.failed
      ? this.props.fallback(this.reset)
      : this.props.children;
  }
}

/** Focus moves to the heading: what had it was just unmounted. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

/** In place of one page that threw; the rail, top bar and tab bar stay. */
export function PageError({ reset }: { reset: () => void }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section
      aria-labelledby="page-error-title"
      className="enter flex flex-col gap-3"
    >
      <h1
        id="page-error-title"
        ref={heading}
        tabIndex={-1}
        className="text-page-title outline-none"
      >
        This view stopped working
      </h1>
      <p className="text-state">
        Something went wrong while showing it. Nothing is lost: your changes are
        kept, and so is a note you were writing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="press h-11 desk:h-8" onClick={reset}>
          <ArrowClockwiseIcon />
          Reload this view
        </Button>
        <Button
          variant="outline"
          className="press h-11 desk:h-8"
          onClick={() => window.location.reload()}
        >
          Reload Datapad
        </Button>
      </div>
    </section>
  );
}

/** A whole screen with the mark, a heading, a line and one action. */
function Screen({
  title,
  children,
  action,
  onAction,
}: {
  title: string;
  children: ReactNode;
  action: string;
  onAction: () => void;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <section
        aria-labelledby="screen-title"
        className="enter flex max-w-md flex-col gap-3"
      >
        <DatapadMark className="size-8" />
        <h1
          id="screen-title"
          ref={heading}
          tabIndex={-1}
          className="text-page-title outline-none"
        >
          {title}
        </h1>
        <p className="text-state">{children}</p>
        <div>
          <Button className="press h-11 desk:h-8" onClick={onAction}>
            {action}
          </Button>
        </div>
      </section>
    </main>
  );
}

/** In place of the whole app, when something outside a page threw. */
export function AppError() {
  return (
    <Screen
      title="Datapad stopped working"
      action="Reload Datapad"
      onAction={() => window.location.reload()}
    >
      Something went wrong. Nothing is lost: your changes are kept on this
      device until they are saved, and so is a note you were writing.
    </Screen>
  );
}

/**
 * The Access session ended (`src/lib/session.ts`). Reloading goes through
 * Access's sign-in and comes back here, where waiting changes replay.
 */
export function SignedOutPage() {
  return (
    <Screen
      title="Sign in again"
      action="Sign in again"
      onAction={() => window.location.reload()}
    >
      Your session has ended. Changes still waiting and a note you were writing
      are kept on this device, and are saved once you are back.
    </Screen>
  );
}

/**
 * Dev and e2e builds only (`__DEV_ROUTES__`): throws on a `datapad:crash`
 * event naming its boundary, so a spec can prove each fallback. Production
 * drops it with the flag.
 */
export function CrashForTests({ where }: { where: 'page' | 'app' }) {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    const onCrash = (event: Event) => {
      if ((event as CustomEvent<string>).detail === where) setCrash(true);
    };
    window.addEventListener('datapad:crash', onCrash);
    return () => window.removeEventListener('datapad:crash', onCrash);
  }, [where]);
  if (crash) throw new Error(`A ${where} crash a test asked for`);
  return null;
}
