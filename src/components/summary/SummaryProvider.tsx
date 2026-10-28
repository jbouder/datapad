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
  findModel,
  type SummaryModel,
  type SummaryRequest,
  type SummaryTarget,
  summaryRequest,
} from '#shared/summaries';
import { SummaryPanel } from '@/components/summary/SummaryPanel';
import { useDatapad } from '@/hooks/useDatapad';
import { SummaryEngine } from '@/lib/summary-engine';
import {
  engineFactory,
  isModelCached,
  removeModel,
  webGpuSupported,
} from '@/lib/summary-runtime';

/**
 * On-device summaries for the whole app (holocron's `useAnalysis`, for
 * one Markdown answer instead of three JSON ones). The model stays loaded
 * between summaries once the owner has agreed to it, so the second one
 * starts at once; the panel shows whichever item was asked for last.
 */

export type ModelState =
  | { kind: 'unsupported' }
  /** Waiting for the owner to agree to the download. `cached` is unknown until checked. */
  | { kind: 'consent'; cached: boolean | null }
  | { kind: 'loading'; fraction: number; text: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export type Run =
  | { status: 'idle' }
  /** Generating; `text` is empty until the first words arrive. */
  | { status: 'running'; text: string }
  | { status: 'done'; text: string; stopped: boolean }
  | { status: 'error'; text: string; message: string };

export interface Summaries {
  /**
   * Summaries are on for this device (Settings → Summaries). Off, nothing
   * offers Summarize and the model is never loaded.
   */
  enabled: boolean;
  /** Turn summaries on or off on this device; off unloads the model. */
  setEnabled: (on: boolean) => void;
  model: ModelState;
  /** The model the owner picked; remembered on this device. */
  choice: SummaryModel;
  /** Open the summary panel for an item, and summarize it. */
  summarize: (target: SummaryTarget) => void;
  /** Pick another model. Unloads the current one, if any. */
  choose: (modelId: string) => void;
  /** The owner agreed: download if needed, then load. */
  load: () => void;
  /** Back to the opt-in step, freeing the GPU. The cache keeps the weights. */
  unload: () => void;
  /** Delete the chosen model's weights from this browser. */
  remove: () => Promise<void>;
  /** Find out whether the chosen model is cached; returns a cancel. */
  checkCache: () => (() => void) | undefined;
}

const CHOICE_KEY = 'datapad:summary-model';
const ENABLED_KEY = 'datapad:summaries';

/** On unless this device turned them off. */
function storedEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off';
  } catch {
    return true;
  }
}

function rememberEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(ENABLED_KEY);
    else localStorage.setItem(ENABLED_KEY, 'off');
  } catch {
    // Private mode or a full store: the switch still holds for this visit.
  }
}

function storedChoice(): SummaryModel {
  try {
    return findModel(localStorage.getItem(CHOICE_KEY));
  } catch {
    return findModel(null);
  }
}

function rememberChoice(model: SummaryModel) {
  try {
    localStorage.setItem(CHOICE_KEY, model.id);
  } catch {
    // Private mode or a full store: the pick still holds for this visit.
  }
}

/** A short explanation, with the raw reason kept so a failure can be diagnosed. */
function describeError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const detail = raw
    ? ` (${raw.replace(/^TypeError: /, '').slice(0, 160)})`
    : '';
  if (/out of memory|OOM|device lost|buffer size/i.test(raw)) {
    return `The model does not fit in this device’s GPU memory. Try a smaller one in Settings.${detail}`;
  }
  if (/fetch|network|Failed to load|\b[45]\d\d\b/i.test(raw)) {
    return `The download failed. Check the connection, or try another model.${detail}`;
  }
  return raw || 'Something went wrong.';
}

interface Session {
  key: number;
  open: boolean;
  request: SummaryRequest;
}

const Context = createContext<Summaries | null>(null);

