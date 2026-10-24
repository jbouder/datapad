import { OrgsView } from '@/components/orgs/OrgsView';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The clients, teams, vendors and partners projects belong to, and one
 * org's page at `/orgs/:id`. In the rail on desktop; on phones, from the
 * account menu and ⌘K.
 */
export function OrgsPage({ org }: { org?: string }) {
  usePageTitle('Orgs');
  return (
    <section aria-labelledby="orgs-title" className="enter flex flex-col gap-4">
      <h1 id="orgs-title" className="text-page-title">
        Orgs
      </h1>
      <OrgsView selected={org} />
    </section>
  );
}
