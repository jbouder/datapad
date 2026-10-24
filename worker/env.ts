import type { DatapadObject } from './datapad';

/**
 * `wrangler types` writes the global `Env` from wrangler.jsonc, but it cannot
 * know the Durable Object's class, the dev-only variable, or that the Access
 * vars are any string (they are generated as the literal "").
 */
export interface Bindings
  extends Omit<
    Env,
    | 'DATAPAD'
    | 'ACCESS_AUD'
    | 'ACCESS_TEAM_DOMAIN'
    | 'DEV_ACCESS_EMAIL'
    | 'BACKUP_HOUR'
    | 'BACKUP_TIME_ZONE'
  > {
  DATAPAD: DurableObjectNamespace<DatapadObject>;
  /** The Access application's AUD tag (public). Empty: no Access configured. */
  ACCESS_AUD?: string;
  /** `<team>.cloudflareaccess.com` (public). */
  ACCESS_TEAM_DOMAIN?: string;
  /**
   * .dev.vars only. The signed-in email while developing, honoured only when
   * ACCESS_AUD is empty. Never set it as a deployed var.
   */
  DEV_ACCESS_EMAIL?: string;
  /** The local hour (0–23) of the nightly backup. */
  BACKUP_HOUR?: string;
  /** The IANA zone that hour is in. */
  BACKUP_TIME_ZONE?: string;
}
