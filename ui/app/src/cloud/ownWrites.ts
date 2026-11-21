/**
 * This page's own writes to Wysebee Cloud, so the change feed (events.ts) can tell its own
 * echo from a change made elsewhere.
 *
 * The feed names nothing — only that the person's revision moved — and Wysebee Cloud sends
 * it as the write commits, often before the write's response is back. A task's Save still
 * showed its unsaved-changes bar then, so App.tsx took the page's own save for one made "on
 * another device" and offered a reload. A change that comes while one of this page's writes
 * is in flight, or within `OWN_ECHO_MS` of one ending, is taken for its own: the lists are
 * read again all the same, but no open editor is warned or reloaded. A change really made
 * elsewhere in that moment is read with the lists; the editor shows it when next opened.
 */

/** How long after a write ends its echo may still arrive. */
export const OWN_ECHO_MS = 3000;

let inFlight = 0;
let lastEnded = Number.NEGATIVE_INFINITY;

/** Run a write, counted as this page's own while it runs and just after. */
export async function trackWrite<T>(write: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await write();
  } finally {
    inFlight -= 1;
    lastEnded = Date.now();
  }
}

/** Whether a change seen now is most likely this page's own write. */
export function ownWriteRecent(now: number = Date.now()): boolean {
  return inFlight > 0 || now - lastEnded < OWN_ECHO_MS;
}

/** Forget every write (tests). */
export function resetOwnWrites(): void {
  inFlight = 0;
  lastEnded = Number.NEGATIVE_INFINITY;
}
