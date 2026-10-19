import { env, LogLevel, pipeline } from "@huggingface/transformers";
import type { DetectionMatch } from "@/lib/detection/types";
import { chunkText, mapNerEntities, NER_MAX_CHARS, NER_MODEL_ID, NER_MODEL_REVISION } from "@/lib/nlp/ner";
import type { NerEntity } from "@/lib/nlp/ner";
import type { NerBackend } from "@/lib/nlp/runtime";
import { inferWithWasmFallback, loadNerWithFallback } from "@/lib/nlp/runtime";
import type { NerWorkerRequest, NerWorkerResponse } from "@/lib/nlp/protocol";

type Classifier = (text: string, options: { aggregation_strategy: "simple" }) => Promise<NerEntity[]>;
type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<NerWorkerRequest>) => void): void;
  postMessage(message: NerWorkerResponse): void;
};
type LoadedModel = { classifier: Classifier; backend: NerBackend };

const scope = globalThis as unknown as WorkerScope;
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.useWasmCache = true;
env.logLevel = LogLevel.NONE;

let loadedModel: LoadedModel | null = null;
let loadingModel: Promise<LoadedModel> | null = null;
let latestRequestId = 0;
let queuedScan: { id: number; text: string } | null = null;
let workerBusy = false;

function post(message: NerWorkerResponse) {
  scope.postMessage(message);
}

function postStatus(
  id: number,
  state: "loading" | "fallback" | "ready",
  message: string,
  progress?: number,
  backend?: NerBackend,
) {
  if (id !== latestRequestId) return;
  post({ type: "status", id, state, message, progress, backend });
}

async function hasWebGpuAdapter() {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function createClassifier(backend: NerBackend, id: number): Promise<Classifier> {
  const model = await pipeline("token-classification", NER_MODEL_ID, {
    revision: NER_MODEL_REVISION,
    device: backend,
    dtype: backend === "webgpu" ? "q4f16" : "q8",
    progress_callback: (progress) => {
      if (progress.status === "progress_total") {
        postStatus(
          id,
          "loading",
          `Downloading model assets: ${Math.round(progress.progress)}%`,
          progress.progress,
          backend,
        );
      }
    },
  });
  return model as unknown as Classifier;
}

async function getLoadedModel(id: number): Promise<LoadedModel> {
  if (loadedModel) return loadedModel;
  if (!loadingModel) {
    loadingModel = (async () => {
      postStatus(id, "loading", "Checking WebGPU and preparing local NER model…");
      const preferWebGpu = await hasWebGpuAdapter();
      const result = await loadNerWithFallback(
        preferWebGpu,
        (backend) => createClassifier(backend, id),
        (reason) => {
          const message =
            reason === "unavailable"
              ? "WebGPU is unavailable; using the browser WASM backend."
              : "WebGPU initialization failed; falling back to browser WASM.";
          postStatus(id, "fallback", message, undefined, "wasm");
        },
      );
      return { classifier: result.pipeline, backend: result.backend };
    })();
  }

  try {
    loadedModel = await loadingModel;
    return loadedModel;
  } catch {
    loadingModel = null;
    throw new Error("model-load-failed");
  }
}

async function createWasmClassifier(id: number) {
  const classifier = await createClassifier("wasm", id);
  loadedModel = { classifier, backend: "wasm" };
  return classifier;
}

async function runScan(id: number, text: string) {
  if (text.length > NER_MAX_CHARS) {
    post({ type: "error", id, stage: "inference" });
    return;
  }

  try {
    const model = await getLoadedModel(id);
    if (id !== latestRequestId) {
      post({ type: "cancelled", id });
      return;
    }
    postStatus(id, "ready", `Local NER ready on ${model.backend === "webgpu" ? "WebGPU" : "WASM"}.`, undefined, model.backend);

    const chunks = chunkText(text);
    const matches: DetectionMatch[] = [];
    for (const chunk of chunks) {
      const result = await inferWithWasmFallback(
        loadedModel?.backend ?? model.backend,
        () => model.classifier(chunk.text, { aggregation_strategy: "simple" }),
        async () => {
          postStatus(id, "fallback", "GPU inference failed; retrying locally with WASM.", undefined, "wasm");
          const classifier = await createWasmClassifier(id);
          model.classifier = classifier;
          model.backend = "wasm";
          return () => classifier(chunk.text, { aggregation_strategy: "simple" });
        },
        () => postStatus(id, "fallback", "GPU inference failed; retrying locally with WASM.", undefined, "wasm"),
      );
      if (id !== latestRequestId) {
        post({ type: "cancelled", id });
        return;
      }
      matches.push(...mapNerEntities(chunk.text, result.result, chunk.offset));
    }

    const backend = loadedModel?.backend ?? model.backend;
    postStatus(id, "ready", `Local NER ready on ${backend === "webgpu" ? "WebGPU" : "WASM"}.`, undefined, backend);
    post({ type: "result", id, matches, backend });
  } catch {
    post({ type: "error", id, stage: loadedModel ? "inference" : "load" });
  }
}

async function processQueuedScans() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    while (queuedScan) {
      const request = queuedScan;
      queuedScan = null;
      await runScan(request.id, request.text);
    }
  } finally {
    workerBusy = false;
    if (queuedScan) void processQueuedScans();
  }
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    if (latestRequestId === request.id) latestRequestId = 0;
    if (queuedScan?.id === request.id) queuedScan = null;
    return;
  }

  latestRequestId = request.id;
  queuedScan = { id: request.id, text: request.text };
  void processQueuedScans();
});