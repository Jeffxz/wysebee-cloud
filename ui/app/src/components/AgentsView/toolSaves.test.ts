import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { tool } from "../../../../test/tools";
import { giveTool } from "./toolSaves";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "fetchAgentTools").mockResolvedValue({ tools: [tool("postgres", "shop"), tool("snowflake", "wh")] });
  vi.spyOn(api, "setAgentTools").mockResolvedValue({ tools: [] });
});

describe("giveTool", () => {
  it("gives a tool after those of its kind the agent has, and leaves one it has", async () => {
    await giveTool("a1", "postgres", "t9");
    expect(api.setAgentTools).toHaveBeenCalledWith("a1", "postgres", ["postgres-shop", "t9"]);
    await giveTool("a1", "postgres", "postgres-shop");
    expect(api.setAgentTools).toHaveBeenCalledTimes(1);
  });
});