export function SummaryProvider({ children }: { children: ReactNode }) {
  const { state } = useDatapad();
  const stateRef = useRef(state);
  stateRef.current = state;

  const [model, setModel] = useState<ModelState>(() =>
    webGpuSupported()
      ? { kind: 'consent', cached: null }
      : { kind: 'unsupported' },
  );
  const [choice, setChoice] = useState<SummaryModel>(storedChoice);
  const [enabled, setEnabledState] = useState(storedEnabled);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [session, setSession] = useState<Session | null>(null);
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const engine = useRef<SummaryEngine | null>(null);
  /** The run in flight, so a closed or replaced one is ignored. */
  const runId = useRef(0);

  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const checkCache = useCallback(() => {
    if (model.kind !== 'consent' || model.cached !== null) return undefined;
    let current = true;
    isModelCached(choice.id).then((cached) => {
      if (current) {
        setModel((m) => (m.kind === 'consent' ? { ...m, cached } : m));
      }
    });
    return () => {
      current = false;
    };
  }, [model, choice.id]);

  // The panel asking is what pulls the library in; the cache check is
  // cheap and changes the wording of the consent step.
  useEffect(() => {
    if (session?.open) return checkCache();
  }, [session?.open, checkCache]);

  const unload = useCallback(() => {
    engine.current?.stop();
    engine.current?.dispose();
    engine.current = null;
    setModel((m) =>
      m.kind === 'unsupported'
        ? m
        : { kind: 'consent', cached: m.kind === 'ready' ? true : null },
    );
  }, []);

  const choose = useCallback(
    (modelId: string) => {
      const next = findModel(modelId);
      if (next.id === choice.id) return;
      engine.current?.stop();
      engine.current?.dispose();
      engine.current = null;
      setChoice(next);
      rememberChoice(next);
      setModel((m) =>
        m.kind === 'unsupported' ? m : { kind: 'consent', cached: null },
      );
    },
    [choice.id],
  );

  const load = useCallback(() => {
    if (engine.current || !enabledRef.current) return;
    const next = new SummaryEngine(engineFactory());
    engine.current = next;
    setModel({ kind: 'loading', fraction: 0, text: 'Starting…' });
    next
      .load(choice.id, (progress) => {
        if (engine.current === next) {
          setModel({ kind: 'loading', ...progress });
        }
      })
      .then(() => {
        if (engine.current === next) setModel({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (engine.current === next) {
          next.dispose();
          engine.current = null;
          setModel({ kind: 'error', message: describeError(error) });
        }
      });
  }, [choice.id]);

  const remove = useCallback(async () => {
    unload();
    await removeModel(choice.id);
    setModel((m) =>
      m.kind === 'unsupported' ? m : { kind: 'consent', cached: false },
    );
  }, [choice.id, unload]);

  const start = useCallback((request: SummaryRequest) => {
    const current = engine.current;
    if (!current?.loaded) return;
    const id = ++runId.current;
    setRun({ status: 'running', text: '' });
    current
      .summarize(request.context, (text) => {
        if (runId.current === id) setRun({ status: 'running', text });
      })
      .then(({ text, stopped }) => {
        if (runId.current === id) setRun({ status: 'done', text, stopped });
      })
      .catch((error: unknown) => {
        if (runId.current === id) {
          setRun((r) => ({
            status: 'error',
            text: 'text' in r ? r.text : '',
            message: describeError(error),
          }));
        }
      });
  }, []);

  const stop = useCallback(() => {
    engine.current?.stop();
  }, []);

  const summarize = useCallback((target: SummaryTarget) => {
    if (!enabledRef.current) return;
    const current = stateRef.current;
    const request = current ? summaryRequest(target, current) : null;
    if (!request) return;
    // A run for another item stops; one at a time keeps the GPU predictable.
    engine.current?.stop();
    runId.current += 1;
    setRun({ status: 'idle' });
    setSession({ key: Date.now(), open: true, request });
  }, []);

  // Ready and asked: go. Covers both "already loaded" and "just loaded".
  useEffect(() => {
    if (session?.open && model.kind === 'ready' && run.status === 'idle') {
      start(session.request);
    }
  }, [session, model.kind, run.status, start]);

  const close = useCallback(() => {
    // Closing interrupts; the run settles as stopped, unseen.
    engine.current?.stop();
    runId.current += 1;
    setSession((s) => (s ? { ...s, open: false } : s));
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      enabledRef.current = on;
      setEnabledState(on);
      rememberEnabled(on);
      // Off: close any summary and free the GPU. The cache keeps the
      // weights; Settings offers to remove them.
      if (!on) {
        close();
        unload();
      }
    },
    [close, unload],
  );

  const value = useMemo(
    () => ({
      enabled,
      setEnabled,
      model,
      choice,
      summarize,
      choose,
      load,
      unload,
      remove,
      checkCache,
    }),
    [
      enabled,
      setEnabled,
      model,
      choice,
      summarize,
      choose,
      load,
      unload,
      remove,
      checkCache,
    ],
  );

  return (
    <Context.Provider value={value}>
      {children}
      {session && (
        <SummaryPanel
          key={session.key}
          open={session.open}
          request={session.request}
          summaries={value}
          run={run}
          onStop={stop}
          onClose={close}
          onExited={() => {
            setSession((s) => (s?.open ? s : null));
            setRun({ status: 'idle' });
          }}
        />
      )}
    </Context.Provider>
  );
}

export function useSummaries(): Summaries {
  const value = useContext(Context);
  if (!value) throw new Error('useSummaries needs SummaryProvider');
  return value;
}
