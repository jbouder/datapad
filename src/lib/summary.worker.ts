import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * The Web Worker that runs the summary model, so the app stays responsive
 * while it downloads and generates. Loaded only when the owner agrees to
 * the download; see `summary-engine.ts`. Holocron's `analysis.worker.ts`.
 */

// Hugging Face refuses requests that carry a Referer from a `*.workers.dev`
// page (the browser then reports a bare "Failed to fetch"). The weights are
// public and nothing of Datapad is in the request, so send no referrer at
// all. This covers the loader's plain fetches; the ones it makes through
// `Cache.add()` bypass any wrapper and rely on the `Referrer-Policy` header
// that `public/_headers` puts on every asset, this script included.
const originalFetch = self.fetch.bind(self);
self.fetch = (input, init) =>
  originalFetch(input, { referrerPolicy: 'no-referrer', ...init });

const handler = new WebWorkerMLCEngineHandler();
self.addEventListener('message', (event) => handler.onmessage(event));
