import { ACTIVITY_CHANGED, APP_CHANGED, type RemoteChangeDetail } from "../api";
import { accessToken } from "./auth";
import { ownWriteRecent } from "./ownWrites";

/**
 * The web's ear on Wysebee Cloud's change feed (`GET /api/v1/configs/events`). When one of the
 * person's agents or tasks changes — here, in another tab, or by Wysebee Cloud itself (a
 * pairing, a task the AI app saved) — the page gets `APP_CHANGED` with `{remote: true,
 * changes: [], own}`, so App.tsx reads its lists again and warns an editor with unsaved changes
 * — unless `own`: the change most likely is this page's own write echoed back (ownWrites.ts).
 * (The feed says only that the person's revision moved, since migration 0065.)
 *
 * Server-sent events read with `fetch` (EventSource cannot send the Bearer token).
 * Resumes from its revision cursor; reconnects at once when the cloud closes the stream
 * (token expiry, ~4 minutes), with backoff otherwise.
 */
let cursor: number | null = null;
let started = false;

function handle(event: string, data: { revision?: number; unread?: number }): void {
  // The person's unread notifications changed (apps/cloud/notifications.py): the rail's badge.
  if (event === "activity") {
    if (typeof data.unread === "number") window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGED, { detail: { unread: data.unread } }));
    return;
  }
  if (event === "hello") {
    if (cursor === null && typeof data.revision === "number") cursor = data.revision;
  } else if (event === "changes") {
    if (typeof data.revision === "number") cursor = data.revision;
    const detail: RemoteChangeDetail = { remote: true, changes: [], own: ownWriteRecent() };
    window.dispatchEvent(new CustomEvent(APP_CHANGED, { detail }));
  }
}

async function streamOnce(): Promise<"closed" | "error"> {
  try {
    const query = cursor !== null ? `?since=${cursor}` : "";
    const r = await fetch(`/api/v1/configs/events${query}`, {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${await accessToken()}` },
    });
    if (!r.ok || !r.body) return "error";
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return "closed";
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!event) continue;
        try {
          handle(event, data ? JSON.parse(data) : {});
        } catch {
          /* a malformed frame: skip it */
        }
      }
    }
  } catch {
    return "error";
  }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Keep the feed open for the life of the page. */
export function startChangeFeed(): void {
  if (started) return;
  started = true;
  void (async () => {
    let backoff = 1000;
    for (;;) {
      const opened = Date.now();
      const outcome = await streamOnce();
      if (outcome === "closed" && Date.now() - opened > 1000) {
        backoff = 1000;
        continue;
      }
      await sleep(backoff * (0.5 + Math.random() / 2));
      backoff = Math.min(backoff * 2, 60000);
    }
  })();
}
