import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import type { AgentDetail } from "../../api";

import { AgentConfigPanel } from "./AgentConfigPanel";
import { TASK_TABS } from "../TasksView/tabs";
import { dialogs } from "../common/confirm";

const detail = (config: Record<string, unknown> = {}, over: Partial<AgentDetail> = {}): AgentDetail => ({
  id: "t1",
  agent_name: "nightly",
  config,
  system_prompt: "",
  creator: "me@x.com",
  creator_name: "Me",
  created_by: { id: "u1", name: "Me", email: "me@x.com" },
  updated_by: { id: "u2", name: "Sam", email: "sam@x.com" },
  updated_at: "2026-01-02T03:04:05Z",
  ...over,
});

function panel(over: Partial<Parameters<typeof AgentConfigPanel>[0]> = {}) {
  const onSave = vi.fn(async (config: Record<string, unknown>) => detail(config));
  const onDelete = vi.fn(async () => {});
  const onTabChange = vi.fn();
  const utils = render(
    <AgentConfigPanel
      detail={detail({ instructions: "Do it", label: "Nightly" })}
      meRole="AGENT_ADMIN"
      currentUserEmail="me@x.com"
      onSave={onSave}
      onDelete={onDelete}
      onTabChange={onTabChange}
      tabs={TASK_TABS}
      {...over}
    />,
  );
  return { onSave, onDelete, onTabChange, ...utils };
}

describe("AgentConfigPanel (a task's page)", () => {
  it("opens on General with what the task is, and switches tabs", async () => {
    const { onTabChange } = panel();
    expect(screen.getByText("nightly")).toBeTruthy();
    expect(screen.getByText("t1")).toBeTruthy();
    expect(screen.getByText(new Date("2026-01-02T03:04:05Z").toLocaleString())).toBeTruthy();
    expect(screen.getByText("Made by you · Last changed by Sam")).toBeTruthy();
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Nightly");
    // General and Plan: no Skills tab.
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(onTabChange).toHaveBeenCalledWith("plan");
    expect(screen.getByText("Do it")).toBeTruthy();
  });

  it("shows dashes for an unsaved id and time, and nobody when nobody is named", () => {
    panel({ detail: detail({}, { id: undefined, updated_at: null, created_by: null, updated_by: null }) });
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText(/Made by/)).toBeNull();
  });

  it("draws a tab its owner gives it (a task's runs)", async () => {
    panel({ extraTabs: { run: () => <p>the runs</p> } });
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByText("the runs")).toBeTruthy();
  });

  it("follows the tab in the URL", () => {
    const { rerender } = panel({ initialTab: "property" });
    expect(screen.queryByText("Do it")).toBeNull();
    rerender(
      <AgentConfigPanel
        detail={detail({ instructions: "Do it" })}
        meRole="AGENT_ADMIN"
        currentUserEmail="me@x.com"
        onSave={vi.fn()}
        onDelete={vi.fn()}
        initialTab="plan"
        tabs={TASK_TABS}
      />,
    );
    // The same panel, now on Plan; what it holds is what it loaded.
    expect(screen.getByText("Do it")).toBeTruthy();
  });

  it("saves the whole config, keeping what is set on the desktop and dropping retired keys", async () => {
    const config = {
      label: "Nightly",
      instructions: "Do it",
      // Set in Wysebee Desktop: written back untouched.
      chat_model: "openai:gpt",
      browser: "chrome-1",
      browser_access: false,
      skills: ["a"],
      // Retired: never saved again.
      creator: "x",
      tools: ["old"],
      workspace: "w",
      database: "d",
      database_write: true,
      authorization: {},
      authorization_tool: "auth",
      entry_points: [],
      local_folders: [],
    };
    const { onSave } = panel({ detail: detail(config) });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.clear(screen.getByLabelText("Label"));
    await userEvent.type(screen.getByLabelText("Label"), " Night ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({
      label: "Night",
      instructions: "Do it",
      chat_model: "openai:gpt",
      browser: "chrome-1",
      browser_access: false,
      skills: ["a"],
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("leaves out an empty label and plan", async () => {
    const { onSave } = panel({ detail: detail({ label: "L", instructions: "P", other: 1 }) });
    await userEvent.clear(screen.getByLabelText("Label"));
    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toEqual({ other: 1 });
  });

  it("saves the plan with ⌘S", async () => {
    const { onSave } = panel({ initialTab: "plan" });
    await userEvent.type(screen.getByRole("textbox"), " now");
    await userEvent.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ instructions: "Do it now" });
  });

  it("discards every field back to what is saved", async () => {
    panel({ detail: detail({ label: "L", instructions: "P" }) });
    await userEvent.type(screen.getByLabelText("Label"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Plan" }));
    await userEvent.type(screen.getByRole("textbox"), " more");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("P");
    await userEvent.click(screen.getByRole("button", { name: "General" }));
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("L");
  });

  it("discards to empty fields when nothing was saved", async () => {
    panel({ detail: detail({}) });
    await userEvent.type(screen.getByLabelText("Label"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("");
  });

  it("shows a refused save, as an Error or as text", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("conflict")).mockRejectedValueOnce("bare");
    panel({ onSave });
    await userEvent.type(screen.getByLabelText("Label"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("conflict")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("bare")).toBeTruthy();
  });

  it("deletes after confirming", async () => {
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    const onDelete = vi.fn().mockResolvedValueOnce(undefined);
    panel({ onDelete });
    const del = screen.getByRole("button", { name: "Delete task" });
    await userEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("nightly"), expect.anything());
    await userEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Deleting…" })).toHaveProperty("disabled", true);
  });

  it("shows why a delete failed", async () => {
    vi.spyOn(dialogs, "confirm").mockResolvedValue(true);
    const onDelete = vi.fn().mockRejectedValueOnce(new Error("in use")).mockRejectedValueOnce("bare");
    panel({ onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(await screen.findByText("in use")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(await screen.findByText("Failed to delete task.")).toBeTruthy();
  });

  it("is read-only for someone who may not edit it", () => {
    panel({ meRole: "AGENT_EDITOR", currentUserEmail: "other@x.com" });
    expect((screen.getByLabelText("Label") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
    expect(screen.getByText("Read-only — you can only edit tasks you created.")).toBeTruthy();
  });

  it("is read-only for a reader", () => {
    panel({ meRole: "AGENT_READER" });
    expect((screen.getByLabelText("Label") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Read-only — your role can view but not edit tasks.")).toBeTruthy();
  });
});
