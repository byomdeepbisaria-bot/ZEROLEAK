# ZEROLEAK

ZEROLEAK is a local-first text redaction workbench for reviewing logs and notes before they are shared. It detects selected PII and secrets using deterministic browser rules, with an optional browser-side named-entity model. It is a review aid, not a guarantee that every sensitive value will be found.

## Features

- Editable source and sanitized-output editors with character and line counts.
- Deterministic rules for email addresses, IPv4 addresses, phone numbers, common credential assignments, bearer tokens, GitHub-style tokens, and AWS access-key IDs.
- Optional, lazy-loaded English NER for people, organizations, locations, and miscellaneous entities.
- WebGPU preferred when an adapter is available; WASM fallback; rules-only scanning when NER fails.
- Overlap resolution, custom redaction labels, category toggles, before/after view, copy/download, undo/reset, keyboard navigation, responsive layout, and reduced-motion support.
- No analytics, session replay, remote inference, or environment variables.

## Architecture

The root App Router page is statically generated. Interactive state is client-side. Deterministic matching runs in the browser; optional NER runs in a dedicated Web Worker using Transformers.js and ONNX Runtime Web. The worker returns offsets and categories; the client merges them with rule matches and performs redaction. There are no application API routes or server actions.

The app accepts at most 100,000 UTF-16 code units for scanning. The NER worker caps input at 24,000 characters, chunks it, processes one active scan and at most one replaceable pending scan, and drops stale results. Current patterns are fixed source expressions; user-defined regular expressions are not implemented.

## Detection and limitations

Deterministic rules cover selected email, IPv4, phone, and recognizable credential formats. These patterns are incomplete and do not validate that a value is real or active.

Optional model: [`Xenova/bert-base-NER`](https://huggingface.co/Xenova/bert-base-NER), pinned to revision `8e892123e8b7c2c0c2bd1dcb598b7d244c4e53aa`. It is a BERT token-classification ONNX model with an English cased `BertTokenizer`. Supported labels are `PER`, `ORG`, `LOC`, and `MISC` (BIO-tagged at token level); `O` is ignored. It is not a password or API-key detector. The model was trained on CoNLL-2003 news text and may perform poorly on logs, other domains, and other languages.

NER is off until explicitly enabled. First use downloads model assets from Hugging Face: about 93.7 MB for q4f16 WebGPU weights or 109 MB for q8 WASM weights, plus tokenizer/config assets. WASM runtime files are bundled with the pinned npm runtime. Browser caching may support later offline use, but this is not guaranteed. Inference runs locally; no hosted inference provider is used.

## Privacy

Text, findings, and sanitized output stay in tab/worker memory; the app does not write them to browser storage, cookies, URLs, logs, telemetry, or a backend. Clipboard reads occur only after Paste; writes occur only after Copy output. Downloads use the fixed filename `zeroleak-sanitized.txt`.

Expected network traffic is same-origin static app assets and, only when NER is enabled and first needed, HTTPS GET requests for pinned model/runtime assets from Hugging Face and its CDN redirects. The source is passed to the same-origin worker with `postMessage`; it is not included in model requests. Network tests are evidence for tested runs, not proof of an absolute zero-leak guarantee.

See [the threat model](docs/security/THREAT_MODEL.md), [security verification guide](docs/security/VERIFICATION.md), and [security reporting policy](SECURITY.md).

## Install and run

Requirements: Node.js 20.9+ (Node.js 22 LTS recommended) and npm.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. Use built-in synthetic samples during development.

## Tests and production build

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:security
npm run test:e2e -- --project=chromium --workers=1
npm run test:e2e -- --project=chromium-wasm --workers=1
npm audit --omit=dev
npm run preview:static
```

`npm run build` writes the static site to `out/`. `npm run preview:static` serves that exact output at <http://localhost:4173>. The separate WASM test disables WebGPU and runs synthetic NER text; its first run downloads q8 weights.

## Screenshots

Capture the initial workbench, the built-in synthetic incident-log scan, findings, and the mobile layout. Use only built-in samples or clearly fabricated input. Inspect screenshots for visible source/output text, personal data, account identifiers, and browser UI before publishing.

## Model attribution and project license

The NER weights are the MIT-licensed [`Xenova/bert-base-NER`](https://huggingface.co/Xenova/bert-base-NER) ONNX conversion of [`dslim/bert-base-NER`](https://huggingface.co/dslim/bert-base-NER), trained on CoNLL-2003. Retain model/upstream attribution when redistributing weights. `@huggingface/transformers` is Apache-2.0 and ONNX Runtime Web is MIT; consult each dependency's license for full terms.

**The project license is undecided and no `LICENSE` file is included. Choose before public release:**

- MIT: short, permissive, requires retaining copyright/license notices.
- Apache-2.0: permissive with an express patent grant and NOTICE/attribution requirements.
- GPL-3.0: copyleft; distribution of modified versions carries source-sharing obligations.
- No license: default copyright applies; others generally have no permission to reuse or distribute the code.

## Static deployment on Vercel

Next 16 static export is verified and emits `out/`. The app has no request-time data, API routes, server actions, Proxy, or server image optimization. The browser worker and model fetch remain client-side. Vercel applies the response headers in `vercel.json`; static export cannot use Next runtime `headers()` or Proxy. Do not add server features without revisiting this deployment choice.

Before publishing, personally choose the project license and replace the reporting placeholder in `SECURITY.md`. Then create a GitHub account/repository and Vercel account. Create an empty public repository named `zeroleak` (do not auto-generate a README, license, or gitignore). Grant Vercel access only to this repository.

After reviewing the files, run these commands locally when you decide to publish:

```bash
git init -b main
git diff --check
git add .
git status --short
git diff --cached --check
git diff --cached
git commit -m "Prepare ZEROLEAK portfolio release"
git remote add origin https://github.com/<YOUR_GITHUB_ACCOUNT>/zeroleak.git
git push -u origin main
```

In Vercel, choose **Add New → Project**, import `YOUR_GITHUB_ACCOUNT/zeroleak`, select the **Other** framework preset (or let `vercel.json` override with `"framework": null`), and verify Install Command `npm ci`, Build Command `npm run build`, and Output Directory `out`. No environment variables are required. Click Deploy yourself; after it reports Ready, inspect the assigned `*.vercel.app` URL, response headers, model downloads, and privacy behavior using synthetic text. Account setup, repository creation, GitHub authorization, license/contact choices, push, deployment approval, and domain/DNS actions are yours. No repo, remote, commit, push, or deployment has been created here; do not describe the site as live until deployment succeeds.

CI is defined in [.github/workflows/ci.yml](.github/workflows/ci.yml). GitHub Action references are pinned to verified v4 commits; update those pins only after reviewing upstream releases.
