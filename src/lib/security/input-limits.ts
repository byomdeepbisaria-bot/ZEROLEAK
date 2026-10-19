export const MAX_SCAN_CHARS = 100_000;

export function isWithinScanLimit(text: string): boolean {
  return text.length <= MAX_SCAN_CHARS;
}