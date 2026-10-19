# Security Verification Guide

Use synthetic strings only. Never use real credentials or personal information in tests or when checking browser network traffic.

## Automated checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:security
npm run test:e2e -- --project=chromium-wasm --workers=1
npm run build
npm audit --omit=dev
```

The security E2E suite asserts that its unique synthetic sentinel does not appear in request URLs/bodies, console messages, local/session storage, or IndexedDB names; that no clipboard write occurs before explicit Copy; and that downloads use a fixed filename. It also checks hostile markup is rendered as text and over-limit input is rejected. The WASM project disables WebGPU and performs a real local model scan.

## Manual browser check

1. Start with `npm run dev` and open `http://localhost:3000` in a clean browser profile. Use a synthetic sentinel such as `AUDIT_SENTINEL_74291`, not real sensitive data.
2. Open DevTools Network, enable Preserve log, and clear the current log. Type the sentinel in Source text and run a rules-only scan. Confirm the page sends no request containing the sentinel, and the URL remains unchanged. Expected application traffic is same-origin document, JavaScript, CSS, and development HMR traffic.
3. Check Application/Storage: localStorage, sessionStorage, cookies, and IndexedDB should contain no source text or app-created input record. The model cache may contain model/runtime files if inference has previously been enabled.
4. Enable “Use optional local NER model” and scan synthetic text such as `Sarah moved to London.` On first use, allow HTTPS GET downloads from Hugging Face and any model CDN redirect. Confirm these are model/config/tokenizer/runtime assets only; source text should not appear in request URLs or bodies. Confirm the local model status shows WebGPU or WASM and findings appear.
5. Select the source editor, enter a synthetic email and secret, and run scan. Confirm redacted output. Verify clipboard is unchanged until you explicitly press Copy output; verify download name is exactly `zeroleak-sanitized.txt`.
6. Enter `<img src=x onerror=alert(1)>` and confirm it displays as text. Enter more than 100,000 characters and confirm the scan is rejected with a size-limit message.
7. For fallback coverage, run the automated `chromium-wasm` project, which disables WebGPU. For model-failure behavior, the regular E2E suite blocks external requests and confirms rules-only redaction remains available.

Network inspection is useful evidence about the specific browser/build/cache state tested. It is not a mathematical proof of no leakage, and it cannot defend against a compromised origin, browser, extension, device, or dependency.