import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type VercelConfig = {
  outputDirectory: string;
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe("static release configuration", () => {
  it("exports to out and defines browser security headers for all paths", async () => {
    const configUrl = new URL("../../vercel.json", import.meta.url);
    const config = JSON.parse(await readFile(configUrl, "utf8")) as VercelConfig;
    const rules = config.headers.find((rule) => rule.source === "/(.*)");
    const headers = new Map(rules?.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    const contentSecurityPolicy = headers.get("content-security-policy") ?? "";
    const connectSource = /(?:^|;)\s*connect-src ([^;]+)/.exec(contentSecurityPolicy)?.[1];

    expect(config.outputDirectory).toBe("out");
    expect(rules).toBeDefined();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(contentSecurityPolicy).toContain("worker-src 'self' blob:");
    expect(contentSecurityPolicy).toContain("wasm-unsafe-eval");
    expect(connectSource?.split(/\s+/)).toEqual([
      "'self'",
      "https://huggingface.co",
      "https://*.huggingface.co",
      "https://*.hf.co",
    ]);
  });
});