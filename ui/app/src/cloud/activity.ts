import { cloudFetch } from "./data";
import { json } from "./http";
import type { KindRoute } from "./routes";

/**
 * The person's Activity (apps/cloud/notifications.py): the notifications their AI app sends
 * through Wysebee Assistant, answered by Wysebee Cloud as it is.
 */
export const ACTIVITY_ROUTES: KindRoute[] = [
  ["GET", "/api/v1/notifications", async (ctx) => {
    const limit = ctx.query.get("limit");
    return json(await (await cloudFetch(`/api/v1/notifications${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`)).json());
  }],
  ["GET", "/api/v1/notifications/unread", async () => json(await (await cloudFetch("/api/v1/notifications/unread")).json())],
  ["POST", "/api/v1/notifications/read", async () => json(await (await cloudFetch("/api/v1/notifications/read", { method: "POST", body: "{}" })).json())],
  ["DELETE", "/api/v1/notifications/{id}", async ({ params }) => {
    await cloudFetch(`/api/v1/notifications/${encodeURIComponent(params.id)}`, { method: "DELETE" });
    return json(null, 204);
  }],
];
