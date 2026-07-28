/**
 * The checksum algorithm identifier prefixed onto every computed checksum
 * (e.g. `"fnv1a64:9e3779b9..."`). Recorded alongside the digest itself so
 * that a future, stronger algorithm can be introduced without breaking the
 * ability to read old session files: {@link verifyChecksum} can dispatch on
 * this prefix rather than assuming one fixed algorithm forever.
 */
export type ChecksumAlgorithm = "fnv1a64";

export const CHECKSUM_ALGORITHM: ChecksumAlgorithm = "fnv1a64";

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

/**
 * FNV-1a, 64-bit variant, over the UTF-16 code units of `input`.
 *
 * This is a fast, deterministic, non-cryptographic hash - appropriate here
 * because a session checksum exists to *detect accidental drift* (a
 * dataset or session file that changed since it was saved), not to resist
 * a deliberate adversary. Implemented from scratch (rather than depending
 * on Node's `crypto` module or the browser's async `SubtleCrypto`) so this
 * package stays dependency-free and works identically, synchronously, in
 * both Node and the browser.
 */
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

/**
 * Deep-clone `value` into a plain JSON-compatible structure with every
 * object's keys sorted alphabetically (arrays keep their original order).
 *
 * JSON.stringify's key order normally follows insertion order, which is
 * usually stable but is not a guarantee the reproducibility engine should
 * depend on - two equivalent SessionFiles built through different code
 * paths (e.g. one from `createSessionFile`, one reconstructed by hand in a
 * test) could otherwise produce different checksums despite having
 * identical content. Canonicalizing removes that risk.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

/**
 * Compute a stable, algorithm-tagged checksum over `value`'s canonical JSON
 * representation.
 *
 * Used both to detect drift between a saved {@link Session}'s
 * `datasetChecksum` and the current dataset (`docs/REPRODUCIBILITY.md`),
 * and internally by {@link SessionFile} to detect accidental or malicious
 * tampering with a `.erx` file's contents between save and load.
 */
export function computeChecksum(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  return `${CHECKSUM_ALGORITHM}:${fnv1a64(json).toString(16).padStart(16, "0")}`;
}

/** Verify that `checksum` matches the checksum computed over `value`. */
export function checksumMatches(value: unknown, checksum: string): boolean {
  return computeChecksum(value) === checksum;
}
