import { describe, expect, it } from "vitest";
import { CloudError } from "./errors";
import { HttpError, errorResponse, fail, json } from "./http";

describe("http", () => {
  it("answers JSON, and nothing for a 204", async () => {
    const r = json({ a: 1 });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    expect(await r.json()).toEqual({ a: 1 });
    expect(await json(null, 204).text()).toBe("");
    const f = fail(404, "gone");
    expect([f.status, await f.json()]).toEqual([404, { detail: "gone" }]);
  });

  it("names an HttpError by its detail when it is text", () => {
    expect(new HttpError(422, "bad").message).toBe("bad");
    expect(new HttpError(409, { code: "x" }).message).toBe("HTTP 409");
  });

  it("turns errors into the gateway's answers", async () => {
    const h = errorResponse(new HttpError(400, { code: "x" }));
    expect([h.status, await h.json()]).toEqual([400, { detail: { code: "x" } }]);
    const c = errorResponse(new CloudError(409, { code: "conflict", message: "changed" }));
    expect([c.status, await c.json()]).toEqual([409, { detail: { code: "conflict", message: "changed" } }]);
    const c2 = errorResponse(new CloudError(502, null));
    expect(await c2.json()).toEqual({ detail: "Wysebee Cloud answered 502" });
    const e = errorResponse(new Error("offline"));
    expect([e.status, await e.json()]).toEqual([503, { detail: "offline" }]);
    expect(await errorResponse("weird").json()).toEqual({ detail: "Could not reach Wysebee Cloud." });
  });
});
