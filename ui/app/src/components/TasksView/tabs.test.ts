import { describe, expect, it } from "vitest";
import { TASK_TABS, taskTabFromSegment } from "./tabs";

describe("task tabs", () => {
  it("are General, Plan and the runs — read only here — and are found by segment", () => {
    expect(TASK_TABS.map(([k]) => k)).toEqual(["property", "plan", "run"]);
    expect(taskTabFromSegment("plan")).toBe("plan");
    expect(taskTabFromSegment("run")).toBe("run");
    expect(taskTabFromSegment("nope")).toBeNull();
    expect(taskTabFromSegment(undefined)).toBeNull();
  });
});
