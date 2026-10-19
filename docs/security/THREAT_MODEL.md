# ZEROLEAK Threat Model

Last reviewed: 2026-10-19. This describes the current browser application, not a guarantee that sensitive text cannot leak.

## Scope and data flow

Pasted text enters a React textarea, remains in component memory, and is scanned by fixed deterministic rules in the tab. When the user opts into NER, the page sends text through `postMessage` to a same-origin Web Worker, which passes chunks to Transformers.js/ONNX Runtime Web. Matches return as offsets and categories; the UI redacts locally. No API route, server action, remote inference provider, analytics SDK, or session-replay tool is present.

Model files are a separate flow. On first opt-in scan, Transformers.js may make HTTPS `GET` requests to the pinned Hugging Face model revision and follow CDN redirects for model config, tokenizer files, ONNX weights, and runtime assets. The worker is configured for remote model files and browser caching, not user-text uploads. Inference is local. The browser tests monitor request URLs/bodies with synthetic input; this is evidence for those test runs only.

## Assets and assumptions

- Source text, its findings, and sanitized output are sensitive while held in tab/worker memory.
- The local model cache contains public model/runtime artifacts, not application source text.
- The user controls whether optional NER is enabled, whether clipboard text is read, and whether output is copied or downloaded.
- The deployment origin, browser, device, installed extensions, npm/Hugging Face supply chains, and operating system are outside the application’s trust boundary.

## Threats and controls

| Threat | Current controls | Residual risk |
| --- | --- | --- |
| Malicious or oversized input | React renders input in textareas, not as HTML. Input above 100,000 UTF-16 code units is rejected before deterministic matching. NER has a 24,000-character cap and bounded chunks. Worker keeps one active scan and at most one replaceable queued scan. | A permitted large input still consumes memory and synchronous rule-matching time. A compromised browser can observe it. |
| False negatives / incorrect redaction | Deterministic rules cover selected formats; optional NER is separately identified and can fall back to rules-only operation. Findings are reviewable before export. | Rules are incomplete. NER is probabilistic, English-only, trained on CoNLL-2003 news text, and not appropriate for detecting secrets. No accuracy or zero-leak guarantee. |
| Browser extensions / device access | No app-level mitigation can prevent privileged extensions, OS tools, screenshots, clipboard managers, or DevTools from observing content. | Fully outside the app’s control. Do not use the app on a device/browser you do not trust. |
| Compromised npm dependencies | `package-lock.json` fixes resolved package versions; production dependency audit reported no vulnerabilities during this review. | Lockfiles do not prove packages are benign. Transitive dependencies, build tools, and future updates remain supply-chain risks. |
| Model-download tampering | Model ID and Hub commit revision are pinned; transport uses HTTPS; no inference endpoint is used. | This app does not independently verify downloaded model files against locally pinned SHA-256 hashes. A compromised Hub/CDN/TLS trust store or changed application code can affect assets or privacy. |
| XSS / markup injection | Source/output use controlled textarea values; model entities are represented as numeric offsets and labels. No `dangerouslySetInnerHTML` is used. Browser test supplies markup-like text and verifies no element executes. | A compromised dependency or deployment origin can change this behavior. Review future rendering changes. |
| Regex denial of service | No user-defined/custom regex feature exists. Built-in patterns are fixed source constants; input is capped before they run. | JavaScript regex execution has no per-match timeout. Future user-supplied patterns must not be passed to native `RegExp` without a safe engine such as RE2/WASM, strict length/complexity limits, and execution isolation. |
| Clipboard disclosure | Clipboard reads occur only after explicit Paste. Clipboard writes occur only after explicit Copy output and only for sanitized output. | Clipboard contents are visible to the browser/OS and other privileged software. Copying is an intentional disclosure action. |
| Compromised hosting origin | The application currently sends no pasted text to an app endpoint. | A malicious or compromised origin can serve JavaScript that exfiltrates text. HTTPS, same-origin delivery, and current source review cannot protect against a compromised deployment. |

## Current findings

- Source search found no app API routes/server actions, analytics/replay SDKs, raw-text console logging, or automatic application storage writes.
- The only current `navigator.clipboard.writeText` call is inside the explicit Copy output handler. Downloads use the fixed name `zeroleak-sanitized.txt`.
- No user-defined regex input exists. Built-in regular expressions are fixed and scan input is capped at 100,000 code units.
- `npm audit --omit=dev` reports zero production advisories. The full audit reports five high-severity advisories in the development-only Next ESLint dependency path (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`), including stack exhaustion in `braces`. The registry offers a forced fix that downgrades `eslint-config-next` to 14.2.35, incompatible with this Next 16 project; no such downgrade was applied. Vitest was upgraded to 4.1.11, clearing its critical/moderate advisories.
- Automated security E2E tests check a synthetic sentinel against observed request URLs/bodies and console messages, storage APIs, clipboard writes, download names, hostile markup, and the input cap.
- A synthetic NER run was observed on WebGPU and another on WASM. Network inspection in the tested WebGPU run observed no external request carrying the source sentinel. This does not prove absence of leakage in every browser, cache state, build, or future version.

## Explicit non-goals

ZEROLEAK does not protect against browser extensions, a compromised/malicious browser or device, a compromised application origin/hosting account, malicious dependencies, screenshots, or operating-system clipboard access. Network inspection provides evidence about observed executions only; it cannot prove an absolute zero-leak guarantee.