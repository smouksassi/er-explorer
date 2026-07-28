import { computeChecksum } from "./checksum";
import { type SessionFile, withoutChecksum } from "./sessionFile";

/**
 * Serialize a {@link SessionFile} to `.erx` text (JSON).
 *
 * Recomputes the checksum over the session's content immediately before
 * writing it out, rather than trusting whatever checksum is already on the
 * object - this guarantees the checksum in the written file always matches
 * the file's actual content, even if the caller mutated a `SessionFile`
 * object in place after it was created (mutation helpers in `operations.ts`
 * already recompute it too, but this makes that guarantee unconditional).
 */
export function serializeSessionFile(session: SessionFile, pretty = true): string {
  const checksum = computeChecksum(withoutChecksum(session));
  const withCurrentChecksum: SessionFile = { ...session, checksum };
  return JSON.stringify(withCurrentChecksum, null, pretty ? 2 : undefined);
}
