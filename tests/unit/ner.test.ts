import { describe, expect, it } from "vitest";
import { mapNerEntities } from "@/lib/nlp/ner";

describe("mapNerEntities", () => {
  it("maps actual BERT NER labels to supported entity categories", () => {
    const text = "Morgan Example joined Example Corp in London.";
    const matches = mapNerEntities(text, [
      { entity_group: "PER", score: 0.98, word: "Morgan Example", start: 0, end: 14 },
      { entity_group: "ORG", score: 0.94, word: "Example Corp", start: 22, end: 34 },
      { entity_group: "LOC", score: 0.91, word: "London", start: 38, end: 44 },
      { entity_group: "MISC", score: 0.8, word: "Fictional", start: 0, end: 3 },
      { entity_group: "PASSWORD", score: 0.99, word: "hunter2" },
    ]);

    expect(matches.map(({ category, entityLabel }) => [category, entityLabel])).toEqual([
      ["person", "PER"],
      ["organization", "ORG"],
      ["location", "LOC"],
      ["miscellaneous", "MISC"],
    ]);
    expect(matches.some((match) => match.category === "secret")).toBe(false);
  });

  it("maps word spans when model offsets are absent", () => {
    const text = "Riley visited Paris and returned to Paris.";
    const matches = mapNerEntities(text, [
      { entity_group: "PER", score: 0.93, word: "Riley" },
      { entity_group: "LOC", score: 0.92, word: "Paris" },
      { entity_group: "LOC", score: 0.9, word: "Paris" },
    ]);

    expect(matches.map(({ start, end }) => text.slice(start, end))).toEqual(["Riley", "Paris", "Paris"]);
  });
});