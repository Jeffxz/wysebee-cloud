import { CloudError } from "./errors";
import { cloudFetch } from "./data";
import { type Ctx, HttpError, json } from "./http";
import { str } from "./values";
import type { KindRoute } from "./routes";

/**
 * The browsers paired with the **Wysebee Agent** extension (the cloud's
 * `/api/v1/browser-links`, apps/cloud/browser_links.py; the contract is
 * wysebee-agent-browser-extension's docs/protocol.md), forwarded with the person's token
 * under these paths:
 *
 * - `GET /api/v1/browser-links` — `{links}`, the account's paired browsers.
 * - `POST /api/v1/browser-links/claim` `{code, name?, reconnect?}` — the code the extension
 *   shows, typed here. The cloud makes **a new agent** for that browser, living in
 *   Wysebee Cloud, which drives the browser itself. A name
 *   refused keeps the code good (2026-11-13): the person claims again with another `name`, or
 *   with `reconnect` to the agent `name_taken` named, when it said it may be.
 * - `POST /api/v1/browser-links/{id}/unpair` — the link is deleted and its agent loses its
 *   browser.
 * - `POST /api/v1/browser-links/offers` — a pairing for a device to scan as a QR code
 *   (2026-11-17): `{id, token, expires_in}`; `GET …/offers/{id}` — how it stands (`waiting`,
 *   `paired` with `agent`, `expired`).
 *
 * A claim and an unpair change agent items the cloud wrote itself, so once one is done what
 * was read of them is dropped. A refusal carrying a `code` is answered as `{detail: {code, message}}`, which
 * the page turns into its own sentence.
 */
const BASE = "/api/v1/browser-links";

/** The cloud's refusal, with its `code` where it sent one (beside the sentence, or in it),
 * and what else it said (`name_taken`'s `agent` and `reconnect`). */
function refused(e: unknown): unknown {
  if (!(e instanceof CloudError)) return e;
  const detail = e.detail;
  const code = e.code ?? (detail && typeof detail === "object" ? str((detail as { code?: unknown }).code) : "");
  return code ? new HttpError(e.status, { ...e.more, code, message: e.message }) : e;
}

async function claim(ctx: Ctx): Promise<Response> {
  const body = (ctx.body ?? {}) as { code?: unknown; name?: unknown; reconnect?: unknown };
  const code = str(body.code).trim();
  if (!code) throw new HttpError(422, "Type the code the extension shows.");
  // The person's choice for a name refused, passed as typed: the cloud checks it.
  const choice = { ...(typeof body.name === "string" ? { name: body.name } : {}), ...(body.reconnect === true ? { reconnect: true } : {}) };
  let made: unknown;
  try {
    made = await (await cloudFetch(`${BASE}/claim`, { method: "POST", body: JSON.stringify({ code, ...choice }) })).json();
  } catch (e) {
    throw refused(e);
  }
  return json(made);
}

export const BROWSER_LINK_ROUTES: KindRoute[] = [
  ["GET", BASE, async () => json(await (await cloudFetch(BASE)).json())],
  // The agent types (2026-11-13, later), for their names.
  ["GET", "/api/v1/agent-types", async () => json(await (await cloudFetch("/api/v1/agent-types")).json())],
  ["POST", `${BASE}/claim`, claim],
  ["POST", `${BASE}/offers`, async () => {
    try {
      return json(await (await cloudFetch(`${BASE}/offers`, { method: "POST", body: "{}" })).json());
    } catch (e) {
      throw refused(e);
    }
  }],
  ["GET", `${BASE}/offers/{id}`, async ({ params }) => {
    try {
      return json(await (await cloudFetch(`${BASE}/offers/${encodeURIComponent(params.id)}`)).json());
    } catch (e) {
      throw refused(e);
    }
  }],
  ["POST", `${BASE}/{id}/unpair`, async ({ params }) => {
    try {
      await cloudFetch(`${BASE}/${encodeURIComponent(params.id)}/unpair`, { method: "POST" });
    } catch (e) {
      throw refused(e);
    }
    return json(null, 204);
  }],
];
