import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { resetAgents } from "../agents";
import { AddAgentDialog } from "./AddAgentDialog";
import { useFetchTransport } from "../../../test/transport";

useFetchTransport();

beforeEach(() => resetAgents());

const label = () => screen.getByRole("textbox", { name: "Name" });
const handle = () => screen.getByRole("textbox", { name: "@ name" }) as HTMLInputElement;
const save = () => userEvent.click(screen.getByRole("button", { name: "Add agent" }));

describe("AddAgentDialog", () => {
  it("asks for a name and a usable handle before asking the server", async () => {
    const api = mockFetch({});
    render(<AddAgentDialog onClose={vi.fn()} onAdded={vi.fn()} />);
    await save();
    expect(screen.getByText("Give it a name.")).toBeTruthy();
    await userEvent.type(label(), "日本");
    expect(handle().value).toBe("");
    await save();
    expect(screen.getByText(/The @ name must start with a lowercase letter/)).toBeTruthy();
    expect(api.to("POST /agent/agents")).toHaveLength(0);
  });

  it("takes the person's own handle, and shows the server's refusal", async () => {
    let refuse = true;
    const api = mockFetch({
      "POST /agent/agents": (r: FakeRequest) =>
        refuse ? reply(409, { detail: "There is already an agent named 'scout'." }) : { id: "new-id", agent_name: (r.body as { name: string }).name, config: { label: "Finder" }, system_prompt: "", creator: "", updated_at: null },
    });
    const onAdded = vi.fn();
    render(<AddAgentDialog onClose={vi.fn()} onAdded={onAdded} />);
    await userEvent.type(label(), "Finder");
    await userEvent.clear(handle());
    await userEvent.type(handle(), "Scout");
    // Lowercased as typed, and no longer following the name.
    expect(handle().value).toBe("scout");
    await userEvent.type(label(), "s");
    expect(handle().value).toBe("scout");
    await save();
    expect(await screen.findByText(/already an agent named 'scout'/)).toBeTruthy();
    refuse = false;
    await save();
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith("new-id"));
    expect(api.to("POST /agent/agents").map((r) => r.body)).toEqual([{ name: "scout", label: "Finders" }, { name: "scout", label: "Finders" }]);
  });

  it("sends once while it waits, and shows a refusal that is not an Error", async () => {
    let release!: () => void;
    let calls = 0;
    mockFetch({
      "POST /agent/agents": () => {
        calls += 1;
        return new Promise((_, reject) => {
          release = () => reject("offline");
        });
      },
    });
    render(<AddAgentDialog onClose={vi.fn()} onAdded={vi.fn()} />);
    await userEvent.type(label(), "Aide");
    await save();
    await save();
    expect(calls).toBe(1);
    release();
    expect(await screen.findByText("offline")).toBeTruthy();
  });

  it("closes by Cancel, Escape or a click outside it", async () => {
    mockFetch({});
    const onClose = vi.fn();
    render(<AddAgentDialog onClose={onClose} onAdded={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    // A click inside does not.
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
