import { CloudError } from "./errors";
import { cloudFetch } from "./data";
import { type Ctx, HttpError, json } from "./http";
import type { KindRoute } from "./routes";

/**
 * The settings that follow the person, as the website changes them (2026-10-31): today only
 * **Send usage analytics** (`telemetry_enabled`), kept in Wysebee Cloud
 * (`/api/v1/data/settings/default`, `{config: {language, telemetry_enabled, …}}`); the other
 * settings in the row are kept as they are.
 */

const ROW = "/api/v1/data/settings/default";

/** The row's settings; none (`{}`) before any was saved. */
async function shared(): Promise<Record<string, unknown>> {
  try {
    const row = (await (await cloudFetch(ROW)).json()) as { config?: unknown };
    return row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {};
  } catch (e) {
    if (e instanceof CloudError && e.status === 404) return {};
    throw e;
  }
}

/** Whether the person lets usage analytics be sent: on unless they turned it off, as on the
 * desktop. Unreadable, it counts as off — a choice that might be "off" is never overridden. */
export async function usageAnalyticsOn(): Promise<boolean> {
  try {
    return (await shared()).telemetry_enabled !== false;
  } catch {
    return false;
  }
}

export const SYSTEM_SETTINGS_ROUTES: KindRoute[] = [
  ["GET", "/api/v1/system/settings", async () => json({ telemetry_enabled: (await shared()).telemetry_enabled !== false })],
  [
    "PUT",
    "/api/v1/system/settings",
    async (ctx: Ctx) => {
      const on = (ctx.body as { telemetry_enabled?: unknown } | null)?.telemetry_enabled;
      if (typeof on !== "boolean") throw new HttpError(422, "'telemetry_enabled' is true or false.");
      const config = { ...(await shared()), telemetry_enabled: on };
      await cloudFetch(ROW, { method: "PUT", body: JSON.stringify({ config }) });
      return json({ telemetry_enabled: on });
    },
  ],
];
