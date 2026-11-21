import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { ConnectAiApp } from "./ConnectAiApp";

useFetchTransport();

const STATUS = "GET /api/v1/cloud-mcp-status?agent=scout";
const url = "https://wysebee.example/assistant/mcp";
const tools = [
  { name: "browser_screenshot", description: "Take a screenshot" },
  { name: "browser_tabs", description: "" },
];

describe("ConnectAiApp on the web", () => {
  it("gives Wysebee Assistant's address, the agent's tools, and how to add it behind the info icon", async () => {
    mockFetch({ [STATUS]: { url, exposed: true, tools, skills: 2, offline: null } });
    render(<ConnectAiApp agentName="scout" />);
    const description = screen.getByText(/Use this agent from your own AI app/);
    expect(description.textContent).toMatch(/through Wysebee Assistant/);
    expect(description.textContent).toMatch(/no Wysebee Desktop needed/);
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Ready");
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.getByText("Your AI app gets this agent's 2 tools and 2 skills.")).toBeTruthy();
    // Its tools, folded: each one's name and what it does.
    await userEvent.click(screen.getByText("2 tools"));
    expect(screen.getByText("browser_screenshot")).toBeTruthy();
    expect(screen.getByText("Take a screenshot")).toBeTruthy();
    expect(screen.getByText("browser_tabs")).toBeTruthy();
    expect(screen.queryByText(/Add custom connector/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "About Connect your AI app" }));
    expect(screen.getByText(/Add custom connector/)).toBeTruthy();
    expect(screen.getByText(/aren't kept/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "About Connect your AI app" }));
    expect(screen.queryByText(/Add custom connector/)).toBeNull();
  });

  it("says why a browser's agent cannot act now, and when it has no tools", async () => {
    mockFetch({ [STATUS]: { url, exposed: true, tools: [], skills: 0, offline: "@scout is offline: it lives in Chrome, which is closed." } });
    render(<ConnectAiApp agentName="scout" />);
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Not available");
    expect(screen.getByText(/which is closed/)).toBeTruthy();
    expect(screen.getByText("No tools.")).toBeTruthy();
  });

  it("turns the agent off and on for AI apps, and puts the switch back when refused", async () => {
    let fail = true;
    const f = mockFetch({
      [STATUS]: { url, exposed: true, tools, skills: 0, offline: "@scout is offline." },
      "PUT /api/v1/cloud-mcp-agents/scout": (r: { body: unknown }) =>
        fail ? ((fail = false), reply(500, { detail: "Cloud down." })) : { agent: "scout", ...(r.body as object) },
    });
    render(<ConnectAiApp agentName="scout" />);
    const toggle = await screen.findByRole("switch", { name: "Let your AI app use this agent" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(await screen.findByText(/Cloud down/)).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(screen.queryByText(/Cloud down/)).toBeNull();
    // Off: said so, and not as offline.
    expect(screen.getByRole("status").textContent).toBe("Turned off for your AI app");
    expect(screen.getByText("Turned off: your AI app neither sees nor uses this agent.")).toBeTruthy();
    expect(screen.queryByText("@scout is offline.")).toBeNull();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(f.calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([{ exposed: false }, { exposed: false }, { exposed: true }]);
  });

  it("says why the state could not be read", async () => {
    mockFetch({ [STATUS]: reply(500, { detail: "down" }) });
    const { unmount } = render(<ConnectAiApp agentName="scout" />);
    expect(await screen.findByText(/down/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
  });
});
