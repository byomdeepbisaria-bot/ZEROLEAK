import { describe, expect, it } from "vitest";
import type { DetectionMatch } from "@/lib/detection/types";
import { scanDeterministic } from "@/lib/detection/rules";
import { redactText } from "@/lib/redaction/redact-text";
import { resolveMatches } from "@/lib/redaction/resolve-matches";

describe("deterministic detection categories", () => {
  it("detects email, IPv4, phone, and secret patterns in realistic synthetic logs", () => {
    const text = [
      "2026-10-19T11:42:31Z user=morgan@example.test source_ip=198.51.100.42",
      "callback=+1 (202) 555-0147 api_key=DEMO_SYNTHETIC_API_KEY",
      "authorization=Bearer DEMO_SYNTHETIC_BEARER_TOKEN",
    ].join("\n");
    const matches = scanDeterministic(text);

    expect(matches.map((match) => match.category).sort()).toEqual([
      "email",
      "ip",
      "phone",
      "secret",
      "secret",
    ]);
    for (const match of matches) {
      expect(text.slice(match.start, match.end)).not.toBe("");
    }
  });

  it("does not flag ordinary code, prose, version numbers, or incomplete addresses", () => {
    const text = [
      'const serviceName = "secret-manager";',
      'const deployment = "v1.2.3.4";',
      "// The secret agent reviewed the document.",
      'const emailHint = "name@example";',
      "const token = createSessionToken();",
    ].join("\n");

    expect(scanDeterministic(text)).toEqual([]);
  });

  it("handles empty and multiline Unicode input without shifting spans", () => {
    expect(scanDeterministic("")).toEqual([]);
    expect(redactText("", [], "[MASKED]")).toBe("");

    const text = "🔒 User: José\nEmail: jose@example.test";
    const [email] = scanDeterministic(text);
    expect(email?.category).toBe("email");
    expect(text.slice(email!.start, email!.end)).toBe("jose@example.test");
    expect(redactText(text, [email!], "[MASKED]")).toBe("🔒 User: José\nEmail: [MASKED]");
  });
});

describe("overlap resolution and redaction", () => {
  it("keeps deterministic findings over overlapping NER spans", () => {
    const text = "Contact alice@example.com for details.";
    const deterministic = scanDeterministic(text);
    const email = deterministic.find((match) => match.category === "email");
    expect(email).toBeDefined();

    const candidates: DetectionMatch[] = [
      ...deterministic,
      {
        start: email!.start - 8,
        end: email!.end + 5,
        category: "organization",
        source: "nlp",
        score: 0.97,
      },
    ];
    const resolved = resolveMatches(text, candidates);

    expect(resolved).toContainEqual(email);
    expect(resolved).toHaveLength(deterministic.length);
    expect(redactText(text, resolved, "[MASKED]")).toBe("Contact [MASKED] for details.");
  });

  it("ignores out-of-range spans and uses the default label when custom label is empty", () => {
    const text = "api_key=DEMO_SECRET_VALUE";
    const matches: DetectionMatch[] = [
      ...scanDeterministic(text),
      { start: -3, end: 2, category: "person", source: "nlp" },
      { start: 4, end: text.length + 10, category: "location", source: "nlp" },
    ];

    expect(redactText(text, matches, "  ")).toBe("api_key=[REDACTED]");
  });

  it("redacts a quoted password value containing spaces without touching its key", () => {
    const text = 'password="synthetic pass phrase"';

    expect(redactText(text, scanDeterministic(text), "[MASKED]")).toBe('password="[MASKED]"');
  });

  it("drops duplicate, empty, and partially overlapping matches deterministically", () => {
    const text = "abcdefghij";
    const matches: DetectionMatch[] = [
      { start: 2, end: 7, category: "person", source: "nlp", score: 0.9 },
      { start: 2, end: 7, category: "organization", source: "nlp", score: 0.8 },
      { start: 6, end: 9, category: "location", source: "nlp", score: 0.95 },
      { start: 1, end: 1, category: "email", source: "rule" },
    ];

    expect(resolveMatches(text, matches)).toEqual([matches[0]]);
  });

  it("handles long adversarial punctuation input within the application scan bound", () => {
    const text = `${"a.".repeat(49_999)}!`;
    expect(scanDeterministic(text)).toEqual([]);
  }, 5_000);
});