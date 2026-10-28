import type { ChatEngine, EngineFactory } from '@/lib/summary-engine';
import { APP_CONFIG } from '@/lib/summary-pins';

/**
 * Where the summary model comes from: WebLLM in a Web Worker.
 * `@mlc-ai/web-llm` is imported lazily here (and statically in the
 * worker), so neither reaches the main bundle: nothing loads until the
 * owner asks for a summary, and nothing downloads until they agree.
 * Every call passes `APP_CONFIG` (src/lib/summary-pins.ts): the library
 * and weights at pinned commits, with integrity hashes.
 */

/**
 * The e2e build can swap the model for a scripted one (`e2e/summaries
 * .spec.ts`); `__DEV_ROUTES__` is false in production, so the bundle drops
 * this hook entirely.
 */
interface FakeModel {
  chunks: string[];
  /** Between chunks, so Stop has something to stop. */
  delayMs?: number;
  cached?: boolean;
  /** The last request it was sent, for a spec to read what it was shown. */
  lastRequest?: unknown;
  /** Loading fails with this message, as a download or GPU error would. */
  failLoad?: string;
}

function fakeModel(): FakeModel | undefined {
  if (!__DEV_ROUTES__ || typeof window === 'undefined') return undefined;
  return (window as { __datapadFakeModel?: FakeModel }).__datapadFakeModel;
}

export function webGpuSupported(): boolean {
  if (fakeModel()) return true;
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** Whether a model's weights are already in this browser's cache. */
export async function isModelCached(modelId: string): Promise<boolean> {
  const fake = fakeModel();
  if (fake) return fake.cached ?? false;
  const { hasModelInCache } = await import('@mlc-ai/web-llm');
  try {
    return await hasModelInCache(modelId, APP_CONFIG);
  } catch {
    return false;
  }
}

/** Delete a model's weights from this browser's cache. */
export async function removeModel(modelId: string): Promise<void> {
  const fake = fakeModel();
  if (fake) {
    fake.cached = false;
    return;
  }
  const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
  await deleteModelAllInfoInCache(modelId, APP_CONFIG);
  await removeUnpinned(modelId);
}

/**
 * A copy downloaded before the pins, from WebLLM's moving defaults: it
 * sits under other URLs, so it is never used again. Freed once the pinned
 * copy has loaded, and whenever the model is removed.
 */
async function removeUnpinned(modelId: string): Promise<void> {
  try {
    const { deleteModelAllInfoInCache, hasModelInCache } = await import(
      '@mlc-ai/web-llm'
    );
    if (await hasModelInCache(modelId)) {
      await deleteModelAllInfoInCache(modelId);
    }
  } catch {
    // Nothing there, or the cache refused: it stays until the browser
    // clears it.
  }
}

const webLlm: EngineFactory = async (modelId, onProgress) => {
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
  const worker = new Worker(new URL('./summary.worker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
      appConfig: APP_CONFIG,
      initProgressCallback: (report) =>
        onProgress({ fraction: report.progress, text: report.text }),
      logLevel: 'WARN',
    });
    void removeUnpinned(modelId);
    return { engine, dispose: () => worker.terminate() };
  } catch (error) {
    worker.terminate();
    throw error;
  }
};

/** A scripted engine for the e2e build: streams its chunks, honors Stop. */
function scripted(fake: FakeModel): EngineFactory {
  return async (_modelId, onProgress) => {
    if (fake.failLoad) throw new Error(fake.failLoad);
    onProgress({ fraction: 1, text: 'Loaded the test model' });
    fake.cached = true;
    let interrupted = false;
    const engine = {
      interruptGenerate: () => {
        interrupted = true;
      },
      chat: {
        completions: {
          create: async (request: unknown) => {
            fake.lastRequest = request;
            interrupted = false;
            return (async function* () {
              for (const chunk of fake.chunks) {
                await new Promise((r) => setTimeout(r, fake.delayMs ?? 0));
                if (interrupted) return;
                yield { choices: [{ delta: { content: chunk } }] };
              }
            })();
          },
        },
      },
    } as unknown as ChatEngine;
    return { engine, dispose: () => {} };
  };
}

/** WebLLM, or the scripted model in an e2e run that asked for it. */
export function engineFactory(): EngineFactory {
  const fake = fakeModel();
  return fake ? scripted(fake) : webLlm;
}
