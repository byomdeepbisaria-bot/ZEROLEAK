"use client";

import { useEffect, useRef, useState } from "react";
import type { DetectionMatch, MatchCategory } from "@/lib/detection/types";
import { scanDeterministic } from "@/lib/detection/rules";
import { redactText } from "@/lib/redaction/redact-text";
import { resolveMatches } from "@/lib/redaction/resolve-matches";
import { isWithinScanLimit, MAX_SCAN_CHARS } from "@/lib/security/input-limits";
import type { NerWorkerRequest, NerWorkerResponse } from "@/lib/nlp/protocol";
import { SYNTHETIC_SAMPLES } from "@/lib/samples";

type ViewMode = "compare" | "before" | "after";
type NoticeKind = "working" | "success" | "error" | "unsupported" | "fallback";
type Notice = { kind: NoticeKind; message: string };
type CategoryId = "secrets" | "emails" | "network" | "phones" | "entities";
type ModelState = "not-loaded" | "loading" | "ready" | "fallback" | "error";

const MATCH_CATEGORY_IDS: Record<MatchCategory, CategoryId> = {
  secret: "secrets",
  email: "emails",
  ip: "network",
  phone: "phones",
  person: "entities",
  organization: "entities",
  location: "entities",
  miscellaneous: "entities",
};

const CATEGORIES: { id: CategoryId; name: string; scope: string }[] = [
  { id: "secrets", name: "Secrets & credentials", scope: "keys / tokens / passwords" },
  { id: "emails", name: "Email addresses", scope: "pattern rules" },
  { id: "network", name: "IP addresses", scope: "pattern rules" },
  { id: "phones", name: "Phone numbers", scope: "pattern rules" },
  { id: "entities", name: "Named entities", scope: "person / org / location / misc" },
];

