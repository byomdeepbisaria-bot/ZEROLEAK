import { expect, test } from "@playwright/test";

test("application responds at the home route", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Keep secrets off the wire." })).toBeVisible();
  await expect(page.getByText("ACTIVE / LOCAL")).toBeVisible();
});

test("synthetic samples load without presenting fake scan results", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Load example" }).click();

  await expect(page.getByRole("textbox", { name: "Source text" })).toHaveValue(/EXAMPLE_SYNTHETIC_KEY_NOT_VALID/);
  await page.getByRole("button", { name: "Scan & redact" }).click();
  const output = page.getByRole("textbox", { name: "Sanitized output" });
  await expect(page.locator(".notice")).toContainText("Rules-only scan complete");
  await expect(output).toHaveValue(/\[REDACTED\]/);
  await expect(output).not.toHaveValue(/morgan@example\.com/);
  await expect(page.getByLabel("Detection category counts")).toContainText("Email addresses1");
});

test("workspace controls work and the mobile layout does not overflow", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const source = page.getByRole("textbox", { name: "Source text" });

  await page.getByLabel("Synthetic sample").selectOption("support-note");
  await page.getByRole("button", { name: "Load example" }).click();
  const sampleText = await source.inputValue();
  await expect(source).toContainText("Riley Sample");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(source).toHaveValue("");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(source).toHaveValue(sampleText);

  await page.getByRole("button", { name: "Before" }).click();
  await expect(page.getByRole("button", { name: "Before" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Enable Email addresses").uncheck();
  await expect(page.getByLabel("Enable Email addresses")).not.toBeChecked();
  await page.getByLabel("Redaction label").fill("[MASKED]");
  await expect(page.getByText("[MASKED]", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reset workspace" }).click();
  await expect(source).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("NER download failure preserves rules-only redaction", async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Source text" }).fill("Contact demo@example.com api_key=DEMO_SYNTHETIC_KEY_NOT_VALID");
  await page.getByLabel("Use optional local NER model").check();
  await page.getByRole("button", { name: "Scan & redact" }).click();

  await expect(page.locator(".notice")).toContainText("Rules-only scan complete. Local NER is unavailable");
  const output = page.getByRole("textbox", { name: "Sanitized output" });
  await expect(output).toHaveValue(/\[REDACTED\]/);
  await expect(output).not.toHaveValue(/demo@example\.com/);
  await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
});