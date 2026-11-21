import { describe, expect, it } from "vitest";
import { mockFetch, reply, replyText } from "../../test/fetch";
import { useFetchTransport } from "../../test/transport";
import * as api from "./api";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  canCreateConfig,
  canEditCreated,
} from "./api";

useFetchTransport();

type Kind = "get" | "post" | "put" | "delete" | "deleteJson";

/** Every exported request function: how to call it, its method and path, and its kind. */
const CALLS: [string, () => Promise<unknown>, string, Kind][] = [
  ["fetchMe", () => api.fetchMe(), "GET /api/v1/config/users/me", "get"],
  ["fetchTasks", () => api.fetchTasks(), "GET /api/v1/tasks", "get"],
  ["fetchNotifications", () => api.fetchNotifications(), "GET /api/v1/notifications?limit=100", "get"],
  ["fetchUnreadNotifications", () => api.fetchUnreadNotifications(), "GET /api/v1/notifications/unread", "get"],
  ["markNotificationsRead", () => api.markNotificationsRead(), "POST /api/v1/notifications/read", "post"],
  ["deleteNotification", () => api.deleteNotification("n 1"), "DELETE /api/v1/notifications/n%201", "delete"],
  ["createTask", () => api.createTask({ name: "t" }), "POST /api/v1/tasks", "post"],
  ["discardSkillChange", () => api.discardSkillChange("s1", "c 1"), "DELETE /api/v1/skills/s1/changes/c%201", "delete"],
  ["fetchSkillRequests", () => api.fetchSkillRequests("a 1"), "GET /api/v1/agents/a%201/skill-requests", "get"],
  ["giveRequestedSkill", () => api.giveRequestedSkill("a1", "k1"), "POST /api/v1/agents/a1/skill-requests/k1/give", "post"],
  ["declineSkillRequest", () => api.declineSkillRequest("a1", "k1"), "DELETE /api/v1/agents/a1/skill-requests/k1", "delete"],
  ["fetchPage", () => api.fetchPage("p 1"), "GET /api/v1/pages/p%201", "get"],
  ["fetchDocumentPage", () => api.fetchDocumentPage("w1", "a b.md"), "GET /api/v1/workspaces/w1/page?path=a%20b.md", "get"],
  ["deleteTool", () => api.deleteTool("t 1"), "DELETE /api/v1/tools/t%201", "delete"],
  ["validateSql", () => api.validateSql({ kind: "sql", name: "a", description: "b", config: {} }), "POST /api/v1/tools/validate-sql", "post"],
  ["updateTask", () => api.updateTask("t1", {}), "PUT /api/v1/tasks/t1", "put"],
  ["deleteTask", () => api.deleteTask("t1"), "DELETE /api/v1/tasks/t1", "delete"],
  ["fetchAgentDetail", () => api.fetchAgentDetail("wysebee"), "GET /agent/agents/wysebee", "get"],
  ["saveAgentConfig", () => api.saveAgentConfig("wysebee", {}), "PUT /agent/agents/wysebee", "put"],
  ["fetchProfile", () => api.fetchProfile(), "GET /api/v1/profile", "get"],
  ["fetchReminders", () => api.fetchReminders(), "GET /api/v1/reminders", "get"],
  ["cancelReminder", () => api.cancelReminder("r1"), "DELETE /api/v1/reminders/r1", "delete"],
  ["fetchTaskRuns", () => api.fetchTaskRuns("t1"), "GET /api/v1/tasks/t1/runs?limit=20", "get"],
  ["fetchTaskRun", () => api.fetchTaskRun("t1", "r1"), "GET /api/v1/tasks/t1/runs/r1", "get"],
  ["saveProfile", () => api.saveProfile({ display_name: "Ann" }), "PUT /api/v1/profile", "put"],
  ["fetchAppearance", () => api.fetchAppearance(), "GET /api/v1/config/appearance", "get"],
  ["saveAppearance", () => api.saveAppearance("dark"), "PUT /api/v1/config/appearance", "put"],
  ["fetchAgentTypes", () => api.fetchAgentTypes(), "GET /api/v1/agent-types", "get"],
];

/** Answer every request with `status`, recording what was asked. */
function answerAll(status: number, body: unknown = { ok: true }) {
  return mockFetch([[/.*/, () => reply(status, body)]]);
}

