import type { DetectionMatch } from "@/lib/detection/types";

const EMAIL_PATTERN = /(?<![\w.+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
const IPV4_PATTERN = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g;
const PHONE_PATTERN = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const SECRET_KEYS = "api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|secret";
const SECRET_ASSIGNMENT_PATTERN = new RegExp(`\\b(?:${SECRET_KEYS})\\b\\s*[:=]\\s*([^\\s"'&,;]+)`, "gi");
const DOUBLE_QUOTED_SECRET_PATTERN = new RegExp(`\\b(?:${SECRET_KEYS})\\b\\s*[:=]\\s*"([^"\\r\\n]+)"`, "gi");
const SINGLE_QUOTED_SECRET_PATTERN = new RegExp(`\\b(?:${SECRET_KEYS})\\b\\s*[:=]\\s*'([^'\\r\\n]+)'`, "gi");
const BEARER_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/-]{8,}=*)/gi;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;

function addMatches(
  text: string,
  pattern: RegExp,
  category: DetectionMatch["category"],
  output: DetectionMatch[],
  captureGroup = 0,
) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[captureGroup];
    if (!value) continue;
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;
    const start = matchIndex + (captureGroup === 0 ? 0 : fullMatch.lastIndexOf(value));
    output.push({ start, end: start + value.length, category, source: "rule" });
  }
}

export function scanDeterministic(text: string): DetectionMatch[] {
  const matches: DetectionMatch[] = [];
  addMatches(text, EMAIL_PATTERN, "email", matches);

  for (const match of text.matchAll(IPV4_PATTERN)) {
    const address = match[0];
    if (address.split(".").some((part) => Number(part) > 255)) continue;
    const start = match.index ?? 0;
    matches.push({ start, end: start + address.length, category: "ip", source: "rule" });
  }

  addMatches(text, PHONE_PATTERN, "phone", matches);
  addMatches(text, SECRET_ASSIGNMENT_PATTERN, "secret", matches, 1);
  addMatches(text, DOUBLE_QUOTED_SECRET_PATTERN, "secret", matches, 1);
  addMatches(text, SINGLE_QUOTED_SECRET_PATTERN, "secret", matches, 1);
  addMatches(text, BEARER_PATTERN, "secret", matches, 1);
  addMatches(text, GITHUB_TOKEN_PATTERN, "secret", matches);
  addMatches(text, AWS_ACCESS_KEY_PATTERN, "secret", matches);
  return matches;
}