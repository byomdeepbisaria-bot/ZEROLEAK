import { expect, test } from "@playwright/test";

type ClipboardTestWindow = Window & { clipboardWrites: string[] };

test("paste, scan, review, and copy uses only sanitized output", async ({ page }) => {
  const input = "Contact workflow@example.test api_key=DEMO_WORKFLOW_SECRET";
  await page.addInitScript((clipboardInput) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardInput,
        writeText: async (text: string) => {
          (window as unknown as ClipboardTestWindow).clipboardWrites.push(text);
        },
      },
    });
    (window as unknown as ClipboardTestWindow).clipboardWrites = [];
  }, input);

  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Paste" }).click();
  await expect(page.getByRole("textbox", { name: "Source text" })).toHaveValue(input);
  await page.getByRole("button", { name: "Scan & redact" }).click();
  await expect(page.locator(".notice")).toContainText("Rules-only scan complete");

  const output = page.getByRole("textbox", { name: "Sanitized output" });
  await expect(output).toHaveValue(/\[REDACTED\]/);
  await expect(output).not.toHaveValue(/workflow@example\.test|DEMO_WORKFLOW_SECRET/);
  const sanitized = await output.inputValue();
  await page.getByRole("button", { name: "Copy output" }).click();
  expect(await page.evaluate(() => (window as unknown as ClipboardTestWindow).clipboardWrites)).toEqual([sanitized]);
});

test("skip link moves keyboard focus to the source editor", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const skipLink = page.getByRole("link", { name: "Skip to text editor" });
  await skipLink.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("textbox", { name: "Source text" })).toBeFocused();
});

test("near-limit synthetic scanning stays responsive", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const largeText = "trace=normal service=worker user=sample@example.test\n".repeat(1_650);
  await page.getByRole("textbox", { name: "Source text" }).fill(largeText);

  const startedAt = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Scan & redact" }).click();
  await expect(page.locator(".notice")).toContainText("Rules-only scan complete");
  const elapsedMs = await page.evaluate((start) => performance.now() - start, startedAt);

  expect(largeText.length).toBeLessThan(100_000);
  expect(elapsedMs).toBeLessThan(5_000);
  await expect(page.getByRole("textbox", { name: "Sanitized output" })).toHaveValue(/\[REDACTED\]/);
});