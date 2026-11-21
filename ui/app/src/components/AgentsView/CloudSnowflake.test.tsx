import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { fakeTools, tool } from "../../../../test/tools";
import { useFetchTransport } from "../../../../test/transport";
import { Connections } from "./Connections";
import { dialogs } from "../common/confirm";

useFetchTransport();

const CONFIG = { account: "myorg-acct", database: "SHOP", warehouse: "", schema: "", role: "", user: "", auth: "token", changes: false };
const wh = tool("snowflake", "wh", CONFIG, { description: "Orders", has_secret: true });

/** The person's tools (`library`), those of them the agent has (`mine`), and any route over them. */
function routes(library = [wh], mine = library.map((t) => t.id), over: [string, unknown][] = []) {
  const fake = fakeTools("sky", library, mine);
  return { ...mockFetch([...fake.routes, ...over]), fake };
}

/** An agent's database connections, on its General tab. */
function Tab({ canEdit = true }: { canEdit?: boolean }) {
  return <Connections canEdit={canEdit} agentId="sky" />;
}
/** The General tab's Add button for the kind. */
const addButton = async () => {
  return screen.getByRole("button", { name: "Add Snowflake" });
};
const toInstalled = async () => {};

const dialog = () => screen.getByRole("dialog");
const fill = async (label: string, value: string) => {
  const input = within(dialog()).getByLabelText(label);
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
};

