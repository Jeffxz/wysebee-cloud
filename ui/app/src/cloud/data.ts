import { accessToken, reauthenticate } from "./auth";
import { CloudError } from "./errors";
import { SUBSCRIPTION_REQUIRED_CODE, announceSubscriptionRequired } from "./paywall";
import { trackWrite } from "./ownWrites";

/**
 * The person's Wysebee data in Wysebee Cloud (`/api/v1/data/{table}`, apps/cloud/userdata.py):
 * task runs, reminders and the settings that follow the person, columns in lower case.
 */
export type Row = Record<string, unknown>;

/** A signed request to Wysebee Cloud, signed in again once on a 401; a refusal throws.
 * A write (anything but GET or HEAD) is counted as the page's own (ownWrites.ts). */
export async function cloudFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD" ? request(path, init) : trackWrite(() => request(path, init));
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const send = async () =>
    fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${await accessToken()}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  let r = await send();
  if (r.status === 401) {
    await reauthenticate();
    r = await send();
  }
  if (!r.ok) {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await r.json();
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    const { detail = null, code, ...more } = body;
    // No plan (any more): the plan gate shows Billing alone (paywall.ts).
    if (r.status === 402 && code === SUBSCRIPTION_REQUIRED_CODE) announceSubscriptionRequired();
    throw new CloudError(r.status, detail, typeof code === "string" ? code : undefined, more);
  }
  return r;
}

const at = (table: string, key?: string) => `/api/v1/data/${table}${key !== undefined ? `/${encodeURIComponent(key)}` : ""}`;

/** A table's rows, filtered by `query` (`task_id`, `limit`, `pending`…). */
export async function rows(table: string, query: Record<string, string>): Promise<Row[]> {
  return ((await (await cloudFetch(`${at(table)}?${new URLSearchParams(query)}`)).json()) as { rows: Row[] }).rows;
}

/** One row, or null when there is none. */
export async function row(table: string, key: string): Promise<Row | null> {
  try {
    return (await (await cloudFetch(at(table, key))).json()) as Row;
  } catch (e) {
    if (e instanceof CloudError && e.status === 404) return null;
    throw e;
  }
}

/** Delete a row. */
export async function deleteRow(table: string, key: string): Promise<void> {
  await cloudFetch(at(table, key), { method: "DELETE" });
}

/** Store a picture (a base64 data URL) in the person's asset store; answers its id. */
export async function uploadAsset(dataUrl: string): Promise<string> {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new CloudError(422, "A picture is a base64 data URL.");
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const r = await cloudFetch("/api/v1/assets", { method: "PUT", body: bytes, headers: { "Content-Type": m[1] } });
  return ((await r.json()) as { id: string }).id;
}

/** Delete an asset nothing uses any more. Best effort: a failure is ignored. */
export async function deleteAsset(id: string): Promise<void> {
  try {
    await cloudFetch(`/api/v1/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* Left behind: it counts toward the person's assets until deleted. */
  }
}

/** A picture in the person's asset store, as a data URL (null when it cannot be read).
 * Encoded from the response's bytes and Content-Type, with no Blob or FileReader: those differ
 * between realms (under jsdom, Node 22's Blob is refused by FileReader and Node 26's has no
 * arrayBuffer), and the picture came back null in tests. */
export async function assetDataUrl(id: string): Promise<string | null> {
  try {
    const r = await cloudFetch(`/api/v1/assets/${encodeURIComponent(id)}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    let binary = "";
    // In chunks: one String.fromCharCode call per byte of a 1 MiB picture overflows the stack.
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${r.headers.get("Content-Type") || "application/octet-stream"};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}
