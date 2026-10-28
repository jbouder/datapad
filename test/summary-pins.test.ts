import { describe, expect, it } from 'vitest';
import { SUMMARY_MODELS } from '#shared/summaries';
import webLlmConfig from '../node_modules/@mlc-ai/web-llm/lib/config.d.ts?raw';
import headers from '../public/_headers?raw';
import {
  APP_CONFIG,
  MODEL_LIB_COMMIT,
  WEBLLM_MODEL_VERSION,
} from '../src/lib/summary-pins';

/**
 * The summary model's downloads are pinned (src/lib/summary-pins.ts): the
 * WebGPU library to a commit, the weights to a revision, with WebLLM's
 * integrity hashes. Nothing here downloads; it holds the pins' shape and
 * that they still suit the installed WebLLM.
 */

const SRI = /^sha384-[A-Za-z0-9+/]{64}$/;

describe('summary model pins', () => {
  it('pin every model Summarize offers, and only those', () => {
    expect(APP_CONFIG.model_list.map((m) => m.model_id)).toEqual(
      SUMMARY_MODELS.map((m) => m.id),
    );
  });

  it('suit the installed WebLLM (a bump that changes its libraries fails here)', () => {
    const installed = /modelVersion = "([^"]+)"/.exec(webLlmConfig)?.[1];
    expect(installed, 'move the pins with @mlc-ai/web-llm').toBe(
      WEBLLM_MODEL_VERSION,
    );
  });

  it('load the library from a commit, never a branch', () => {
    expect(MODEL_LIB_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    for (const m of APP_CONFIG.model_list) {
      expect(m.model_lib).toBe(
        `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${MODEL_LIB_COMMIT}/web-llm-models/${WEBLLM_MODEL_VERSION}/${m.model_id.replace('-MLC', '')}_cs1k-webgpu.wasm`,
      );
      expect(m.model_lib).not.toContain('/main/');
    }
  });

  it('load the weights from a revision, never a branch', () => {
    for (const m of APP_CONFIG.model_list) {
      expect(m.model).toMatch(
        new RegExp(
          `^https://huggingface\\.co/mlc-ai/${m.model_id.replace(/\./g, '\\.')}/resolve/[0-9a-f]{40}$`,
        ),
      );
    }
  });

  it('check the library, config and tokenizer, and fail on a mismatch', () => {
    for (const m of APP_CONFIG.model_list) {
      expect(m.integrity?.onFailure).toBe('error');
      expect(m.integrity?.model_lib).toMatch(SRI);
      expect(m.integrity?.config).toMatch(SRI);
      expect(m.integrity?.tokenizer?.['tokenizer.json']).toMatch(SRI);
    }
  });

  it('come only from hosts the CSP already allows', () => {
    const csp = /^\s*Content-Security-Policy: (.+)$/m.exec(headers)?.[1] ?? '';
    const connect = /connect-src ([^;]+);/.exec(csp)?.[1]?.split(' ') ?? [];
    for (const m of APP_CONFIG.model_list) {
      for (const url of [m.model, m.model_lib]) {
        expect(connect).toContain(new URL(url).origin);
      }
    }
  });
});
