import { useMemo, useState } from 'react';
import { namesToTokens, tokensToNames } from '#shared/mentions';
import { type Link, ORG_KINDS, type Org, type OrgKind } from '#shared/types';
import { Field } from '@/components/Field';
import { cleanLinks, LinksEditor } from '@/components/inputs/LinksEditor';
import { MemberChips } from '@/components/inputs/MemberChips';
import { Segmented } from '@/components/inputs/Segmented';
import { NoteComposer } from '@/components/NoteComposer';
import { ORG_KIND_LABELS } from '@/components/orgs/OrgKind';
import { SidePanel, SidePanelCancel, useDirty } from '@/components/SidePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDatapad } from '@/hooks/useDatapad';
import { navigate } from '@/lib/router';
import { useToast } from '@/providers/ToastProvider';

interface Values {
  name: string;
  kind: OrgKind;
  contacts: string[];
  notes: string;
  links: Link[];
  archived: boolean;
}

/** Add or edit an org: name, kind, contacts, notes and links. */
export function OrgForm({
  org,
  open,
  onClose,
  onExited,
}: {
  org?: Org;
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const { state, actions } = useDatapad();
  const { show } = useToast();
  const people = state?.people ?? {};
  // Read once, when the panel opens.
  const [initial] = useState<Values>(() => ({
    name: org?.name ?? '',
    kind: org?.kind ?? 'client',
    contacts: org?.contacts ?? [],
    notes: org ? tokensToNames(org.notes, people) : '',
    links: org?.links ?? [],
    archived: org?.archived ?? false,
  }));
  const [values, setValues] = useState(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const dirty = useDirty(values, initial);
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const everyone = useMemo(
    () => Object.values(people).sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const save = () => {
    const name = values.name.trim();
    if (!name) {
      setNameError('Give the org a name');
      document.getElementById('org-name')?.focus();
      return;
    }
    const fields = {
      name,
      kind: values.kind,
      contacts: values.contacts,
      notes: namesToTokens(values.notes, people),
      links: cleanLinks(values.links),
      archived: values.archived,
    };
    if (!org) {
      const id = actions.addOrg({
        name,
        kind: values.kind,
        contacts: values.contacts,
      });
      if (!id) return;
      if (fields.notes || fields.links.length > 0) {
        actions.editOrg({
          id,
          patch: { notes: fields.notes, links: fields.links },
        });
      }
      onClose();
      show(`Added ${name}`);
      navigate({ name: 'orgs', org: id });
      return;
    }
    const patch = Object.fromEntries(
      Object.entries(fields).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(org[key as keyof typeof fields]),
      ),
    );
    if (Object.keys(patch).length > 0) {
      if (!actions.editOrg({ id: org.id, patch })) return;
    }
    onClose();
    if (dirty) show(`Saved ${name}`);
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={org ? 'Org' : 'New org'}
      description={org?.name ?? 'Add an org'}
      dirty={dirty}
      onSubmit={save}
      footer={
        <>
          <span className="flex-1" />
          <SidePanelCancel />
          <Button type="submit" className="press">
            {org ? 'Save' : 'Add org'}
          </Button>
        </>
      }
    >
      <Field label="Name" required error={nameError}>
        <Input
          id="org-name"
          value={values.name}
          autoComplete="off"
          onChange={(e) => {
            set('name', e.target.value);
            if (nameError && e.target.value.trim()) setNameError(null);
          }}
          className="h-11 text-base desk:h-8 desk:text-sm"
        />
      </Field>
      <Segmented
        legend="Kind"
        value={values.kind}
        onChange={(kind) => set('kind', kind)}
        options={ORG_KINDS.map((k) => ({
          value: k,
          label: ORG_KIND_LABELS[k],
        }))}
      />
      <MemberChips
        label="Contacts"
        people={everyone}
        value={values.contacts}
        onChange={(contacts) => set('contacts', contacts)}
      />
      <Field label="Notes" hint="Markdown; type / for styles, @ to mention">
        <NoteComposer
          value={values.notes}
          onChange={(notes) => set('notes', notes)}
          people={people}
          rows={4}
        />
      </Field>
      <LinksEditor
        value={values.links}
        onChange={(links) => set('links', links)}
      />
      {org && (
        <label className="flex min-h-11 items-center gap-2 text-sm desk:min-h-8">
          <input
            type="checkbox"
            checked={values.archived}
            onChange={(e) => set('archived', e.target.checked)}
            className="size-4 accent-foreground"
          />
          Archived (kept, but out of pickers)
        </label>
      )}
    </SidePanel>
  );
}
