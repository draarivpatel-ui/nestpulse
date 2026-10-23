/* NestPulse Model Fit math: quantized weight sizes, KV cache, and budget checks.
   Shared by the browser UI (window.NestPulseModels) and the node:test suites (module.exports).
   Model specs are planning approximations from public model cards, not measured checkpoints. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseModels = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RUNTIME_OVERHEAD_BYTES = 1e9; // Flat allowance for runtime buffers and activations.

  const QUANTS = [
    { id: 'q2k', label: 'Q2 K', bitsPerWeight: 3.0 },
    { id: 'q3km', label: 'Q3 K M', bitsPerWeight: 3.9 },
    { id: 'q4km', label: 'Q4 K M', bitsPerWeight: 4.8 },
    { id: 'q5km', label: 'Q5 K M', bitsPerWeight: 5.7 },
    { id: 'q6k', label: 'Q6 K', bitsPerWeight: 6.6 },
    { id: 'q8', label: 'Q8', bitsPerWeight: 8.5 },
    { id: 'f16', label: 'FP16', bitsPerWeight: 16 },
  ].sort(function (a, b) { return a.bitsPerWeight - b.bitsPerWeight; });

  const CATALOG = [
    { id: 'qwen3-0.6b', name: 'Qwen3 0.6B', family: 'Qwen3', params: 0.6, layers: 28, kvDim: 1024, contextMax: 40960 },
    { id: 'qwen3-1.7b', name: 'Qwen3 1.7B', family: 'Qwen3', params: 1.7, layers: 28, kvDim: 1024, contextMax: 40960 },
    { id: 'llama-3.2-3b', name: 'Llama 3.2 3B', family: 'Llama', params: 3.2, layers: 28, kvDim: 1024, contextMax: 131072 },
    { id: 'qwen3-4b', name: 'Qwen3 4B', family: 'Qwen3', params: 4, layers: 36, kvDim: 1024, contextMax: 40960 },
    { id: 'gemma-3-4b', name: 'Gemma 3 4B', family: 'Gemma', params: 4.3, layers: 34, kvDim: 1024, contextMax: 131072 },
    { id: 'ds-r1-qwen-7b', name: 'DeepSeek R1 Distill Qwen 7B', family: 'DeepSeek', params: 7.6, layers: 28, kvDim: 512, contextMax: 131072 },
    { id: 'mistral-7b', name: 'Mistral 7B v0.3', family: 'Mistral', params: 7.2, layers: 32, kvDim: 1024, contextMax: 32768 },
    { id: 'qwen3-8b', name: 'Qwen3 8B', family: 'Qwen3', params: 8.2, layers: 36, kvDim: 1024, contextMax: 40960 },
    { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', family: 'Llama', params: 8, layers: 32, kvDim: 1024, contextMax: 131072 },
    { id: 'qwen3-14b', name: 'Qwen3 14B', family: 'Qwen3', params: 14, layers: 40, kvDim: 1024, contextMax: 40960 },
    { id: 'phi-4-14b', name: 'Phi 4 14B', family: 'Phi', params: 14, layers: 40, kvDim: 1280, contextMax: 16384 },
    { id: 'gemma-3-27b', name: 'Gemma 3 27B', family: 'Gemma', params: 27, layers: 62, kvDim: 2048, contextMax: 131072 },
    { id: 'qwen3-32b', name: 'Qwen3 32B', family: 'Qwen3', params: 32, layers: 64, kvDim: 1024, contextMax: 40960 },
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', family: 'Llama', params: 70, layers: 80, kvDim: 1024, contextMax: 131072 },
  ];

  function weightBytes(paramsBillions, bitsPerWeight) {
    return paramsBillions * 1e9 * bitsPerWeight / 8;
  }

  /* KV cache per token, fp16, two tensors (K and V) per layer. */
  function kvBytesPerToken(model) {
    return 2 * model.layers * model.kvDim * 2;
  }

  function kvBytes(model, tokens) {
    return kvBytesPerToken(model) * Math.max(0, tokens);
  }

  function totalBytes(model, quant, tokens) {
    return weightBytes(model.params, quant.bitsPerWeight) + kvBytes(model, tokens) + RUNTIME_OVERHEAD_BYTES;
  }

  function fitCheck(model, quant, budgetBytes, tokens) {
    const total = totalBytes(model, quant, tokens);
    const fits = total <= budgetBytes;
    const utilization = budgetBytes > 0 ? total / budgetBytes : Infinity;
    let verdict;
    if (!fits) {
      verdict = 'no';
    } else if (utilization <= 0.8) {
      verdict = 'comfortable';
    } else {
      verdict = 'tight';
    }
    return {
      fits: fits,
      totalBytes: total,
      freeBytes: budgetBytes - total,
      utilization: utilization,
      verdict: verdict,
      shortfallBytes: fits ? 0 : total - budgetBytes,
    };
  }

  /* Largest context (in tokens) that fits once weights and runtime overhead are paid. */
  function maxTokens(model, quant, budgetBytes) {
    const weights = weightBytes(model.params, quant.bitsPerWeight);
    const perToken = kvBytesPerToken(model);
    const room = budgetBytes - weights - RUNTIME_OVERHEAD_BYTES;
    if (room <= 0 || perToken <= 0) {
      return 0;
    }
    return Math.floor(room / perToken);
  }

  /* The highest quality quantization that fits, walking QUANTS from smallest to largest.
     Returns null when nothing fits at all. */
  function bestQuant(model, budgetBytes, tokens) {
    let best = null;
    for (const quant of QUANTS) {
      if (fitCheck(model, quant, budgetBytes, tokens).fits) {
        best = quant;
      }
    }
    return best;
  }

  function gb(bytes) {
    return (bytes / 1e9).toFixed(2);
  }

  /* The sentence the UI shows so every verdict can be checked by hand. */
  function arithmeticLine(model, quant, tokens, budgetBytes) {
    return model.name + ' at ' + quant.label + ': ' + model.params + ' B weights at '
      + quant.bitsPerWeight + ' bits per weight = ' + gb(weightBytes(model.params, quant.bitsPerWeight))
      + ' GB, a ' + tokens.toLocaleString('en-US') + ' token context adds ' + gb(kvBytes(model, tokens))
      + ' GB, runtime adds ' + gb(RUNTIME_OVERHEAD_BYTES) + ' GB, total ' + gb(totalBytes(model, quant, tokens))
      + ' GB of the ' + gb(budgetBytes) + ' GB budget.';
  }

  return {
    RUNTIME_OVERHEAD_BYTES: RUNTIME_OVERHEAD_BYTES,
    QUANTS: QUANTS,
    CATALOG: CATALOG,
    weightBytes: weightBytes,
    kvBytesPerToken: kvBytesPerToken,
    kvBytes: kvBytes,
    totalBytes: totalBytes,
    fitCheck: fitCheck,
    maxTokens: maxTokens,
    bestQuant: bestQuant,
    arithmeticLine: arithmeticLine,
  };
});
