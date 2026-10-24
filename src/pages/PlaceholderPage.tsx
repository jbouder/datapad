import { usePageTitle } from '@/hooks/usePageTitle';

/** A section whose view has not landed yet: its title and a line about it. */
export function PlaceholderPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  usePageTitle(title);
  const id = `${title.toLowerCase().replace(/\W+/g, '-')}-title`;
  return (
    <section aria-labelledby={id} className="enter flex flex-col gap-2">
      <h1 id={id} className="text-page-title">
        {title}
      </h1>
      <p className="text-state">{children}</p>
    </section>
  );
}