describe("CloudSnowflake on the agent's General tab", () => {
  it("lists the agent's connections kept in Wysebee Cloud", async () => {
    routes([wh, tool("snowflake", "ops", { ...CONFIG, changes: true })]);
    render(<Tab />);
    expect(await screen.findByText("wh")).toBeTruthy();
    expect(screen.getByText("Read only · SHOP · myorg-acct")).toBeTruthy();
    expect(screen.getByText(/^Read and write · /)).toBeTruthy();
  });

  it("opens the dialog on any plan, with no plan asked", async () => {
    const api = routes([]);
    render(<Tab />);
    await waitFor(async () => expect(((await addButton()) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(await addButton());
    expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: "New Snowflake connection" })).toBeTruthy();
    expect(api.to("GET /api/v1/account/plan")).toHaveLength(0);
  });

  it("adds one: checked first, tested, then saved to Wysebee Cloud", async () => {
    const api = routes([], [], [["POST /api/v1/tools/test", { ok: true, version: "9.30.1", error: null }]]);
    render(<Tab />);
    await waitFor(async () => expect(((await addButton()) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(await addButton());
    expect(within(await screen.findByRole("dialog")).getByRole("heading", { name: "New Snowflake connection" })).toBeTruthy();
    // Checked before anything is sent.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    expect(within(dialog()).getByText(/lowercase letter/)).toBeTruthy();
    await fill("Name", "sales");
    await fill("Account", "myorg-acct");
    await fill("Database", "SHOP");
    await fill("Warehouse (optional)", "WH");
    await fill("Schema (optional)", "PUBLIC");
    await fill("Role (optional)", "ANALYST");
    await fill("User (optional)", "kim");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    expect(within(dialog()).getByText("Enter the access token.")).toBeTruthy();
    await fill("Programmatic access token", " pat-1 ");
    await userEvent.click(within(dialog()).getByRole("checkbox"));
    await userEvent.type(within(dialog()).getByLabelText("What it holds (optional)"), "Orders");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog()).findByRole("status")).toHaveProperty("textContent", "Connected: Snowflake 9.30.1");
    const sent = {
      kind: "snowflake", name: "sales", description: "Orders",
      config: { account: "myorg-acct", database: "SHOP", warehouse: "WH", schema: "PUBLIC", role: "ANALYST", user: "kim", auth: "token", changes: true }, secret: "pat-1",
    };
    expect(api.calls.find((c) => c.url === "/api/v1/tools/test")?.body).toEqual(sent);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST" && c.url === "/api/v1/tools")?.body).toEqual(sent);
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ kind: "snowflake", tool_ids: ["t1"] });
    await toInstalled();
    expect(await screen.findByText("sales")).toBeTruthy();
  });

  it("changes one, keeping its stored secret unless the way it signs in changes", async () => {
    const api = routes([wh], undefined, [["POST /api/v1/tools/test", { ok: false, version: null, error: "Snowflake: Programmatic access token is invalid." }]]);
    const first = render(<Tab />);
    await userEvent.click(await screen.findByRole("button", { name: "Change wh" }));
    expect((within(dialog()).getByLabelText("Programmatic access token") as HTMLInputElement).placeholder).toMatch(/Saved/);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog()).findByRole("status")).toHaveProperty("textContent", "Snowflake: Programmatic access token is invalid.");
    // A key pair needs its user and its key: the stored token is not one.
    await userEvent.selectOptions(within(dialog()).getByLabelText("Sign in with"), "key");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(within(dialog()).getByText(/Give the user name the key belongs to/)).toBeTruthy();
    await fill("User", "kim");
    expect((within(dialog()).getByLabelText("Private key (PEM)") as HTMLTextAreaElement).placeholder).toBe("-----BEGIN PRIVATE KEY-----");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(within(dialog()).getByText("Paste the private key.")).toBeTruthy();
    await userEvent.selectOptions(within(dialog()).getByLabelText("Sign in with"), "token");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const put = api.calls.find((c) => c.method === "PUT" && c.url === `/api/v1/tools/${wh.id}`)?.body as Record<string, unknown>;
    expect("secret" in put).toBe(false);
    // One saved with a key shows the key is kept.
    first.unmount();
    routes([tool("snowflake", "wh", { ...CONFIG, auth: "key", user: "kim" }, { has_secret: true })]);
    render(<Tab />);
    await userEvent.click(await screen.findByRole("button", { name: "Change wh" }));
    expect((within(dialog()).getByLabelText("Private key (PEM)") as HTMLTextAreaElement).placeholder).toMatch(/Saved/);
    await fill("Private key (PEM)", "-----BEGIN PRIVATE KEY-----");
  });

  it("says what the cloud refused, in the dialog", async () => {
    routes([], [], [
      ["POST /api/v1/tools", reply(422, { detail: "An agent has at most 10 Snowflake connections." })],
      ["POST /api/v1/tools/test", reply(500, { detail: "down" })],
    ]);
    render(<Tab />);
    await waitFor(async () => expect(((await addButton()) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(await addButton());
    await screen.findByRole("dialog");
    // A test checks the form first too.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect(within(dialog()).getByText(/lowercase letter/)).toBeTruthy();
    expect(within(dialog()).queryByRole("status")).toBeNull();
    await fill("Name", "sales");
    await fill("Account", "myorg-acct");
    await fill("Database", "SHOP");
    await fill("Programmatic access token", "pat");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect((await within(dialog()).findByRole("status")).textContent).toMatch(/down/);
    // The plan ended between the offer and the save: the cloud's words.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    expect(await within(dialog()).findByText("HTTP 422: An agent has at most 10 Snowflake connections.")).toBeTruthy();
    // Closed with Close, Escape or a click outside.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(await addButton());
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(await addButton());
    fireEvent.click((await screen.findByRole("dialog")).parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes one from the agent once asked, and says why when it cannot", async () => {
    const api = routes([wh]);
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<Tab />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect wh" }));
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Disconnect \'wh\' from this agent?"), expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Disconnect wh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect wh" })).toBeNull());
    expect(api.fake.state.mine).toEqual([]);
    api.fake.state.mine = [wh.id];
    api.fake.state.refuse = { status: 500, detail: "down" };
    render(<Tab />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect wh" }));
    expect(await screen.findByText(/down/)).toBeTruthy();
    confirm.mockRestore();
  });

  it("says why the connections could not be read; read-only settings change nothing; ten at most", async () => {
    routes([], [], [["GET /api/v1/agents/sky/tools", reply(503, { detail: "no key store" })]]);
    const { unmount } = render(<Tab />);
    expect(await screen.findByText(/no key store/)).toBeTruthy();
    expect(((await addButton()) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    routes([wh]);
    const view = render(<Tab canEdit={false} />);
    expect(await screen.findByText("wh")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Snowflake" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your other connections" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change wh" })).toBeNull();
    view.unmount();
    routes(Array.from({ length: 10 }, (_, i) => tool("snowflake", `c${i}`, CONFIG)));
    render(<Tab />);
    await screen.findByText("c9");
    expect(((await addButton()) as HTMLButtonElement).disabled).toBe(true);
  });
});
