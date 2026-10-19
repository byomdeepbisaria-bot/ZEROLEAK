import type { DetectionMatch } from "@/lib/detection/types";

function priority(match: DetectionMatch) {
  return match.source === "rule" ? 1 : 0;
}

export function resolveMatches(text: string, candidates: DetectionMatch[]): DetectionMatch[] {
  const valid = candidates.filter(
    (match) =>
      Number.isInteger(match.start) &&
      Number.isInteger(match.end) &&
      match.start >= 0 &&
      match.end > match.start &&
      match.end <= text.length,
  );

  const ordered = valid.sort(
    (left, right) =>
      priority(right) - priority(left) ||
      (right.end - right.start) - (left.end - left.start) ||
      left.start - right.start,
  );
  const resolved: DetectionMatch[] = [];

  for (const candidate of ordered) {
    if (resolved.some((match) => candidate.start < match.end && candidate.end > match.start)) continue;
    resolved.push(candidate);
  }

  return resolved.sort((left, right) => left.start - right.start);
}