/**
 * What travels between the app and the Worker. M1 adds the ops and socket
 * messages (zod schemas) here; M0 has only the config.
 */

/** `GET /api/config`. */
export interface AppConfig {
  /** The signed-in email, verified by Cloudflare Access. */
  email: string;
}
