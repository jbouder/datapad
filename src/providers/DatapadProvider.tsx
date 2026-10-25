import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MAIN_SPACE, type SpaceInfo } from '#shared/types';
import { useConfig } from '@/hooks/useConfig';
import { DatapadContext, useDatapadConnection } from '@/hooks/useDatapad';
import { createSpace as postCreateSpace } from '@/lib/api';
import { withViewTransition } from '@/lib/motion';
import { currentRoute, navigate } from '@/lib/router';
import { routeAfterSwitch, SPACE_KEY } from '@/lib/spaces';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

const EmailContext = createContext<string | null>(null);

export interface Spaces {
  /** Every space, in switcher order (just the open one until it loads). */
  spaces: SpaceInfo[];
  /** The space this device has open. */
  current: SpaceInfo;
  /** Open another space (remembered on this device). */
  switchSpace: (id: string) => void;
  /** Make a space and open it; false (and a toast) when refused. */
  createSpace: (name: string) => Promise<boolean>;
}

const SpacesContext = createContext<Spaces | null>(null);

/** The space this device had open last; Main when none (or no storage). */
function readSpace(): string {
  try {
    return localStorage.getItem(SPACE_KEY) || MAIN_SPACE;
  } catch {
    return MAIN_SPACE;
  }
}

function saveSpace(id: string) {
  try {
    localStorage.setItem(SPACE_KEY, id);
  } catch {
    // Private mode or blocked storage: the switch holds for this session.
  }
}

/**
 * Opens the one connection the app has and shares it, on the space this
 * device has open. Inside `ToastProvider`: a refused change is toasted
 * with its reason.
 */
export function DatapadProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const email = config?.email ?? null;
  const { show } = useToast();
  const { active } = useMotion();
  const [space, setSpace] = useState(readSpace);
  /** The space last made here, named before the list catches up. */
  const [made, setMade] = useState<SpaceInfo | null>(null);
  const datapad = useDatapadConnection(email, space, show);

  const switchSpace = useCallback(
    (id: string) => {
      if (id === space) return;
      saveSpace(id);
      // A project, person or org belongs to the space being left.
      const leave = routeAfterSwitch(currentRoute());
      withViewTransition(
        () => {
          setSpace(id);
          if (leave) navigate(leave, { replace: true, instant: true });
        },
        active,
        'space',
      );
    },
    [space, active],
  );

  // The server opened another space than asked for (an unknown id, or
  // this one was deleted): that one is open now.
  const opened = datapad.space;
  useEffect(() => {
    if (opened && opened !== space) switchSpace(opened);
  }, [opened, space, switchSpace]);

  const createSpace = useCallback(
    async (name: string) => {
      try {
        const created = await postCreateSpace(name);
        setMade(created);
        switchSpace(created.id);
        return true;
      } catch (error) {
        show(error instanceof Error ? error.message : 'Could not add a space');
        return false;
      }
    },
    [switchSpace, show],
  );

  const spaces = useMemo(() => {
    if (datapad.spaces.some((s) => s.id === space)) return datapad.spaces;
    // Not loaded yet, or just made: show the open one at least.
    const placeholder: SpaceInfo =
      made?.id === space
        ? made
        : {
            id: space,
            name: space === MAIN_SPACE ? 'Main' : 'Space',
            position: Number.MAX_SAFE_INTEGER,
            createdAt: '',
          };
    return [...datapad.spaces, placeholder];
  }, [datapad.spaces, space, made]);
  const current = spaces.find((s) => s.id === space) as SpaceInfo;

  const value = useMemo(
    () => ({ spaces, current, switchSpace, createSpace }),
    [spaces, current, switchSpace, createSpace],
  );

  return (
    <EmailContext.Provider value={email}>
      <SpacesContext.Provider value={value}>
        <DatapadContext.Provider value={datapad}>
          {children}
        </DatapadContext.Provider>
      </SpacesContext.Provider>
    </EmailContext.Provider>
  );
}

/** The signed-in email, verified by Access. Null until it arrives. */
export function useEmail(): string | null {
  return useContext(EmailContext);
}

/** The spaces, the open one, and switching. Inside `DatapadProvider`. */
export function useSpaces(): Spaces {
  const value = useContext(SpacesContext);
  if (!value) throw new Error('useSpaces must be used inside DatapadProvider');
  return value;
}

/** The open space's name when there is more than one, for titles. */
export function useSpaceTitle(): string | null {
  const value = useContext(SpacesContext);
  return value && value.spaces.length > 1 ? value.current.name : null;
}
