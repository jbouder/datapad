/**
 * Hard limits, enforced at the boundary (imports and the socket) and by the
 * reducer, so the UI and the Durable Object agree on what fits.
 */
export const LIMITS = {
  /** Document ids are client-generated random strings. */
  idMax: 64,
  /** Project and person names, orgs, roles. */
  nameMax: 120,
  /** Task and event titles. */
  titleMax: 200,
  /** Note bodies and markdown descriptions. */
  bodyMax: 20_000,
  /** The project's one-line current state. */
  stateMax: 300,
  /** An event's short agenda or context note. */
  eventNoteMax: 2_000,
  tagsMax: 20,
  tagMax: 30,
  linksMax: 20,
  linkTypeMax: 30,
  linkLabelMax: 200,
  urlMax: 2_048,
  /** Project members and event attendees. */
  peopleMax: 100,
  /** Entries kept in one activity log (newest first). */
  activityMax: 150,
  activityTextMax: 300,
  /** Tasks named in one reorder. */
  reorderMax: 2_000,
  /** One stored document, as UTF-8 JSON. */
  docBytes: 200 * 1024,
  /** One socket message; an op is never bigger than its document. */
  messageBytes: 256 * 1024,
  /** One import or export file. */
  importBytes: 16 * 1024 * 1024,
  /** Ops a single socket may send per second before being refused. */
  opsPerSecond: 20,
  /** How long an erase confirmation token works. */
  eraseTokenTtlMs: 5 * 60_000,
} as const;
