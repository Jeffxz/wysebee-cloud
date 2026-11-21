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

const CONFIG = { host: "db.example.com", port: 5432, database: "orders", user: "reader", ssl: "verify", changes: false };
const shop = tool("postgres", "shop", CONFIG, { description: "Orders", has_secret: true });

/** The person's tools (`library`), those of them the agent has (`mine`), and any route over them. */
function routes(library = [shop], mine = library.map((t) => t.id), over: [string, unknown][] = []) {
  const fake = fakeTools("sky", library, mine);
  return { ...mockFetch([...fake.routes, ...over]), fake };
}

/** An agent's database connections, on its General tab. */
function Tab({ canEdit = true }: { canEdit?: boolean }) {
  return <Connections canEdit={canEdit} agentId="sky" />;
}
/** The General tab's Add button for the kind. */
const toLibrary = async () => {};
const addButton = async () => {
  return screen.getByRole("button", { name: "Add PostgreSQL" });
};
const toInstalled = async () => {};

const dialog = () => screen.getByRole("dialog");
const fill = async (label: string, value: string) => {
  const input = within(dialog()).getByLabelText(label);
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
};

describe("CloudPostgres on the agent's General tab", () => {
  it("lists the agent's connections, kept as the person's tools", async () => {
    routes([shop, tool("postgres", "ops", { ...CONFIG, changes: true })]);
    render(<Tab />);
    expect(await screen.findByText("shop")).toBeTruthy();
    expect(screen.getByText("Read only · reader@db.example.com:5432/orders")).toBeTruthy();
    expect(screen.getByText(/^Read and write · /)).toBeTruthy();
  });

  it("adds one: checked first, tested, then made in the person's tools and given to the agent", async () => {
    const api = routes([], [], [["POST /api/v1/tools/test", { ok: true, version: "PostgreSQL 17.2", error: null }]]);
    render(<Tab />);
    await waitFor(async () => expect(((await addButton()) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(await addButton());
    expect(within(dialog()).getByRole("heading", { name: "New PostgreSQL connection" })).toBeTruthy();
    expect(within(dialog()).getByText(/reaches only databases with a public address/)).toBeTruthy();
    // Checked before anything is sent.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    expect(within(dialog()).getByText(/lowercase letter/)).toBeTruthy();
    await fill("Name", "sales");
    await fill("Database", "shop");
    await fill("Host", "db.example.com");
    await fill("Port", "6543");
    await fill("User", "reader");
    await fill("Password", "s3cret");
    // Only TLS that encrypts: no way to send in the clear.
    expect(within(within(dialog()).getByLabelText("TLS")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["verify", "require"]);
    await userEvent.selectOptions(within(dialog()).getByLabelText("TLS"), "require");
    await userEvent.click(within(dialog()).getByRole("checkbox"));
    await userEvent.type(within(dialog()).getByLabelText("What it holds (optional)"), "Orders");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog()).findByRole("status")).toHaveProperty("textContent", "Connected: PostgreSQL 17.2");
    const sent = { kind: "postgres", name: "sales", description: "Orders", config: { host: "db.example.com", port: 6543, database: "shop", user: "reader", ssl: "require", changes: true }, secret: "s3cret" };
    expect(api.calls.find((c) => c.url === "/api/v1/tools/test")?.body).toEqual(sent);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST" && c.url === "/api/v1/tools")?.body).toEqual(sent);
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ kind: "postgres", tool_ids: ["t1"] });
    await toInstalled();
    expect(await screen.findByText("sales")).toBeTruthy();
  });

  it("changes one — renaming it too — keeping its stored password unless one is typed", async () => {
    const api = routes([shop], undefined, [["POST /api/v1/tools/test", { ok: false, version: null, error: "PostgreSQL: password authentication failed" }]]);
    render(<Tab />);
    await userEvent.click(await screen.findByRole("button", { name: "Change shop" }));
    expect((within(dialog()).getByLabelText("Password") as HTMLInputElement).placeholder).toMatch(/Saved/);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect(await within(dialog()).findByRole("status")).toHaveProperty("textContent", "PostgreSQL: password authentication failed");
    // Tested with its stored password: by the tool's id.
    expect((api.calls.find((c) => c.url === "/api/v1/tools/test")?.body as Record<string, unknown>).tool_id).toBe(shop.id);
    await fill("Name", "store");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const put = api.calls.find((c) => c.method === "PUT" && c.url === `/api/v1/tools/${shop.id}`)?.body as Record<string, unknown>;
    expect(put.name).toBe("store");
    expect("secret" in put).toBe(false);
    expect(await screen.findByText("store")).toBeTruthy();
  });

  it("says what the cloud refused, in the dialog", async () => {
    routes([], [], [
      ["POST /api/v1/tools", reply(422, { detail: "Wysebee Cloud reaches only databases with a public address; 10.0.0.5 is not one." })],
      ["POST /api/v1/tools/test", reply(500, { detail: "down" })],
    ]);
    render(<Tab />);
    await waitFor(async () => expect(((await addButton()) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(await addButton());
    // A test checks the form first too.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect(within(dialog()).getByText(/lowercase letter/)).toBeTruthy();
    expect(within(dialog()).queryByRole("status")).toBeNull();
    await fill("Name", "sales");
    await fill("Database", "shop");
    await fill("Host", "10.0.0.5");
    await fill("User", "reader");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Test connection" }));
    expect((await within(dialog()).findByRole("status")).textContent).toMatch(/down/);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Add tool" }));
    expect(await within(dialog()).findByText(/10\.0\.0\.5 is not one/)).toBeTruthy();
    // Closed with Close, Escape or a click outside.
    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(await addButton());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(await addButton());
    fireEvent.click(dialog().parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes one from the agent once asked — it stays in the library, to give again — and says why when it cannot", async () => {
    const api = routes([shop]);
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<Tab />);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect shop" }));
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Disconnect \'shop\' from this agent?"), expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Disconnect shop" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect shop" })).toBeNull());
    expect(api.fake.state.mine).toEqual([]);
    // In the library: given again with its +.
    await toLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Connect shop" }));
    await waitFor(() => expect(api.fake.state.mine).toEqual([shop.id]));
    api.fake.state.refuse = { status: 500, detail: "down" };
    await toInstalled();
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect shop" }));
    expect(await screen.findByText(/down/)).toBeTruthy();
    confirm.mockRestore();
  });

  it("deletes a connection from any agent once asked, but names the SQL tools that keep it", async () => {
    const spare = tool("postgres", "spare", CONFIG);
    let using = [{ id: "t-ones", name: "ones", draft: false, agents: [{ id: "a1", name: "sky", label: "Sky" }, { id: "a2", name: "sea", label: "Sea" }] }, { id: "t-new", name: "fresh", draft: true, agents: [] }];
    const deleted: string[] = [];
    const api = routes([shop, spare], [shop.id], [
      ["GET /api/v1/tools/postgres-shop/used-by", () => ({ tools: using })],
      ["GET /api/v1/tools/postgres-spare/used-by", { tools: [] }],
      [
        "DELETE /api/v1/tools/postgres-shop",
        () => {
          deleted.push("shop");
          api.fake.state.library = api.fake.state.library.filter((x) => x.id !== shop.id);
          api.fake.state.mine = [];
          return reply(204);
        },
      ],
    ]);
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<Tab />);
    // In use: a dialog names each tool and the agents that have it; nothing is deleted.
    await userEvent.click(await screen.findByRole("button", { name: "Delete shop" }));
    const dialog = await screen.findByRole("dialog", { name: "shop is in use" });
    expect(within(dialog).getByText(/while SQL Query tools use it/)).toBeTruthy();
    expect(within(dialog).getByText("Used by Sky, Sea")).toBeTruthy();
    expect(within(dialog).getByText("Draft")).toBeTruthy();
    expect(within(dialog).getByText("Not given to any agent")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // One left: said in the singular; Escape and a click outside close it too.
    using = [using[0]];
    await userEvent.click(screen.getByRole("button", { name: "Delete shop" }));
    expect(await screen.findByText(/while a SQL Query tool uses it/)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Delete shop" }));
    fireEvent.click((await screen.findByRole("dialog")).parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Unused: deleted once asked — from one not connected here too.
    using = [];
    await userEvent.click(screen.getByRole("button", { name: "Delete spare" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete the connection 'spare'?"), expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Delete shop" }));
    await waitFor(() => expect(deleted).toEqual(["shop"]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete shop" })).toBeNull());
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    confirm.mockRestore();
  });

  it("says why the tools could not be read; read-only settings change nothing; ten at most", async () => {
    routes([], [], [["GET /api/v1/agents/sky/tools", reply(503, { detail: "no key store" })]]);
    const { unmount } = render(<Tab />);
    expect(await screen.findByText(/no key store/)).toBeTruthy();
    expect(((await addButton()) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    routes([shop]);
    const view = render(<Tab canEdit={false} />);
    expect(await screen.findByText("shop")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add PostgreSQL" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your other connections" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change shop" })).toBeNull();
    view.unmount();
    const ten = Array.from({ length: 11 }, (_, i) => tool("postgres", `c${i}`, CONFIG));
    routes(ten, ten.slice(0, 10).map((t) => t.id));
    render(<Tab />);
    await screen.findByText("c9");
    expect(((await addButton()) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Connect c10" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
