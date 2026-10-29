import { describe, expect, it } from 'vitest';
import {
  BRIEF_PROMPT,
  REQUEST_SETTINGS,
  SYSTEM_PROMPT,
} from '#shared/summaries';
import {
  type ChatEngine,
  type EngineFactory,
  SummaryEngine,
} from '../src/lib/summary-engine';

/**
 * The engine wrapper against a fake WebLLM engine: no GPU in CI. The fake
 * streams its chunks one per tick and stops early when interrupted, as
 * WebLLM's does.
 */
function fake(chunks: string[]) {
  const requests: unknown[] = [];
  let interrupted = false;
  let disposed = 0;
  let onChunk: ((index: number) => void) | undefined;
  const engine = {
    interruptGenerate: () => {
      interrupted = true;
    },
    chat: {
      completions: {
        create: async (request: unknown) => {
          requests.push(request);
          interrupted = false;
          return (async function* () {
            for (const [i, content] of chunks.entries()) {
              await Promise.resolve();
              if (interrupted) return;
              onChunk?.(i);
              yield { choices: [{ delta: { content } }] };
            }
          })();
        },
      },
    },
  } as unknown as ChatEngine;
  const factory: EngineFactory = async (_id, onProgress) => {
    onProgress({ fraction: 1, text: 'done' });
    return { engine, dispose: () => (disposed += 1) };
  };
  return {
    factory,
    requests,
    disposed: () => disposed,
    onChunk: (fn: (index: number) => void) => (onChunk = fn),
  };
}

describe('SummaryEngine', () => {
  it('refuses to run before it is loaded', async () => {
    const engine = new SummaryEngine(fake([]).factory);
    expect(engine.loaded).toBe(false);
    await expect(engine.summarize('x', () => {})).rejects.toThrow('not loaded');
  });

  it('loads with progress, then streams the text in', async () => {
    const f = fake(['One ', 'two ', 'three.']);
    const engine = new SummaryEngine(f.factory);
    const progress: number[] = [];
    await engine.load('Qwen3-1.7B-q4f16_1-MLC', (p) =>
      progress.push(p.fraction),
    );
    expect(progress).toEqual([1]);
    const seen: string[] = [];
    const result = await engine.summarize('Project: Echo Base', (t) =>
      seen.push(t),
    );
    expect(seen).toEqual(['One ', 'One two ', 'One two three.']);
    expect(result).toEqual({ text: 'One two three.', stopped: false });
  });

  it('leaves out the empty <think> block Qwen3 opens with', async () => {
    const f = fake(['<thi', 'nk>\n\n</th', 'ink>\n\n', 'One ', 'two.']);
    const engine = new SummaryEngine(f.factory);
    await engine.load('m', () => {});
    const seen: string[] = [];
    const result = await engine.summarize('x', (t) => seen.push(t));
    expect(seen).toEqual(['One ', 'One two.']);
    expect(result).toEqual({ text: 'One two.', stopped: false });
  });

  it('sends holocron’s settings, streamed, with the system prompt', async () => {
    const f = fake(['ok']);
    const engine = new SummaryEngine(f.factory);
    await engine.load('m', () => {});
    await engine.summarize('Task: Calibrate', () => {});
    expect(f.requests).toEqual([
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Task: Calibrate' },
        ],
        ...REQUEST_SETTINGS,
        stream: true,
      },
    ]);
  });

  it('sends another system prompt when asked (Brief me)', async () => {
    const f = fake(['ok']);
    const engine = new SummaryEngine(f.factory);
    await engine.load('m', () => {});
    await engine.summarize('Today is Wed.', () => {}, BRIEF_PROMPT);
    expect(f.requests).toEqual([
      {
        messages: [
          { role: 'system', content: BRIEF_PROMPT },
          { role: 'user', content: 'Today is Wed.' },
        ],
        ...REQUEST_SETTINGS,
        stream: true,
      },
    ]);
  });

  it('stops: keeps the partial text and says it was stopped', async () => {
    const f = fake(['One ', 'two ', 'three.']);
    const engine = new SummaryEngine(f.factory);
    await engine.load('m', () => {});
    f.onChunk((i) => {
      if (i === 1) engine.stop();
    });
    const result = await engine.summarize('x', () => {});
    expect(result).toEqual({ text: 'One two ', stopped: true });
    // The next run starts clean.
    f.onChunk(() => {});
    expect(await engine.summarize('x', () => {})).toEqual({
      text: 'One two three.',
      stopped: false,
    });
  });

  it('dispose frees the worker and unloads', async () => {
    const f = fake([]);
    const engine = new SummaryEngine(f.factory);
    await engine.load('m', () => {});
    engine.dispose();
    expect(f.disposed()).toBe(1);
    expect(engine.loaded).toBe(false);
  });
});
