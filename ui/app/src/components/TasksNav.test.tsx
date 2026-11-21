import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import type { Task } from "../api";
import { TasksNav } from "./TasksNav";

const task = (id: string, name: string, over: Partial<Task> = {}) => ({ id, name, trigger: { type: "manual" }, ...over }) as Task;

describe("TasksNav", () => {
  it("lists All tasks, then the tasks by name with their kind, and opens one", async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    render(
      <TasksNav
        rows={[task("t2", "zeta", { label: "Weekly report", trigger: { type: "recurring" } as Task["trigger"] }), task("t1", "check-inbox", { label: "  " })]}
        selected="t2"
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Tasks" })).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["", "All tasks", "check-inbox", "Weekly report"]);
    const weekly = screen.getByRole("button", { name: /Weekly report/ });
    expect(weekly.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "All tasks" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /check-inbox/ }));
    expect(onSelect).toHaveBeenLastCalledWith("t1");
    await userEvent.click(screen.getByRole("button", { name: "All tasks" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("marks All tasks on the list, says when there are none or they are loading, and has no + without leave to add", () => {
    const { rerender } = render(<TasksNav rows={null} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "All tasks" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Task" })).toBeNull();
    rerender(<TasksNav rows={[]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText("No tasks yet.")).toBeTruthy();
  });
});
