import type { Template } from './types';

export type TemplateKind = 'project' | 'note';

/** A note template: Markdown a note starts from (`body` is set). */
export function isNoteTemplate(t: Template): t is Template & { body: string } {
  return t.body !== undefined;
}

/** One kind of template, by name. */
export function templatesOf(
  templates: Record<string, Template>,
  kind: 'note',
): (Template & { body: string })[];
export function templatesOf(
  templates: Record<string, Template>,
  kind: TemplateKind,
): Template[];
export function templatesOf(
  templates: Record<string, Template>,
  kind: TemplateKind,
): Template[] {
  return Object.values(templates)
    .filter((t) => isNoteTemplate(t) === (kind === 'note'))
    .sort((a, b) => a.name.localeCompare(b.name));
}
