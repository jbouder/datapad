import { withoutThinking } from '#shared/summaries';
import { keyFor } from '@/lib/spaces';

/**
 * Brief me's last text (#259), kept on this device per space and per day
 * so going back to Focus the same day shows it without running the model
 * again. Never synced: it is generated, not data (Save as note keeps it).
 * One entry per space; a new day, Regenerate or dismiss replaces it.
 */

const BASE = 'datapad:brief';

interface Stored {
  day: string;
  text: string;
}

function briefKey(space: string): string {
  return keyFor(BASE, space);
}

/** The brief written on `day` in `space`, or null. */
export function readBrief(space: string, day: string): string | null {
  try {
    const raw = localStorage.getItem(briefKey(space));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    // A brief kept before the fix may still open with the model's <think> block.
    return stored.day === day && typeof stored.text === 'string'
      ? withoutThinking(stored.text) || null
      : null;
  } catch {
    return null;
  }
}

export function writeBrief(space: string, day: string, text: string) {
  try {
    localStorage.setItem(
      briefKey(space),
      JSON.stringify({ day, text } satisfies Stored),
    );
  } catch {
    // Private mode or a full store: it shows until Focus is left.
  }
}

export function clearBrief(space: string) {
  try {
    localStorage.removeItem(briefKey(space));
  } catch {
    // Nothing to forget.
  }
}
