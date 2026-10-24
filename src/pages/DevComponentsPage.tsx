import { useState } from 'react';
import { toggleCheck } from '#shared/markdown';
import type { Link, Priority } from '#shared/types';
import { Field } from '@/components/Field';
import { DatePicker } from '@/components/inputs/DatePicker';
import { LinksEditor } from '@/components/inputs/LinksEditor';
import { PriorityPicker } from '@/components/inputs/PriorityPicker';
import { QuickAdd } from '@/components/inputs/QuickAdd';
import { TagInput } from '@/components/inputs/TagInput';
import { LayoutsDemo } from '@/components/layouts/LayoutsDemo';
import { Markdown } from '@/components/Markdown';
import { PersonPicker } from '@/components/pickers/PersonPicker';
import { ProjectPicker } from '@/components/pickers/ProjectPicker';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useToast } from '@/providers/ToastProvider';

/**
 * Every shared input in its states, for eyeballing and for the a11y suite.
 * Only in dev and e2e builds (see `DEV_ROUTES`); not a Storybook.
 */
/** Every Markdown style the renderer has. */
const SAMPLE = [
  '# Heading one',
  'Body text with **bold**, _italic_, ~~strike~~, `inline code`, a link to https://example.com and <b>no HTML</b>.',
  '## Heading two',
  '- a bullet',
  '- [ ] an open item',
  '- [x] a done item',
  '1. first',
  '2. second',
  '### Heading three',
  '> A quote, kept as said.',
  '---',
  '```ts',
  'const answer = 42;',
  '```',
].join('\n');

export default function DevComponentsPage() {
  usePageTitle('Components');
  const { show } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [due, setDue] = useState('');
  const [tags, setTags] = useState<string[]>(['infra']);
  const [links, setLinks] = useState<Link[]>([]);
  const [panel, setPanel] = useState(false);
  const [sample, setSample] = useState(SAMPLE);
  const [name, setName] = useState('');
  const dirty = useDirty({ name }, { name: '' });

  return (
    <section
      aria-labelledby="components-title"
      className="flex flex-col gap-6 *:max-w-xl [&>#layouts]:max-w-none"
    >
      <h1 id="components-title" className="text-page-title">
        Components
      </h1>

      <QuickAdd
        projectId={projectId}
        onProjectChange={setProjectId}
        onAdd={(title) => {
          show(`Would add “${title}”`);
          return true;
        }}
      />

      <Field label="Project">
        <ProjectPicker value={projectId} onChange={setProjectId} />
      </Field>
      <Field label="Assignee">
        <PersonPicker value={assignee} onChange={setAssignee} allowCreate />
      </Field>
      <PriorityPicker value={priority} onChange={setPriority} />
      <Field label="Due" hint={due ? `Stored as ${due}` : 'Not set'}>
        <DatePicker value={due} onChange={setDue} />
      </Field>
      <Field label="Tags">
        <TagInput
          value={tags}
          onChange={setTags}
          suggestions={['infra', 'vendor', 'hoth']}
        />
      </Field>
      <LinksEditor value={links} onChange={setLinks} />
      <Field label="Name" required error="Give it a name">
        <Input className="h-11 text-base desk:h-8 desk:text-xs" />
      </Field>

      <section aria-labelledby="markdown-title" className="flex flex-col gap-2">
        <h2 id="markdown-title" className="text-xs font-medium">
          Markdown
        </h2>
        <Markdown
          text={sample}
          people={{}}
          onToggle={(line) => setSample((s) => toggleCheck(s, line))}
        />
      </section>

      <LayoutsDemo />

      <div>
        <Button className="press" onClick={() => setPanel(true)}>
          Open a side panel
        </Button>
      </div>
      <SidePanel
        open={panel}
        onClose={() => {
          setPanel(false);
          setName('');
        }}
        title="A side panel"
        dirty={dirty}
        onSubmit={() => {
          show(`Saved “${name}”`);
          setPanel(false);
          setName('');
        }}
        footer={
          <>
            <span className="flex-1" />
            <SidePanelCancel />
            <Button type="submit" className="press">
              Save
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 text-base desk:h-8 desk:text-xs"
          />
        </Field>
        <PriorityPicker value={priority} onChange={setPriority} />
      </SidePanel>
    </section>
  );
}
