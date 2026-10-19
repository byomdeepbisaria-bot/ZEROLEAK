import { describe, expect, it, vi } from "vitest";
import { inferWithWasmFallback, loadNerWithFallback } from "@/lib/nlp/runtime";

describe("NER backend fallback", () => {
  it("falls back to WASM when WebGPU model initialization fails", async () => {
    const onFallback = vi.fn();
    const result = await loadNerWithFallback(
      true,
      async (backend) => {
        if (backend === "webgpu") throw new Error("GPU unavailable");
        return "wasm pipeline";
      },
      onFallback,
    );

    expect(result).toEqual({ pipeline: "wasm pipeline", backend: "wasm" });
    expect(onFallback).toHaveBeenCalledWith("initialization-failed");
  });

  it("reports unavailable WebGPU and keeps model-load failures explicit", async () => {
    const onFallback = vi.fn();
    await expect(
      loadNerWithFallback(
        false,
        async () => {
          throw new Error("model files missing");
        },
        onFallback,
      ),
    ).rejects.toThrow("model files missing");
    expect(onFallback).toHaveBeenCalledWith("unavailable");
  });

  it("retries inference on WASM after a WebGPU inference error", async () => {
    const onFallback = vi.fn();
    const result = await inferWithWasmFallback(
      "webgpu",
      async () => {
        throw new Error("GPU memory unavailable");
      },
      async () => async () => ["local wasm result"],
      onFallback,
    );

    expect(result).toEqual({ result: ["local wasm result"], usedFallback: true });
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("does not hide a WASM failure", async () => {
    await expect(
      inferWithWasmFallback("wasm", async () => {
        throw new Error("WASM allocation failed");
      }, async () => async () => [], vi.fn()),
    ).rejects.toThrow("WASM allocation failed");
  });
});