import { cloudFetch } from "./data";
import { json } from "./http";
import type { KindRoute } from "./routes";

/**
 * The Account page's reads, passed to Wysebee Cloud: their file storage against the quota
 * (apps/cloud/storage.py) and, where the server's billing extension serves them
 * (`features.billing`, cloud/auth.ts), the person's plan and its usage — devices, relay
 * traffic — (`GET /api/v1/plan`) and the Billing tab's plans, subscription and payments
 * (`GET /api/v1/billing`).
 */
export const CREDIT_ROUTES: KindRoute[] = [
  ["GET", "/api/v1/account/plan", async () => json(await (await cloudFetch("/api/v1/plan")).json())],
  ["GET", "/api/v1/account/storage", async () => json(await (await cloudFetch("/api/v1/storage")).json())],
  ["GET", "/api/v1/account/billing", async () => json(await (await cloudFetch("/api/v1/billing")).json())],
];
