import type { DetectionMatch } from "@/lib/detection/types";
import type { NerBackend } from "@/lib/nlp/runtime";

export type NerWorkerRequest =
  | { type: "scan"; id: number; text: string }
  | { type: "cancel"; id: number };

export type NerWorkerResponse =
  | {
      type: "status";
      id: number;
      state: "loading" | "fallback" | "ready";
      message: string;
      progress?: number;
      backend?: NerBackend;
    }
  | { type: "result"; id: number; matches: DetectionMatch[]; backend: NerBackend }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; stage: "load" | "inference" };