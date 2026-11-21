import { beforeEach, describe, expect, it } from "vitest";
import { mockFetch, reply } from "../../test/fetch";
import { addAgent, agentNamed, handleFor, loadAgents, ordered, removeAgent, resetAgents, useAgents, validHandle } from "./agents";
import { renderHook, waitFor } from "@testing-library/react";
import { useFetchTransport } from "../../test/transport";

useFetchTransport();

beforeEach(() => resetAgents());

describe("agents", () => {
  it("puts Wysebee first, then the person's agents by label, a missing label by name", async () => {
    mockFetch({
      "GET /agent/agents": {
        rows: [
          { id: "z", agent_name: "zed", label: "Alpha", updated_at: null },
          { id: "w", agent_name: "wysebee", label: "Wysebee", avatar: "🐝", updated_at: null },
          { id: "b", agent_name: "bare", label: null, updated_at: null },
          { id: "s", agent_name: "scout", label: "Scout", browser: true, updated_at: null },
          { id: "m", agent_name: "macky", label: "Macky", mac: true, device: "wysebee-windows", updated_at: null },
        ],
      },
    });
    const { result } = renderHook(() => useAgents());
    await loadAgents();
    await waitFor(() => expect(result.current.items?.map((a) => a.name)).toEqual(["wysebee", "zed", "bare", "macky", "scout"]));
    expect(result.current.items?.[2]).toEqual({ id: "b", name: "bare", label: "bare", avatar: "" });
    // One made by pairing the browser extension says so; the others carry no such flag.
    expect(result.current.items?.[4]).toEqual({ id: "s", name: "scout", label: "Scout", avatar: "", browser: true });
    // So does one made by pairing Wysebee Agent for Mac.
    expect(result.current.items?.[3]).toEqual({ id: "m", name: "macky", label: "Macky", avatar: "", mac: true, device: "wysebee-windows" });
    expect(ordered([{ id: "b", name: "b", label: "B", avatar: "" }, { id: "w", name: "wysebee", label: "W", avatar: "" }]).map((a) => a.name)).toEqual(["wysebee", "b"]);
    // An address names one by its id, or by its handle.
    const items = result.current.items ?? [];
    expect([agentNamed(items, "s")?.name, agentNamed(items, "scout")?.id, agentNamed(items, "nobody")]).toEqual(["scout", "s", undefined]);
  });

  it("says why they could not be read", async () => {
    mockFetch({ "GET /agent/agents": reply(500, { detail: "down" }) });
    const { result } = renderHook(() => useAgents());
    await loadAgents();
    await waitFor(() => expect(result.current.error).toBe("HTTP 500: down"));
    resetAgents();
    mockFetch({
      "GET /agent/agents": () => {
        throw "offline";
      },
    });
    await loadAgents();
    await waitFor(() => expect(result.current.error).toBe("offline"));
  });

  it("adds and removes one, before or after the list is read", async () => {
    mockFetch({
      "POST /agent/agents": { id: "a1", agent_name: "aide", config: { label: "Aide" }, system_prompt: "", creator: "", updated_at: null },
      "DELETE /agent/agents/a1": reply(204, null),
    });
    const { result } = renderHook(() => useAgents());
    expect(await addAgent("aide", "Aide")).toEqual({ id: "a1", name: "aide", label: "Aide", avatar: "" });
    await waitFor(() => expect(result.current.items).toEqual([{ id: "a1", name: "aide", label: "Aide", avatar: "" }]));
    await removeAgent("a1");
    await waitFor(() => expect(result.current.items).toEqual([]));
    resetAgents();
    await removeAgent("a1");
    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  it("makes a handle from a name", () => {
    expect(handleFor("Travel Planner")).toBe("travel-planner");
    expect(handleFor("  Café  au lait!! ")).toBe("cafe-au-lait");
    expect(handleFor("123 Go")).toBe("go");
    expect(handleFor("日本")).toBe("");
    expect(handleFor("x".repeat(40))).toHaveLength(30);
    expect(validHandle("aide") && validHandle("a1-b_c")).toBe(true);
    expect(validHandle("") || validHandle("1a") || validHandle("Aide") || validHandle("x".repeat(31))).toBe(false);
  });
});
