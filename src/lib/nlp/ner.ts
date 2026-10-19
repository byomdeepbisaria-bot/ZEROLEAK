import type { DetectionMatch, MatchCategory } from "@/lib/detection/types";

export const NER_MODEL_ID = "Xenova/bert-base-NER";
export const NER_MODEL_REVISION = "8e892123e8b7c2c0c2bd1dcb598b7d244c4e53aa";
export const NER_MAX_CHARS = 24_000;

const ENTITY_CATEGORIES: Record<string, MatchCategory> = {
  PER: "person",
  ORG: "organization",
  LOC: "location",
  MISC: "miscellaneous",
};

export type NerEntity = {
  entity_group?: string;
  entity?: string;
  score: number;
  word: string;
  start?: number;
  end?: number;
};

export type NerChunk = { text: string; offset: number };

function findWordSpan(text: string, word: string, from: number) {
  const normalized = word.replace(/^##/, "").trim();
  if (!normalized) return null;
  let start = text.indexOf(normalized, from);
  if (start < 0) start = text.toLocaleLowerCase().indexOf(normalized.toLocaleLowerCase(), from);
  return start < 0 ? null : { start, end: start + normalized.length };
}

export function mapNerEntities(text: string, entities: NerEntity[], offset = 0): DetectionMatch[] {
  let searchFrom = 0;
  const matches: DetectionMatch[] = [];

  for (const entity of entities) {
    const entityLabel = entity.entity_group ?? entity.entity ?? "";
    const prefixlessLabel = entityLabel.replace(/^[BI]-/, "");
    const category = ENTITY_CATEGORIES[prefixlessLabel];
    if (!category || entity.score < 0.55) continue;

    const hasOffsets =
      Number.isInteger(entity.start) &&
      Number.isInteger(entity.end) &&
      (entity.start ?? -1) >= 0 &&
      (entity.end ?? -1) > (entity.start ?? -1) &&
      (entity.end ?? Number.POSITIVE_INFINITY) <= text.length;
    const localSpan = hasOffsets
      ? { start: entity.start as number, end: entity.end as number }
      : findWordSpan(text, entity.word, searchFrom);
    if (!localSpan) continue;

    matches.push({
      start: offset + localSpan.start,
      end: offset + localSpan.end,
      category,
      source: "nlp",
      entityLabel: prefixlessLabel,
      score: entity.score,
    });
    searchFrom = localSpan.end;
  }

  return matches;
}

export function chunkText(text: string, maxChars = 800, overlap = 96): NerChunk[] {
  if (text.length <= maxChars) return text ? [{ text, offset: 0 }] : [];

  const chunks: NerChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lineBreak = text.lastIndexOf("\n", end);
      const wordBoundary = text.lastIndexOf(" ", end);
      const boundary = lineBreak > start + maxChars / 2 ? lineBreak + 1 : wordBoundary;
      if (boundary > start + maxChars / 2) end = boundary;
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    if (end === text.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}