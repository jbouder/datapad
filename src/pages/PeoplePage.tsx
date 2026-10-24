import { PeopleView } from '@/components/people/PeopleView';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * Everyone you assign, add to projects and mention, with a detail pane per
 * person for 1:1 prep. In the rail on desktop; on phones, from the account
 * menu and ⌘K.
 */
export function PeoplePage({ person }: { person?: string }) {
  usePageTitle('People');
  return (
    <section
      aria-labelledby="people-title"
      className="enter flex flex-col gap-4"
    >
      <h1 id="people-title" className="text-page-title">
        People
      </h1>
      <PeopleView selected={person} />
    </section>
  );
}
