import { type RefObject, useCallback, useRef, useState } from 'react';
import type { BaseOp } from '#shared/protocol';
import type { Snapshot } from '#shared/types';
import {
  emptyHistory,
  HISTORY_MAX,
  type History,
  inverse,
  recordStep,
} from '@/lib/board-history';

/**
 * A board's undo and redo: two local stacks of inverse ops, for as long
 * as the board is open (it is gone when the board unmounts). `run` sends
 * ops and remembers what undoes them; `undo` and `redo` send a step from
 * one stack and push its inverse on the other. Everything goes out
 * through `send` (the board's normal actions), so it syncs like any edit.
 */
export function useHistory(
  stateRef: RefObject<Snapshot | null>,
  send: (ops: BaseOp[]) => boolean,
) {
  const history = useRef<History>(emptyHistory());
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const sync = useCallback(() => {
    const { undo, redo } = history.current;
    setCounts((c) =>
      c.undo === undo.length && c.redo === redo.length
        ? c
        : { undo: undo.length, redo: redo.length },
    );
  }, []);

  const invert = useCallback(
    (ops: BaseOp[]) => {
      const state = stateRef.current;
      return state ? inverse(state, ops, new Date().toISOString()) : null;
    },
    [stateRef],
  );

  /** Sends `ops` as one step that undo takes back. */
  const run = useCallback(
    (ops: BaseOp[]) => {
      if (ops.length === 0) return false;
      const undo = invert(ops);
      const ok = send(ops);
      if (ok && undo) {
        history.current = recordStep(history.current, undo);
        sync();
      }
      return ok;
    },
    [invert, send, sync],
  );

  const step = useCallback(
    (from: 'undo' | 'redo') => {
      const stack = history.current[from];
      const ops = stack.at(-1);
      if (!ops) return false;
      const back = invert(ops);
      const ok = send(ops);
      const to = from === 'undo' ? 'redo' : 'undo';
      const next = {
        ...history.current,
        [from]: stack.slice(0, -1),
      } as History;
      if (ok && back && back.length > 0) {
        next[to] = [...next[to], back].slice(-HISTORY_MAX);
      }
      history.current = next;
      sync();
      return ok;
    },
    [invert, send, sync],
  );

  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  /** Forgets the latest step when `test` says so (an empty text dropped). */
  const forgetLast = useCallback(
    (test: (ops: BaseOp[]) => boolean) => {
      const last = history.current.undo.at(-1);
      if (last && test(last)) {
        history.current = {
          ...history.current,
          undo: history.current.undo.slice(0, -1),
        };
        sync();
      }
    },
    [sync],
  );

  const clear = useCallback(() => {
    history.current = emptyHistory();
    sync();
  }, [sync]);

  return {
    run,
    undo,
    redo,
    forgetLast,
    clear,
    canUndo: counts.undo > 0,
    canRedo: counts.redo > 0,
  };
}
