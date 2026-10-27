/**
 * Hard limits, enforced at the boundary (imports and the socket) and by the
 * reducer, so the UI and the Durable Object agree on what fits.
 */
export const LIMITS = {
  /** Document ids are client-generated random strings. */
  idMax: 64,
  /** Project and person names, orgs, roles. */
  nameMax: 120,
  /** Spaces one user may have, Main included. */
  spacesMax: 12,
  /** A space's name: short, it sits in the switcher. */
  spaceNameMax: 40,
  /** Task, meeting and milestone titles. */
  titleMax: 200,
  /** Note bodies and markdown descriptions. */
  bodyMax: 20_000,
  /** Tasks in one template. */
  templateTasksMax: 100,
  /** A blocked task's one-line reason. */
  blockedNoteMax: 200,
  /** The project's one-line current state. */
  stateMax: 300,
  /** A meeting's short agenda or context note. */
  meetingNoteMax: 2_000,
  /** Topics on one meeting (their titles use `titleMax`). */
  topicsMax: 50,
  /** A topic's one-line outcome. */
  topicOutcomeMax: 300,
  /** Milestones on one project. */
  milestonesMax: 50,
  tagsMax: 20,
  tagMax: 30,
  linksMax: 20,
  linkTypeMax: 30,
  linkLabelMax: 200,
  urlMax: 2_048,
  /** Project members and meeting attendees. */
  peopleMax: 100,
  /** Entries kept in one activity log (newest first). */
  activityMax: 150,
  activityTextMax: 300,
  /** Pages with saved preferences in one space (#186). */
  pagesMax: 16,
  /** A saved filter's or section's name. */
  prefKeyMax: 40,
  /** A saved value: a layout, a sort, a project id, an org's name. */
  prefValueMax: 120,
  /** Filters saved for one page. */
  prefFiltersMax: 12,
  /** Sections remembered on one page. */
  prefSectionsMax: 24,
  /** Ops in one batch (bulk actions and their undo). */
  batchMax: 200,
  /** Tasks named in one reorder. */
  reorderMax: 2_000,
  /** One stored document, as UTF-8 JSON. */
  docBytes: 200 * 1024,
  /** One socket message; an op is never bigger than its document. */
  messageBytes: 256 * 1024,
  /** One import or export file. */
  importBytes: 16 * 1024 * 1024,
  /** Applied op ids a snapshot lists, for replay after a reconnect. */
  recentOps: 200,
  /**
   * Applied op ids the object remembers, so an op replayed from a
   * client's offline queue is acknowledged, not applied twice.
   */
  opIdsKept: 1_000,
  /** Ops a single socket may send per second before being refused. */
  opsPerSecond: 20,
  /** Nightly backups kept per user; older ones are deleted. */
  backupsKept: 30,
  /** How long an erase confirmation token works. */
  eraseTokenTtlMs: 5 * 60_000,
} as const;