export default function ZeroLeakWorkspace() {
  const [sourceText, setSourceText] = useState("");
  const [sanitizedText, setSanitizedText] = useState("");
  const [findings, setFindings] = useState<DetectionMatch[] | null>(null);
  const [previousSource, setPreviousSource] = useState<string | null>(null);
  const [selectedSample, setSelectedSample] = useState<string>(SYNTHETIC_SAMPLES[0].id);
  const [viewMode, setViewMode] = useState<ViewMode>("compare");
  const [redactionLabel, setRedactionLabel] = useState("[REDACTED]");
  const [animationsEnabled, setAnimationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [nlpEnabled, setNlpEnabled] = useState(false);
  const [modelState, setModelState] = useState<ModelState>("not-loaded");
  const [modelMessage, setModelMessage] = useState("Not loaded; assets download on the first NLP scan.");
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [modelBackend, setModelBackend] = useState<"webgpu" | "wasm" | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingScansRef = useRef(new Map<number, { resolve: (matches: DetectionMatch[]) => void; reject: () => void }>());
  const scanSequenceRef = useRef(0);
  const activeScanRef = useRef(0);
  const [categories, setCategories] = useState<Record<CategoryId, boolean>>({
    secrets: true,
    emails: true,
    network: true,
    phones: true,
    entities: true,
  });
  const [notice, setNotice] = useState<Notice>({
    kind: "success",
    message: "Ready. Deterministic scanning is local; optional NER is off.",
  });

  const lineCount = sourceText.length === 0 ? 0 : sourceText.split(/\r\n|\r|\n/).length;
  const appClassName = `app-shell ${animationsEnabled ? "motion-on" : "motion-off"}`;
  const findingCounts = findings?.reduce<Record<CategoryId, number>>(
    (counts, match) => {
      const categoryId = MATCH_CATEGORY_IDS[match.category];
      counts[categoryId] += 1;
      return counts;
    },
    { secrets: 0, emails: 0, network: 0, phones: 0, entities: 0 },
  );

  useEffect(() => () => workerRef.current?.terminate(), []);

  function handleWorkerMessage(message: NerWorkerResponse) {
    if (message.type === "status") {
      if (message.id !== activeScanRef.current) return;
      setModelState(message.state);
      setModelMessage(message.message);
      setModelProgress(message.progress ?? null);
      if (message.backend) setModelBackend(message.backend);
      return;
    }

    const pending = pendingScansRef.current.get(message.id);
    if (!pending) return;
    pendingScansRef.current.delete(message.id);
    if (message.id !== activeScanRef.current) {
      pending.resolve([]);
      return;
    }

    if (message.type === "result") {
      setModelState("ready");
      setModelBackend(message.backend);
      pending.resolve(message.matches);
    } else if (message.type === "error") {
      setModelState("error");
      setModelProgress(null);
      setModelMessage(
        message.stage === "load"
          ? "Local NER could not load. Rules-only scanning is available."
          : "Local NER failed during inference. Rules-only scanning is available.",
      );
      pending.reject();
    } else {
      pending.resolve([]);
    }
  }

  function requestNlpScan(text: string, id: number): Promise<DetectionMatch[]> {
    try {
      if (!workerRef.current) {
        const worker = new Worker(new URL("../lib/nlp/ner.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<NerWorkerResponse>) => handleWorkerMessage(event.data);
        worker.onerror = () => {
          const failedId = activeScanRef.current;
          if (!failedId) return;
          setModelState("error");
          setModelProgress(null);
          setModelMessage("Local NER worker is unavailable. Rules-only scanning is available.");
          const pending = pendingScansRef.current.get(failedId);
          if (pending) {
            pendingScansRef.current.delete(failedId);
            pending.reject();
          }
        };
        workerRef.current = worker;
      }

      return new Promise((resolve, reject) => {
        pendingScansRef.current.set(id, { resolve, reject });
        const request: NerWorkerRequest = { type: "scan", id, text };
        workerRef.current?.postMessage(request);
      });
    } catch {
      setModelState("error");
      setModelProgress(null);
      setModelMessage("This browser could not start the local NER worker. Rules-only scanning is available.");
      return Promise.reject();
    }
  }

  function invalidateActiveScan() {
    const activeId = activeScanRef.current;
    const pending = pendingScansRef.current.get(activeId);
    if (pending) {
      pendingScansRef.current.delete(activeId);
      pending.resolve([]);
    }
    if (activeId && workerRef.current) {
      const request: NerWorkerRequest = { type: "cancel", id: activeId };
      workerRef.current.postMessage(request);
    }
    activeScanRef.current = 0;
    setIsScanning(false);
  }

  function updateSource(nextText: string) {
    invalidateActiveScan();
    setPreviousSource(sourceText);
    setSourceText(nextText);
    setSanitizedText("");
    setFindings(null);
    setNotice({ kind: "working", message: "Text changed. Run a new scan to refresh findings." });
  }

  function clearSource() {
    if (!sourceText) return;
    updateSource("");
    setNotice({ kind: "success", message: "Source text cleared. Undo is available." });
  }

  function resetWorkspace() {
    invalidateActiveScan();
    if (sourceText) setPreviousSource(sourceText);
    setSourceText("");
    setSanitizedText("");
    setFindings(null);
    setViewMode("compare");
    setNotice({ kind: "success", message: "Workspace reset. Settings were left unchanged." });
  }

  function undoSource() {
    if (previousSource === null) return;
    invalidateActiveScan();
    setSourceText(previousSource);
    setPreviousSource(null);
    setSanitizedText("");
    setFindings(null);
    setNotice({ kind: "success", message: "Previous source text restored." });
  }

  function loadSample() {
    const sample = SYNTHETIC_SAMPLES.find((item) => item.id === selectedSample);
    if (!sample) {
      setNotice({ kind: "error", message: "That synthetic example is unavailable." });
      return;
    }
    updateSource(sample.text);
    setNotice({ kind: "success", message: `${sample.label} loaded. This is synthetic data only.` });
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.readText) {
      setNotice({
        kind: "unsupported",
        message: "Clipboard access is unavailable. Paste directly into the source editor instead.",
      });
      return;
    }

    setNotice({ kind: "working", message: "Reading clipboard…" });
    try {
      const clipboardText = await navigator.clipboard.readText();
      updateSource(clipboardText);
      setNotice({ kind: "success", message: "Clipboard text pasted into this browser tab." });
    } catch {
      setNotice({
        kind: "error",
        message: "Clipboard access was denied. Paste directly into the source editor instead.",
      });
    }
  }

  function requestScan() {
    if (!sourceText || isScanning) return;
    if (!isWithinScanLimit(sourceText)) {
      setNotice({
        kind: "error",
        message: `Input exceeds the ${MAX_SCAN_CHARS.toLocaleString()}-character scan limit. Trim the text before scanning.`,
      });
      return;
    }
    const id = ++scanSequenceRef.current;
    activeScanRef.current = id;
    setIsScanning(true);
    setFindings(null);
    setNotice({ kind: "working", message: "Running deterministic rules in this tab…" });

    void (async () => {
      const enabledCategories: Record<MatchCategory, boolean> = {
        secret: categories.secrets,
        email: categories.emails,
        ip: categories.network,
        phone: categories.phones,
        person: categories.entities,
        organization: categories.entities,
        location: categories.entities,
        miscellaneous: categories.entities,
      };
      const ruleMatches = scanDeterministic(sourceText).filter((match) => enabledCategories[match.category]);
      let nerMatches: DetectionMatch[] = [];
      let nlpFailed = false;
      const useNlp = nlpEnabled && categories.entities;

      if (useNlp) {
        try {
          setModelState("loading");
          setModelProgress(null);
          setModelMessage("Starting the local NER worker…");
          nerMatches = await requestNlpScan(sourceText, id);
        } catch {
          nlpFailed = true;
        }
      }

      if (activeScanRef.current !== id) return;
      const allMatches = resolveMatches(sourceText, [...ruleMatches, ...nerMatches]);
      const output = redactText(sourceText, allMatches, redactionLabel);
      setFindings(allMatches);
      setSanitizedText(output);
      setIsScanning(false);

      if (nlpFailed) {
        setNotice({ kind: "fallback", message: "Rules-only scan complete. Local NER is unavailable; review all output before sharing." });
      } else if (useNlp) {
        setNotice({ kind: "success", message: `Scan complete. ${allMatches.length} finding${allMatches.length === 1 ? "" : "s"} redacted locally.` });
      } else {
        setNotice({ kind: "success", message: `Rules-only scan complete. ${allMatches.length} finding${allMatches.length === 1 ? "" : "s"} redacted locally.` });
      }
    })();
  }

  async function copySanitizedText() {
    if (!sanitizedText) return;
    try {
      await navigator.clipboard.writeText(sanitizedText);
      setNotice({ kind: "success", message: "Sanitized output copied to the clipboard." });
    } catch {
      setNotice({ kind: "error", message: "Clipboard write failed. Select and copy the output manually." });
    }
  }

  function downloadSanitizedText() {
    if (!sanitizedText) return;
    const file = new Blob([sanitizedText], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "zeroleak-sanitized.txt";
    link.click();
    URL.revokeObjectURL(objectUrl);
    setNotice({ kind: "success", message: "Sanitized text download started." });
  }

  async function previewSound() {
    if (!soundEnabled) return;
    if (!window.AudioContext) {
      setNotice({ kind: "unsupported", message: "Web Audio is unavailable in this browser." });
      return;
    }

    let context: AudioContext | undefined;
    try {
      context = new window.AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(640, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(920, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.14);
      oscillator.addEventListener(
        "ended",
        () => {
          void context?.close().catch(() => {
            setNotice({ kind: "error", message: "The sound preview could not close cleanly." });
          });
        },
        { once: true },
      );
      setNotice({ kind: "success", message: "Sound preview played. No audio was requested from a server." });
    } catch {
      if (context && context.state !== "closed") await context.close();
      setNotice({ kind: "error", message: "Sound preview is unavailable in this browser session." });
    }
  }

  function toggleCategory(id: CategoryId) {
    invalidateActiveScan();
    setFindings(null);
    setSanitizedText("");
    setCategories((current) => ({ ...current, [id]: !current[id] }));
    setNotice({ kind: "working", message: "Detection settings changed. Run a new scan to apply them." });
  }

  function changeNlpEnabled(enabled: boolean) {
    invalidateActiveScan();
    setFindings(null);
    setSanitizedText("");
    setNlpEnabled(enabled);
    setNotice({ kind: "working", message: "NLP setting changed. Run a new scan to apply it." });
  }

  function changeRedactionLabel(label: string) {
    invalidateActiveScan();
    setFindings(null);
    setSanitizedText("");
    setRedactionLabel(label);
    setNotice({ kind: "working", message: "Redaction label changed. Run the scan again to apply it." });
  }

  const modelStatusLabel =
    modelState === "loading"
      ? "LOADING"
      : modelState === "ready"
        ? `READY / ${(modelBackend ?? "wasm").toUpperCase()}`
        : modelState === "fallback"
          ? "WASM FALLBACK"
          : modelState === "error"
            ? "UNAVAILABLE"
            : nlpEnabled
              ? "READY TO DOWNLOAD"
              : "OPTIONAL / OFF";

  return (
    <div className={appClassName}>
      <a className="skip-link" href="#source-editor">Skip to text editor</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ZEROLEAK home">
          <span className="brand-mark" aria-hidden="true">Z/</span>
          <span className="brand-name">ZERO<span>LEAK</span></span>
        </a>
        <div className="topbar-actions">
          <span className="local-pill"><span className="status-dot" />LOCAL SESSION</span>
          <button
            className="text-link-button"
            type="button"
            onClick={() => document.getElementById("settings-panel")?.scrollIntoView({ behavior: animationsEnabled ? "smooth" : "auto" })}
          >
            SETTINGS
          </button>
        </div>
      </header>

      <main className="page-wrap" id="top">
        <section className="intro-row" aria-labelledby="page-title">
          <div>
            <div className="eyebrow">SECURE TEXT WORKBENCH / 01</div>
            <h1 id="page-title">Keep secrets <span>off the wire.</span></h1>
            <p className="intro-copy">
              Scan and redact in this browser tab. <strong>Pasted text is never sent to a server.</strong> Optional NER model assets download separately on first use.
            </p>
          </div>
          <div className="engine-chip" aria-label="Deterministic rules are active">
            <span className="engine-chip-label">Deterministic rules</span>
            <span className="engine-chip-value">ACTIVE / LOCAL</span>
          </div>
        </section>

        <div className="workspace-layout">
          <section className="workbench" aria-label="Text workbench">
            <div className="workbench-top">
              <span className="workbench-label">Input / output</span>
              <div className="segmented-control" role="group" aria-label="Editor view">
                {([
                  ["compare", "Compare"],
                  ["before", "Before"],
                  ["after", "After"],
                ] as const).map(([mode, label]) => (
                  <button
                    className="segmented-button"
                    type="button"
                    key={mode}
                    aria-pressed={viewMode === mode}
                    onClick={() => setViewMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`editor-grid ${viewMode}`}>
              <section className="editor-pane source-pane" aria-labelledby="source-title">
                <div className="pane-heading">
                  <h2 className="editor-title" id="source-title"><span className="pane-marker">A</span> Source text</h2>
                  <span className="editor-meta" aria-live="polite">{sourceText.length.toLocaleString()} chars / {lineCount} lines</span>
                </div>
                <div className="pane-controls">
                  <select
                    className="sample-select"
                    aria-label="Synthetic sample"
                    value={selectedSample}
                    onChange={(event) => setSelectedSample(event.target.value)}
                  >
                    {SYNTHETIC_SAMPLES.map((sample) => (
                      <option value={sample.id} key={sample.id}>{sample.label} · synthetic</option>
                    ))}
                  </select>
                  <button className="action-button" type="button" onClick={loadSample}>Load example</button>
                  <button className="action-button" type="button" onClick={pasteFromClipboard}>Paste</button>
                  <button className="action-button quiet" type="button" onClick={clearSource} disabled={!sourceText}>Clear</button>
                </div>
                <label className="sr-only" htmlFor="source-editor">Source text</label>
                <textarea
                  className="editor-textarea"
                  id="source-editor"
                  value={sourceText}
                  maxLength={MAX_SCAN_CHARS + 1}
                  onChange={(event) => updateSource(event.target.value)}
                  placeholder={'Paste or type text here…\n\nOnly supported patterns and enabled local NER entities will be scanned.'}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-describedby="source-note"
                />
                <div className="pane-footer" id="source-note">
                  <span>EDITABLE / LOCAL MEMORY ONLY</span>
                  <span>{sourceText.length.toLocaleString()} characters</span>
                </div>
              </section>

              <section className="editor-pane output-pane" aria-labelledby="output-title">
                <div className="pane-heading">
                  <h2 className="editor-title" id="output-title"><span className="pane-marker output">B</span> Sanitized output</h2>
                  <span className="editor-meta">{sanitizedText.length.toLocaleString()} chars</span>
                </div>
                <div className="pane-controls">
                  <button className="action-button" type="button" onClick={copySanitizedText} disabled={!sanitizedText}>Copy output</button>
                  <button className="action-button" type="button" onClick={downloadSanitizedText} disabled={!sanitizedText}>Download .txt</button>
                </div>
                <label className="sr-only" htmlFor="sanitized-editor">Sanitized output</label>
                <textarea
                  className="editor-textarea"
                  id="sanitized-editor"
                  value={sanitizedText}
                  readOnly
                  placeholder="Sanitized output appears here after a scan. Review it before sharing."
                  spellCheck={false}
                />
                <div className="pane-footer">
                  <span>OUTPUT / READ ONLY</span>
                  <span>{sanitizedText ? "READY TO EXPORT" : "NO OUTPUT"}</span>
                </div>
              </section>
            </div>

            <div className="scan-row">
              <button className="scan-button" type="button" onClick={requestScan} disabled={!sourceText || isScanning}>
                {isScanning ? "Scanning locally…" : "Scan & redact"}
              </button>
              <p className="scan-note">Rule scanning always stays local. NLP is optional and runs in a browser worker; the first enabled scan downloads model assets.</p>
            </div>
            <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
              {notice.message}
            </div>
          </section>

          <aside className="sidebar" aria-label="Scan details and settings">
            <section className="panel" aria-labelledby="findings-title">
              <div className="panel-heading">
                <h2 id="findings-title">Findings</h2>
                <p>{findings === null ? "No scan has run in this session." : `${findings.length} total finding${findings.length === 1 ? "" : "s"} from the latest scan.`}</p>
              </div>
              <div className="model-status"><span>NLP MODEL</span><strong>{modelStatusLabel}</strong></div>
              {modelProgress !== null && <progress className="model-progress" max={100} value={modelProgress} aria-label="NLP model download progress" />}
              <p className="model-message" role="status">{modelMessage}</p>
              {findings === null && <p className="findings-empty"><strong>Awaiting scan</strong>Findings are not counted until a scan finishes.</p>}
              <div className="finding-list" aria-label="Detection category counts">
                {CATEGORIES.map((category) => (
                  <div className="finding-row" key={category.id}>
                    <span>{category.name}</span>
                    <span className="category-state">{findingCounts === undefined ? "--" : findingCounts[category.id]}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel settings-panel" id="settings-panel" aria-labelledby="settings-title">
              <div className="settings-heading">
                <h2 id="settings-title">Settings</h2>
                <span className="section-kicker">SESSION ONLY</span>
              </div>
              <p className="settings-subtitle">These controls are local and are not persisted.</p>
              <fieldset className="settings-fieldset">
                <legend>Detection categories</legend>
                {CATEGORIES.map((category) => (
                  <label className="category-row" key={category.id}>
                    <span className="category-copy">{category.name}<small>{category.scope}</small></span>
                    <input
                      type="checkbox"
                      checked={categories[category.id]}
                      onChange={() => toggleCategory(category.id)}
                      aria-label={`Enable ${category.name}`}
                    />
                  </label>
                ))}
              </fieldset>
              <div className="setting-block">
                <label className="setting-switch">
                  <input type="checkbox" checked={nlpEnabled} onChange={(event) => changeNlpEnabled(event.target.checked)} />
                  <span>Use optional local NER model</span>
                </label>
                <p className="setting-hint">English BERT NER / PER, ORG, LOC, MISC · 93.7 MB q4f16 on WebGPU or 109 MB q8 on WASM. Disabled until you opt in.</p>
              </div>
              <div className="setting-block">
                <label className="setting-label" htmlFor="redaction-label">Redaction label</label>
                <input
                  className="setting-input"
                  id="redaction-label"
                  value={redactionLabel}
                  maxLength={32}
                  onChange={(event) => changeRedactionLabel(event.target.value)}
                />
                <p className="setting-hint">Applied to supported deterministic and enabled NER findings: <strong>{redactionLabel || "[REDACTED]"}</strong></p>
              </div>
              <div className="setting-block">
                <label className="setting-switch">
                  <input type="checkbox" checked={animationsEnabled} onChange={(event) => setAnimationsEnabled(event.target.checked)} />
                  <span>Subtle interface motion</span>
                </label>
                <div className="sound-row">
                  <label className="setting-switch">
                    <input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} />
                    <span>Sound effects</span>
                  </label>
                  <button className="action-button" type="button" onClick={previewSound} disabled={!soundEnabled}>Test sound</button>
                </div>
              </div>
              <div className="pane-controls settings-actions">
                <button className="action-button" type="button" onClick={undoSource} disabled={previousSource === null}>Undo</button>
                <button className="action-button quiet" type="button" onClick={resetWorkspace} disabled={!sourceText && !sanitizedText}>Reset workspace</button>
              </div>
            </section>

            <section className="panel privacy-panel" aria-labelledby="privacy-title">
              <div className="privacy-heading">
                <span className="status-dot" aria-hidden="true" />
                <h2 id="privacy-title">Privacy boundary</h2>
              </div>
              <p className="privacy-copy">
                Text stays in tab memory and is processed by local rules and, only when enabled, a browser worker. <strong>Only model/runtime assets are fetched from Hugging Face; source text is not sent.</strong> A fresh install needs network access for first download; cached assets may allow later offline use.
              </p>
              <div className="privacy-meta">NO STORAGE / NO ANALYTICS / NO EXTERNAL INFERENCE</div>
            </section>
          </aside>
        </div>

        <footer className="bottom-bar">
          <span><strong>ZEROLEAK</strong> / LOCAL-FIRST REDACTION</span>
          <span>DETECTION IS PROBABILISTIC · REVIEW OUTPUT BEFORE SHARING</span>
        </footer>
      </main>
    </div>
  );
}