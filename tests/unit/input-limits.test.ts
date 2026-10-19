import { describe, expect, it } from "vitest";
import { isWithinScanLimit, MAX_SCAN_CHARS } from "@/lib/security/input-limits";

describe("scan input limit", () => {
  it("accepts the configured boundary and rejects larger input", () => {
    expect(isWithinScanLimit("x".repeat(MAX_SCAN_CHARS))).toBe(true);
    expect(isWithinScanLimit("x".repeat(MAX_SCAN_CHARS + 1))).toBe(false);
  });
});