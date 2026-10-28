const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
/** The largest multiple of 36 a byte can hold: bytes from here up are skipped. */
const UNBIASED = 256 - (256 % ALPHABET.length);

/**
 * A new document id: 16 random base-36 characters (about 82 bits), the
 * same kind of client-generated random string the artifact used. The app
 * makes them for its ops, and the MCP write tools (#154) for theirs. A
 * byte past the last whole multiple of 36 is drawn again, so every
 * character is equally likely.
 */
export function newId(): string {
  let id = '';
  while (id.length < 16) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < UNBIASED && id.length < 16) id += ALPHABET[b % ALPHABET.length];
    }
  }
  return id;
}
