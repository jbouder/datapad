import type { AppConfig, ModelRecord } from '@mlc-ai/web-llm';
import { SUMMARY_MODELS } from '#shared/summaries';

/**
 * Where WebLLM downloads each summary model from, pinned, with the
 * integrity hashes WebLLM checks. Its own defaults (`prebuiltAppConfig`)
 * load the WebGPU library from `main` of mlc-ai/binary-mlc-llm-libs and
 * the weights from `main` of each Hugging Face repository: both branches
 * move. Here both are commits, and WebLLM refuses a library, config or
 * tokenizer whose bytes do not match (an `IntegrityError`, shown as a
 * load failure). The weight shards themselves WebLLM cannot check; a
 * commit on Hugging Face is content-addressed, so pinning it is what
 * keeps them from changing under us.
 *
 * Moving to a new @mlc-ai/web-llm: if its `modelVersion` changed, the
 * libraries must too (test/summary-pins.test.ts fails until they do).
 * Take the newest commit of binary-mlc-llm-libs and each repository's
 * newest revision (`https://huggingface.co/api/models/<repo>` → `sha`),
 * download the files below from them, and hash each with
 * `openssl dgst -sha384 -binary <file> | base64`.
 */

/** The WebLLM build these libraries are for (its `modelVersion`). */
export const WEBLLM_MODEL_VERSION = 'v0_2_86/base';

/** mlc-ai/binary-mlc-llm-libs at a commit, not `main`. */
export const MODEL_LIB_COMMIT = '00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0';

const MODEL_LIB_PREFIX = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${MODEL_LIB_COMMIT}/web-llm-models/${WEBLLM_MODEL_VERSION}/`;

/** The same tokenizer for every Qwen3 build. */
const QWEN3_TOKENIZER =
  'sha384-bBcp1iraOY8O3lJXFKDjSlRbqFZ2wbSX1HMscuq4lbj4bO+YyBt2tRf6Kj8+hxFw';

interface Pin {
  /** The Hugging Face revision of `mlc-ai/<id>`. */
  revision: string;
  /** The library's file name under the pinned commit. */
  lib: string;
  libSri: string;
  configSri: string;
  /** WebLLM's own figures for the model, as `prebuiltAppConfig` has them. */
  vramMB: number;
  lowResource: boolean;
}

export const MODEL_PINS: Record<string, Pin> = {
  'Qwen3-1.7B-q4f16_1-MLC': {
    revision: '80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc',
    lib: 'Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm',
    libSri:
      'sha384-Nl0m2ynzyk2i2j+XyK8Og/dAjX2xlKfgrkjOCwmhQEgmOit1qbAqcrhKy9WjE0J4',
    configSri:
      'sha384-X+UwGfB2vtN1DuSZFxz1/41rzSrFguvyGeha2kgsNuD8HOxT7CgMQqI+8+70J0co',
    vramMB: 2036.66,
    lowResource: true,
  },
  'Qwen3-4B-q4f16_1-MLC': {
    revision: 'a5c9fab855e3ccbdfed2e7e69683d75f30332161',
    lib: 'Qwen3-4B-q4f16_1_cs1k-webgpu.wasm',
    libSri:
      'sha384-UI6LgZYcCgIdelusHFxuBMRNhkUKhxLXvMmW71jcrJVQio574h1T1jFYJb8Ka9N8',
    configSri:
      'sha384-Yo1DjNqBDvWubvvsyygtHsm1QMVZSH2/kEysKCGdOFTlH3pYFhOkkv5HTm9H7EBV',
    vramMB: 3431.59,
    lowResource: true,
  },
  'Qwen3-8B-q4f16_1-MLC': {
    revision: 'b3d55c289eae58f77095f5b68c895eeea358ee09',
    lib: 'Qwen3-8B-q4f16_1_cs1k-webgpu.wasm',
    libSri:
      'sha384-9n+UFYZ4MJEaacxyJMsHc+XLoZeLl+qFi5coUAi1FDDz5mNyKKVdmV6w/U2+7EBJ',
    configSri:
      'sha384-yuak+7g940x0KPOHegKbpGI+J4DErBfraqicWC/nhcSxrWeZlGH2qY9ora+vMPki',
    vramMB: 5695.78,
    lowResource: false,
  },
};

function record(id: string, pin: Pin): ModelRecord {
  return {
    model: `https://huggingface.co/mlc-ai/${id}/resolve/${pin.revision}`,
    model_id: id,
    model_lib: MODEL_LIB_PREFIX + pin.lib,
    vram_required_MB: pin.vramMB,
    low_resource_required: pin.lowResource,
    overrides: { context_window_size: 4096 },
    integrity: {
      model_lib: pin.libSri,
      config: pin.configSri,
      tokenizer: { 'tokenizer.json': QWEN3_TOKENIZER },
      onFailure: 'error',
    },
  };
}

/** The `appConfig` every WebLLM call gets: only the models Summarize offers. */
export const APP_CONFIG: AppConfig = {
  model_list: SUMMARY_MODELS.flatMap((m) => {
    const pin = MODEL_PINS[m.id];
    return pin ? [record(m.id, pin)] : [];
  }),
};
