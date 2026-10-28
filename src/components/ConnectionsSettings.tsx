import { PlugsIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatDay, formatTimestamp, relativeTime } from '#shared/dates';
import type { Connection } from '#shared/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useClock } from '@/hooks/useClock';
import { useNow, useToday } from '@/hooks/useNow';
import { fetchConnections, revokeConnection, SignedOutError } from '@/lib/api';
import { useToast } from '@/providers/ToastProvider';

/**
 * Settings → Connected apps (#154): the MCP clients you approved on the
 * consent page (Claude Code, Claude Desktop, a claude.ai connector), each
 * with what it may do, when it was approved and last used, and Revoke.
 * They act as you in every space, so this is not per space. Revoking
 * cannot be undone (the app has to connect again), so it asks first.
 */
export function ConnectionsSettings() {
  const { show } = useToast();
  const [list, setList] = useState<Connection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const today = useToday();
  const clock = useClock();
  const endpoint = `${window.location.origin}/mcp`;

  useEffect(() => {
    let current = true;
    fetchConnections()
      .then(({ connections }) => {
        if (current) setList(connections);
      })
      .catch((error: unknown) => {
        // Signed out: the app shows "Sign in again" in place of this.
        if (current && !(error instanceof SignedOutError)) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);

  const revoke = async () => {
    if (!asking || busy) return;
    const gone = asking;
    setBusy(true);
    try {
      await revokeConnection(gone.id);
      setList((prev) => prev?.filter((c) => c.id !== gone.id) ?? prev);
      show(`Revoked ${nameOf(gone)}`);
      setAsking(null);
    } catch (error) {
      if (!(error instanceof SignedOutError)) {
        show(`Could not revoke ${nameOf(gone)}. Try again.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Apps you let in over MCP, such as Claude Code, Claude Desktop or a
        claude.ai connector. Each acts as you, in every space, with what you
        allowed on its sign-in page. To connect one, add{' '}
        <code className="break-words text-foreground">{endpoint}</code> as an
        MCP server. Revoking stops an app at once; to use it again, connect it
        again.
      </p>
      {failed ? (
        <p className="text-sm">Could not list the apps. Reload to retry.</p>
      ) : list === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <PlugsIcon aria-hidden className="text-muted-foreground" />
          No apps connected.
        </p>
      ) : (
        <ul aria-label="Connected apps" className="flex flex-col border-t">
          {list.map((c) => {
            const name = nameOf(c);
            const write = c.scopes.includes('write');
            return (
              <li
                key={c.id}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 text-sm"
              >
                <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-medium break-words">
                      {name}
                    </span>
                    <Badge variant={write ? 'secondary' : 'outline'}>
                      {write ? 'Read and write' : 'Read only'}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <span title={formatTimestamp(c.createdAt, clock)}>
                      Connected {relativeTime(c.createdAt, new Date(now))}
                    </span>
                    {' · '}
                    {c.lastUsedAt ? (
                      <span title={formatTimestamp(c.lastUsedAt, clock)}>
                        Last used {relativeTime(c.lastUsedAt, new Date(now))}
                      </span>
                    ) : (
                      'Not used yet'
                    )}
                    {c.expiresAt && (
                      <>
                        {' · '}
                        Expires {formatDay(c.expiresAt.slice(0, 10), today)}
                      </>
                    )}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="press h-11 text-destructive desk:h-8"
                  onClick={() => setAsking(c)}
                >
                  Revoke
                  <span className="sr-only"> {name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAsking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {asking ? nameOf(asking) : ''}?</DialogTitle>
            <DialogDescription>
              It stops working at once: its next call is refused. This cannot be
              undone; to use it again, connect it again and approve it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={revoke}
              disabled={busy}
            >
              {busy ? 'Revoking…' : 'Revoke'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What an app calls itself, or a stand-in. */
function nameOf(c: Connection): string {
  return c.name?.trim() || 'Unnamed app';
}
