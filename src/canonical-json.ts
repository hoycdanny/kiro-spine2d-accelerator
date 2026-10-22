// ============================================================
// Canonical JSON primitives.
//
// Three functions and no imports at all. Two unrelated things hash the
// bytes this module produces — the skeleton document's fingerprint and the
// animation generator's recomputed skeleton hash — so the canonicaliser
// lives on its own rather than inside either of them, and neither has to
// import the other to get it.
// ============================================================

/**
 * Ordinal, locale-independent string comparison.
 *
 * Never `localeCompare`: that depends on the host's ICU data and the
 * process default locale, so `'Head'` vs `'head'`, `'a_b'` vs `'ab'` and
 * any non-ASCII bone name can order differently between two Node builds.
 * Key order decides the bytes that get hashed, so a locale-sensitive
 * comparator would let the same data fingerprint differently per machine.
 */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Round to a fixed number of decimal places.
 *
 * `Number(value.toFixed(places))` normalises `-0` to `0` and drops
 * trailing zeros, which is what makes two runs over the same input
 * produce byte-identical output.
 */
export function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}

/** Decimal places every number in canonical output is formatted to. */
const CANONICAL_PLACES = 6;

/**
 * Serialize a value so the same data always produces the same bytes.
 *
 * Object keys are sorted recursively with {@link byCodeUnit}; array order
 * is preserved, because in skeleton data an array's order is the data.
 * Every finite number is formatted to six decimal places, and non-finite
 * numbers become `null` — which is what `JSON.stringify` does with them
 * anyway, made explicit here so the rule is stated once.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? round(value, CANONICAL_PLACES) : null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(byCodeUnit)) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }

  return value;
}
