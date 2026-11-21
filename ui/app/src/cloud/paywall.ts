/**
 * Where the server serves plans, its billing extension refuses everything but the account to a
 * signed-in person with no plan (402 `{"detail", "code": "subscription_required"}`, through
 * apps/cloud/extensions.py). Every request to
 * it goes through `cloudFetch` (data.ts), which announces such a refusal here, and the plan
 * gate (components/PlanGate.tsx) reads the plan again and, while there is none, shows Billing
 * alone.
 */
export const SUBSCRIPTION_REQUIRED = "wysebee:subscription-required";
export const SUBSCRIPTION_REQUIRED_CODE = "subscription_required";

export function announceSubscriptionRequired(): void {
  window.dispatchEvent(new Event(SUBSCRIPTION_REQUIRED));
}
