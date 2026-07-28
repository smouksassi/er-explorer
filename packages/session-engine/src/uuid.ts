/**
 * Generate an RFC 4122 version 4 (random) UUID.
 *
 * Used to give every {@link SessionFile}, and every {@link HistoryEntry}
 * appended to one, a stable, globally-unique identifier - so a session
 * saved on one machine and shared with a collaborator never collides with
 * one saved elsewhere, and so history entries can be referenced (e.g. for
 * undo) unambiguously.
 *
 * Dependency-free and portable: prefers the standard Web Crypto API
 * (`crypto.getRandomValues`, available in both modern browsers and Node)
 * when present, and falls back to `Math.random` otherwise so this still
 * works in any JS environment. UUIDs are identifiers, not scientific
 * results, so this fallback's weaker randomness has no bearing on
 * reproducibility.
 */
export function createUuidV4(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version (4) and variant (RFC 4122) bits per the UUID v4 spec.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Whether a string is syntactically a UUID (any RFC 4122 version), for validating ids read from a session file. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
