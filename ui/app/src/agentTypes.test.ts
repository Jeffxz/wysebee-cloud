import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { TYPES } from "../../test/agentTypes";
import { forgetAgentTypes, loadAgentTypes, useAgentTypes } from "./agentTypes";

beforeEach(() => {
  vi.restoreAllMocks();
  forgetAgentTypes();
});

describe("agentTypes", () => {
  it("reads the types once, on first use, and shares them", async () => {
    const read = vi.spyOn(api, "fetchAgentTypes").mockResolvedValue({ types: TYPES });
    const one = renderHook(() => useAgentTypes());
    const two = renderHook(() => useAgentTypes());
    expect(one.result.current).toBeNull();
    await waitFor(() => expect(one.result.current).toEqual(TYPES));
    expect(two.result.current).toEqual(TYPES);
    await loadAgentTypes();
    expect(read).toHaveBeenCalledTimes(1);
    act(() => forgetAgentTypes());
    expect(one.result.current).toBeNull();
    one.unmount();
    two.unmount();
  });

  it("reads them again after a failure", async () => {
    const read = vi.spyOn(api, "fetchAgentTypes").mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ types: TYPES });
    await loadAgentTypes();
    const { result } = renderHook(() => useAgentTypes());
    await waitFor(() => expect(result.current).toEqual(TYPES));
    expect(read).toHaveBeenCalledTimes(2);
  });
});
