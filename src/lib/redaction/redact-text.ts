import type { DetectionMatch } from "@/lib/detection/types";
import { resolveMatches } from "@/lib/redaction/resolve-matches";

export function redactText(text: string, matches: DetectionMatch[], label: string): string {
  const replacement = label.trim() || "[REDACTED]";
  const resolved = resolveMatches(text, matches);
  let cursor = 0;
  let output = "";

  for (const match of resolved) {
    output += text.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }

  return output + text.slice(cursor);
}