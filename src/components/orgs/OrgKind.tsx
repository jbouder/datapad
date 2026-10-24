import type { OrgKind } from '#shared/types';

export const ORG_KIND_LABELS: Record<OrgKind, string> = {
  client: 'Client',
  internal: 'Internal',
  vendor: 'Vendor',
  partner: 'Partner',
};

export function OrgKindPill({ kind }: { kind: OrgKind }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center border px-1.5 text-[11px] font-medium text-muted-foreground">
      {ORG_KIND_LABELS[kind]}
    </span>
  );
}
