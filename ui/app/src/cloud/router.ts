import { currentProfile } from "./auth";
import { type Ctx, type Handler, errorResponse, fail, json } from "./http";
import { forward, isForwarded } from "./forward";
import { KIND_ROUTES } from "./routes";

/**
 * The in-browser gateway: the admin API's paths, answered on the web.
 *
 * The screens call the same `/agent/*` and `/api/v1/*` paths Wysebee Desktop's call on
 * its gateway; here each is answered over Wysebee Cloud's own routes (routes.ts), or sent
 * straight up when the cloud answers the same path (forward.ts). Anything else is refused
 * with 501.
 */
type Route = [method: string, pattern: RegExp, keys: string[], handler: Handler];

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/\{(\w+)\}/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "$",
  );
  return [method, pattern, keys, handler];
}

const NOT_ON_THE_WEB = "Not available on the web.";

// Who is asking: the signed-in person.
const STUBS: Route[] = [
  route("GET", "/api/v1/config/users/me", async () => {
    const p = await currentProfile();
    return json({
      user_id: p?.sub ?? "",
      email: p?.email ?? null,
      user_role: "AGENT_ADMIN",
      auth_provider: {},
      additional_attributes: {},
      created_at: "",
      updated_at: "",
    });
  }),
];

const ROUTES: Route[] = [...STUBS, ...KIND_ROUTES.map(([m, p, h]) => route(m, p, h))];

export async function dispatch(method: string, fullPath: string, rawBody?: string): Promise<Response> {
  const url = new URL(fullPath, window.location.origin);
  // Workspaces and tasks: Wysebee Cloud answers the same paths itself (forward.ts).
  if (isForwarded(url.pathname)) return forward(method, url.pathname + url.search, rawBody);
  let body: unknown = null;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return fail(422, "The request body is not JSON.");
    }
  }
  for (const [m, pattern, keys, handler] of ROUTES) {
    if (m !== method) continue;
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    keys.forEach((key, i) => {
      params[key] = decodeURIComponent(match[i + 1]);
    });
    const ctx: Ctx = { method, path: url.pathname, query: url.searchParams, params, body };
    try {
      return await handler(ctx);
    } catch (e) {
      return errorResponse(e);
    }
  }
  return fail(501, NOT_ON_THE_WEB);
}
