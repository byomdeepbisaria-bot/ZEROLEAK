import { expect, test } from "@playwright/test";

test("local NER runs on WASM when WebGPU is unavailable", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
    return Boolean(gpu && await gpu.requestAdapter());
  })).toBe(false);

  await page.getByRole("textbox", { name: "Source text" }).fill("Sarah moved to London for work.");
  await page.getByLabel("Use optional local NER model").check();
  await page.getByRole("button", { name: "Scan & redact" }).click();

  await expect(page.getByText("READY / WASM", { exact: true })).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".notice")).toContainText("Scan complete");
  await expect(page.getByRole("textbox", { name: "Sanitized output" })).not.toHaveValue(/Sarah|London/);
  await expect(page.getByLabel("Detection category counts")).toContainText("Named entities2");
});