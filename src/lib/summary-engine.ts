import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { REQUEST_SETTINGS, SYSTEM_PROMPT } from '#shared/summaries';

/**
 * One loaded summary model and the runs it makes (holocron's
 * `analysis-engine.ts`). Where the model comes from is the factory's
 * business (`summary-runtime.ts`: WebLLM in a Web Worker), so this part is
 * unit-tested with a fake and no GPU.
 */

export interface LoadProgress {
  /** 0–1. */
  fraction: number;
  text: string;
}

/** The part of WebLLM's engine this wrapper uses; tests pass a fake. */
export type ChatEngine = Pick<MLCEngineInterface, 'chat' | 'interruptGenerate'>;

/** Makes a loaded engine; the default runs WebLLM in a Web Worker. */
export type EngineFactory = (
  modelId: string,
  onProgress: (progress: LoadProgress) => void,
) => Promise<{ engine: ChatEngine; dispose: () => void }>;

export interface Generation {
  text: string;
  /** Stop (or closing the panel) cut it short. */
  stopped: boolean;
}

export class SummaryEngine {
  private engine: ChatEngine | null = null;
  private release: (() => void) | null = null;
  private interrupted = false;
  private readonly create: EngineFactory;

  constructor(create: EngineFactory) {
    this.create = create;
  }

  get loaded(): boolean {
    return this.engine !== null;
  }

  /** Download (first time) and load a model. Reports progress as it goes. */
  async load(
    modelId: string,
    onProgress: (progress: LoadProgress) => void,
  ): Promise<void> {
    const { engine, dispose } = await this.create(modelId, onProgress);
    this.engine = engine;
    this.release = dispose;
  }

  /**
   * One summary of `context`, streamed: `onText` gets the whole text so
   * far after every chunk. Resolves with the text, marked `stopped` when
   * `stop()` cut it short. `prompt` is the system prompt (Brief me sends
   * its own).
   */
  async summarize(
    context: string,
    onText: (text: string) => void,
    prompt: string = SYSTEM_PROMPT,
  ): Promise<Generation> {
    if (!this.engine) {
      throw new Error('The model is not loaded');
    }
    this.interrupted = false;
    const stream = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: context },
      ],
      ...REQUEST_SETTINGS,
      stream: true,
    });
    let text = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        onText(text);
      }
    }
    return { text, stopped: this.interrupted };
  }

  /** Stop the generation in flight; `summarize()` resolves with what it has. */
  stop() {
    if (!this.engine) return;
    this.interrupted = true;
    this.engine.interruptGenerate();
  }

  /** Stop the worker, which frees the GPU with it. The cached weights stay. */
  dispose() {
    this.engine = null;
    this.release?.();
    this.release = null;
  }
}
