import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { taskKind, TaskKindIcon } from "./schedule";

describe("schedule helpers", () => {
  it("names a trigger's kind, manual when there is none", () => {
    expect(taskKind(null)).toBe("manual");
    expect(taskKind(undefined)).toBe("manual");
    expect(taskKind({ type: "once" })).toBe("once");
    expect(taskKind({ type: "recurring" })).toBe("recurring");
    expect(taskKind({ type: "manual" })).toBe("manual");
  });

  it("draws each kind's icon with its label and default size", () => {
    render(
      <>
        <TaskKindIcon trigger={{ type: "once" }} />
        <TaskKindIcon trigger={null} size={20} className="x" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Timer" })).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
