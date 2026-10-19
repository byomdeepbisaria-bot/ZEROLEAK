export type NerBackend = "webgpu" | "wasm";

export async function loadNerWithFallback<T>(
  preferWebGpu: boolean,
  createPipeline: (backend: NerBackend) => Promise<T>,
  onFallback: (reason: "unavailable" | "initialization-failed") => void,
): Promise<{ pipeline: T; backend: NerBackend }> {
  if (preferWebGpu) {
    try {
      return { pipeline: await createPipeline("webgpu"), backend: "webgpu" };
    } catch {
      onFallback("initialization-failed");
    }
  } else {
    onFallback("unavailable");
  }

  return { pipeline: await createPipeline("wasm"), backend: "wasm" };
}

export async function inferWithWasmFallback<T>(
  backend: NerBackend,
  infer: () => Promise<T>,
  createWasmInference: () => Promise<() => Promise<T>>,
  onFallback: () => void,
): Promise<{ result: T; usedFallback: boolean }> {
  try {
    return { result: await infer(), usedFallback: false };
  } catch (error) {
    if (backend !== "webgpu") throw error;
    onFallback();
    const inferWithWasm = await createWasmInference();
    return { result: await inferWithWasm(), usedFallback: true };
  }
}