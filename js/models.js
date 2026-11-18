/* NestPulse Memory Fit math: quantized weight sizes, KV cache, and budget checks.
   Shared by the browser UI (window.NestPulseModels) and the node:test suites (module.exports).
   Catalog specs are illustrative planning values, not measured checkpoints. */
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
    { id: 'tiny-06', name: 'Compact 0.6B', family: 'Compact', params: 0.6, layers: 28, kvDim: 1024, contextMax: 40960 },
    { id: 'tiny-17', name: 'Compact 1.7B', family: 'Compact', params: 1.7, layers: 28, kvDim: 1024, contextMax: 40960 },
    { id: 'small-32', name: 'Balanced 3.2B', family: 'Balanced', params: 3.2, layers: 28, kvDim: 1024, contextMax: 131072 },
    { id: 'small-40', name: 'Balanced 4B', family: 'Balanced', params: 4, layers: 36, kvDim: 1024, contextMax: 40960 },
    { id: 'small-43', name: 'Wide 4.3B', family: 'Wide', params: 4.3, layers: 34, kvDim: 1024, contextMax: 131072 },
    { id: 'mid-76', name: 'Distilled 7.6B', family: 'Distilled', params: 7.6, layers: 28, kvDim: 512, contextMax: 131072 },
    { id: 'mid-72', name: 'Standard 7.2B', family: 'Standard', params: 7.2, layers: 32, kvDim: 1024, contextMax: 32768 },
    { id: 'mid-82', name: 'Balanced 8.2B', family: 'Balanced', params: 8.2, layers: 36, kvDim: 1024, contextMax: 40960 },
    { id: 'mid-80', name: 'Standard 8B', family: 'Standard', params: 8, layers: 32, kvDim: 1024, contextMax: 131072 },
    { id: 'large-14', name: 'Balanced 14B', family: 'Balanced', params: 14, layers: 40, kvDim: 1024, contextMax: 40960 },
    { id: 'large-14w', name: 'Wide 14B', family: 'Wide', params: 14, layers: 40, kvDim: 1280, contextMax: 16384 },
    { id: 'xl-27', name: 'Wide 27B', family: 'Wide', params: 27, layers: 62, kvDim: 2048, contextMax: 131072 },
    { id: 'xl-32', name: 'Deep 32B', family: 'Deep', params: 32, layers: 64, kvDim: 1024, contextMax: 40960 },
    { id: 'xxl-70', name: 'Deep 70B', family: 'Deep', params: 70, layers: 80, kvDim: 1024, contextMax: 131072 },
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
