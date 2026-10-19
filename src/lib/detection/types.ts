export type MatchCategory =
  | "secret"
  | "email"
  | "ip"
  | "phone"
  | "person"
  | "organization"
  | "location"
  | "miscellaneous";

export type MatchSource = "rule" | "nlp";

export type DetectionMatch = {
  start: number;
  end: number;
  category: MatchCategory;
  source: MatchSource;
  entityLabel?: string;
  score?: number;
};