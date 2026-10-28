const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A new document id: 16 random base-36 characters (about 82 bits), the
 * same kind of client-generated random string the artifact used. The app
 * makes them for its ops, and the MCP write tools (#154) for theirs.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let id = '';
  for (const b of bytes) {
    id += ALPHABET[b % ALPHABET.length];
  }
  return id;
}
