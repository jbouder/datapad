import seed from '../test/fixtures/export.json' with { type: 'json' };

/**
 * A populated tracker for specs that need one: the fictional export the
 * unit tests use, posted to `/api/import`. The repository is public and
 * never holds real data.
 */
export const SEED = seed;

/** Documents per collection in the seed, as the import reports them. */
export const SEED_COUNTS = {
  projects: Object.keys(seed.projects).length,
  tasks: Object.keys(seed.tasks).length,
  notes: Object.keys(seed.notes).length,
  events: Object.keys(seed.events).length,
  people: Object.keys(seed.people).length,
  activity: Object.keys(seed.activity).length,
  // The artifact's export has no settings.
  settings: 0,
  decisions: 0,
  orgs: 0,
  templates: 0,
};
