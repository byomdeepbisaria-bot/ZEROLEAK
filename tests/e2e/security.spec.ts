import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

type ClipboardSpyWindow = Window & { __clipboardWrites: string[]; __clipboardReads: number };

test("synthetic source stays out of requests, URLs, storage, and logs", async ({ page }) => {
  const sentinel = "ZEROLEAK_PRIVACY_AUDIT_SENTINEL_74291";
  const requests: { url: string; method: string; body: string | null }[] = [];
  const consoleOutput: string[] = [];

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          (window as unknown as ClipboardSpyWindow).__clipboardReads += 1;
          return "EXPLICIT_CLIPBOARD_SAMPLE";
        },
        writeText: async (text: string) => {
          (window as unknown as ClipboardSpyWindow).__clipboardWrites.push(text);
        },
      },
    });
    (window as unknown as ClipboardSpyWindow).__clipboardWrites = [];
    (window as unknown as ClipboardSpyWindow).__clipboardReads = 0;
  });

  page.on("request", (request) => {
    requests.push({ url: request.url(), method: request.method(), body: request.postData() });
  });
  page.on("console", (message) => consoleOutput.push(message.text()));
  await page.goto("/", { waitUntil: "networkidle" });
  const rawText = `password=${sentinel} contact privacy.audit@example.invalid api_key=DEMO_AUDIT_SECRET`;
  await page.getByRole("textbox", { name: "Source text" }).fill(rawText);
  await page.getByRole("button", { name: "Scan & redact" }).click();
  await expect(page.locator(".notice")).toContainText("Rules-only scan complete");

  const browserState = await page.evaluate(async () => ({
    url: location.href,
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
    cookies: document.cookie,
    databases: (await indexedDB.databases()).map((database) => database.name),
    clipboardWrites: (window as unknown as ClipboardSpyWindow).__clipboardWrites.length,
    clipboardReads: (window as unknown as ClipboardSpyWindow).__clipboardReads,
  }));
  const observed = JSON.stringify({ requests, consoleOutput, browserState });
  expect(observed).not.toContain(sentinel);
  expect(requests.every(({ url }) => new URL(url).origin === "http://127.0.0.1:4173")).toBe(true);
  expect(browserState.localStorage).toEqual([]);
  expect(browserState.sessionStorage).toEqual([]);
  expect(browserState.cookies).toBe("");
  expect(browserState.databases).toEqual([]);
  expect(browserState.clipboardReads).toBe(0);
  expect(browserState.clipboardWrites).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("zeroleak-sanitized.txt");
  expect(download.suggestedFilename()).not.toContain(sentinel);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const downloadedText = await readFile(downloadPath!, "utf8");
  expect(downloadedText).toContain("[REDACTED]");
  expect(downloadedText).not.toContain(sentinel);
  expect(downloadedText).not.toContain("privacy.audit@example.invalid");
  expect(downloadedText).not.toContain("DEMO_AUDIT_SECRET");
  await page.getByRole("button", { name: "Copy output" }).click();
  const copiedText = await page.evaluate(() => (window as unknown as ClipboardSpyWindow).__clipboardWrites[0]);
  expect(copiedText).toContain("[REDACTED]");
  expect(copiedText).not.toContain(sentinel);
  expect(copiedText).not.toContain("privacy.audit@example.invalid");
  expect(copiedText).not.toContain("DEMO_AUDIT_SECRET");
  await page.getByRole("button", { name: "Paste" }).click();
  await expect(page.getByRole("textbox", { name: "Source text" })).toHaveValue("EXPLICIT_CLIPBOARD_SAMPLE");
  expect(await page.evaluate(() => (window as unknown as ClipboardSpyWindow).__clipboardReads)).toBe(1);
});

test("hostile markup remains text in the editor and output", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const payload = '<img src="x" onerror="document.body.dataset.injected = \'true\'">';
  await page.getByRole("textbox", { name: "Source text" }).fill(payload);
  await page.getByRole("button", { name: "Scan & redact" }).click();
  await expect(page.locator(".notice")).toContainText("Rules-only scan complete");
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-injected")).toBeNull();
  await expect(page.getByRole("textbox", { name: "Sanitized output" })).toHaveValue(payload);
});

test("oversized input is rejected before deterministic scanning", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Source text" }).fill("x".repeat(100_001));
  await page.getByRole("button", { name: "Scan & redact" }).click();

  await expect(page.locator(".notice")).toContainText("100,000-character scan limit");
  await expect(page.getByRole("textbox", { name: "Sanitized output" })).toHaveValue("");
});

test("model-load errors do not echo source text", async ({ page }) => {
  const sentinel = "ERROR_MESSAGE_SOURCE_SENTINEL_31904";
  const consoleOutput: string[] = [];
  await page.route("https://**/*", (route) => route.abort());
  page.on("console", (message) => consoleOutput.push(message.text()));
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Source text" }).fill(`${sentinel} demo@example.com`);
  await page.getByLabel("Use optional local NER model").check();
  await page.getByRole("button", { name: "Scan & redact" }).click();

  await expect(page.locator(".notice")).toContainText("Rules-only scan complete. Local NER is unavailable");
  await expect(page.locator(".notice")).not.toContainText(sentinel);
  await expect(page.locator(".model-message")).not.toContainText(sentinel);
  expect(consoleOutput.join("\n")).not.toContain(sentinel);
});