describe("api request functions", () => {
  it.each(CALLS)("%s sends the right request and returns its body", async (_name, call, key, kind) => {
    const f = answerAll(kind === "delete" ? 204 : 200);
    const result = await call();
    expect(`${f.calls[0].method} ${f.calls[0].url}`).toBe(key);
    if (kind === "delete") expect(result).toBeUndefined();
    else expect(result).toEqual({ ok: true });
  });

  it.each(CALLS)("%s turns a 404 into NotFoundError", async (_name, call) => {
    answerAll(404, { detail: "gone" });
    const err = (await call().catch((e) => e)) as ConflictError;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe("gone");
  });

  it.each(CALLS.filter(([, , , kind]) => kind !== "get"))(
    "%s turns a 409 into ConflictError",
    async (_name, call) => {
      answerAll(409, { detail: { message: "in the way", agents: ["a"] } });
      const err = (await call().catch((e) => e)) as ConflictError;
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.message).toBe("in the way");
      expect(err.detail).toEqual({ message: "in the way", agents: ["a"] });
    },
  );

  it.each(CALLS)("%s turns any other failure into an Error with the status", async (_name, call) => {
    answerAll(500, { detail: "boom" });
    const err = (await call().catch((e) => e)) as ConflictError;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("HTTP 500: boom");
  });

  it.each(CALLS)("%s turns a 401 into UnauthorizedError", async (_name, call) => {
    answerAll(401, { detail: "no" });
    const err = (await call().catch((e) => e)) as ConflictError;
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe("Unauthorized");
  });

  it("a GET's 409 is just an error", async () => {
    answerAll(409, { detail: "nope" });
    await expect(api.fetchTasks()).rejects.toThrow("HTTP 409: nope");
  });

  it("sends JSON headers, with a content type only when there is a body", async () => {
    const f = answerAll(200);
    await api.fetchTasks();
    await api.updateTask("t1", { label: "c" });
    const [getInit, putInit] = f.fn.mock.calls.map((c) => c[1] as RequestInit);
    expect(getInit.headers).toEqual({ Accept: "application/json" });
    expect(putInit.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(f.calls[1].body).toEqual({ label: "c" });
  });
});

describe("reading an error", () => {
  it("uses HTTP <status> when the detail object has no message", async () => {
    answerAll(409, { detail: { blocked: true } });
    const err = await api.deleteTask("t").catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toBe("HTTP 409");
    expect(err.detail).toEqual({ blocked: true });
  });

  it("shows a non-JSON body as it came", async () => {
    mockFetch([[/.*/, () => replyText(502, "Bad gateway")]]);
    await expect(api.fetchTasks()).rejects.toThrow("HTTP 502: Bad gateway");
  });

  it("falls back to the status for an empty body", async () => {
    mockFetch([[/.*/, () => replyText(500, "")]]);
    await expect(api.fetchTasks()).rejects.toThrow("HTTP 500: HTTP 500");
  });

  it("shows JSON with no detail as it came", async () => {
    mockFetch([[/.*/, () => replyText(500, "null")]]);
    await expect(api.fetchTasks()).rejects.toThrow("HTTP 500: null");
    mockFetch([[/.*/, () => replyText(500, '{"error":"x"}')]]);
    await expect(api.fetchTasks()).rejects.toThrow('HTTP 500: {"error":"x"}');
  });

  it("a conflict with a string detail carries no structure", async () => {
    answerAll(409, { detail: "taken" });
    const err = await api.createTask({ name: "t" }).catch((e) => e);
    expect(err.message).toBe("taken");
    expect(err.detail).toBeUndefined();
  });
});

describe("permission helpers", () => {
  it("canCreateConfig: admins and editors", () => {
    expect(canCreateConfig("AGENT_ADMIN")).toBe(true);
    expect(canCreateConfig("AGENT_EDITOR")).toBe(true);
    expect(canCreateConfig("AGENT_READER")).toBe(false);
    expect(canCreateConfig(null)).toBe(false);
  });

  it("canEditCreated: admins anything, editors their own", () => {
    expect(canEditCreated("AGENT_ADMIN", "", null)).toBe(true);
    expect(canEditCreated("AGENT_EDITOR", " Me@x.com ", "me@X.com")).toBe(true);
    expect(canEditCreated("AGENT_EDITOR", "me@x.com", "you@x.com")).toBe(false);
    expect(canEditCreated("AGENT_EDITOR", "me@x.com", "")).toBe(false);
    expect(canEditCreated("AGENT_EDITOR", "", "me@x.com")).toBe(false);
    expect(canEditCreated("AGENT_READER", "me@x.com", "me@x.com")).toBe(false);
  });
});

describe("constants", () => {
  it("names the change event", () => {
    expect(api.APP_CHANGED).toBe("wysebee:app-changed");
  });
});
