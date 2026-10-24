/**
 * A populated tracker for specs that need one, as a JSON import payload
 * (the import route lands in M1). Everything here is fictional; the
 * repository is public and never holds real data.
 */
export const SEED = {
  version: 1,
  projects: [
    {
      id: 'p-echo',
      name: 'Echo Base relocation',
      org: 'Rebel Alliance',
      status: 'active',
      priority: 'high',
      state: 'Shield generator parts arrive Friday',
      tags: ['infra'],
      order: 0,
    },
    {
      id: 'p-falcon',
      name: 'Falcon hyperdrive refit',
      org: 'Corellian Engineering',
      status: 'paused',
      priority: 'med',
      state: 'Waiting on a motivator',
      tags: ['vendor'],
      order: 1,
    },
  ],
  tasks: [
    {
      id: 't-1',
      projectId: 'p-echo',
      title: 'Confirm shield generator delivery',
      status: 'open',
      priority: 'high',
      order: 0,
    },
    {
      id: 't-2',
      projectId: 'p-falcon',
      title: 'Find a replacement motivator',
      status: 'open',
      priority: 'med',
      order: 0,
    },
  ],
  notes: [
    {
      id: 'n-1',
      projectId: 'p-echo',
      body: '## Standup\n- Tauntauns fed\n- [ ] Check the heaters',
    },
  ],
  events: [],
  people: [{ id: 'u-leia', name: 'Leia Organa', role: 'General' }],
  activity: [],
} as const;
