import { CloudError } from "./errors";

/** The pieces of one admin API request the router hands a handler. */
export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

export function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A gateway-style error: `{detail}` with the status the desktop's route would send. */
export function fail(status: number, detail: unknown): Response {
  return json({ detail }, status);
}

/** Thrown by a handler to answer an error at once. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
  }
}

/** Errors from the cloud or a handler, as the screens expect them from the gateway. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return fail(e.status, e.detail);
  if (e instanceof CloudError) {
    // "Changed on another device" stays a 409 the screens show as a conflict.
    return fail(e.status, e.detail ?? e.message);
  }
  return fail(503, e instanceof Error ? e.message : "Could not reach Wysebee Cloud.");
}
