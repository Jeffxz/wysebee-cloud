import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import * as api from "../../api";
import { tool } from "../../../../test/tools";
import { changedParts, SqlToolEditor, sqlToolProblemOf } from "./SqlToolEditor";

const shop = tool("postgres", "shop", { database: "orders" });
const wh = tool("snowflake", "wh", { database: "SHOP" });

function setup(more: Partial<Parameters<typeof SqlToolEditor>[0]> = {}) {
  const props = { connections: [shop, wh], others: ["taken"], onSave: vi.fn(async () => {}), onBack: vi.fn(), onConnect: vi.fn(), ...more };
  render(<SqlToolEditor {...props} />);
  return props;
}
const sql = (value: string) => fireEvent.change(screen.getByLabelText("SQL template"), { target: { value } });
const params = () => screen.queryAllByRole("listitem");

beforeEach(() => vi.restoreAllMocks());

describe("SqlToolEditor", () => {
  it("asks for a database connection first when the agent has none", async () => {
    const p = setup({ connections: [] });
    expect(screen.getByText("Connect a database first")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create tool" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Connect a database" }));
    expect(p.onConnect).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(p.onBack).toHaveBeenCalled();
  });

  it("makes a tool with parameters, checked first and validated by its database", async () => {
    const validate = vi.spyOn(api, "validateSql").mockResolvedValueOnce({ ok: false, error: 'PostgreSQL: relation "x" does not exist' }).mockResolvedValueOnce({ ok: true, error: null }).mockRejectedValueOnce(new Error("offline"));
    const p = setup();
    // Its id, before it is made.
    expect((screen.getByLabelText("ID") as HTMLInputElement).value).toMatch(/^[0-9a-f-]{36}$/);
    // Two connections: one to pick.
    expect((screen.getByLabelText("Database connection") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("No parameters.")).toBeTruthy();
    const create = () => userEvent.click(screen.getByRole("button", { name: "Create tool" }));
    await create();
    expect(screen.getByText(/The name has letters, digits/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "calc_my_metric");
    await userEvent.type(screen.getByLabelText("Description"), "Energy use of a building.");
    await userEvent.selectOptions(screen.getByLabelText("Database connection"), "snowflake-wh");
    // Validate needs SQL.
    expect((screen.getByRole("button", { name: "Validate" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    await userEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(params()).toHaveLength(2);
    const [first, second] = params();
    // The hint names the parameter, once it has a name.
    expect(within(first).getByRole("button", { name: /\{param_name\}/ })).toBeTruthy();
    await userEvent.type(within(first).getByLabelText("Parameter name"), "building_id");
    await userEvent.selectOptions(within(first).getByLabelText("Type"), "integer");
    await userEvent.click(within(first).getByRole("checkbox", { name: "required" }));
    await userEvent.type(within(first).getByLabelText("Parameter description"), "The building's id.");
    await userEvent.type(within(second).getByLabelText("Parameter name"), "since");
    await userEvent.selectOptions(within(second).getByLabelText("Type"), "date");
    await userEvent.type(within(second).getByLabelText("default"), "2026-01-01");
    // Only filter when set: never required (and back off again).
    await userEvent.click(within(first).getByRole("checkbox", { name: /Only filter when set/ }));
    await userEvent.click(within(first).getByRole("checkbox", { name: /Only filter when set/ }));
    expect((within(first).getByRole("checkbox", { name: "required" }) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(within(first).getByRole("checkbox", { name: "required" }));
    await userEvent.click(within(second).getByRole("checkbox", { name: "required" }));
    await userEvent.click(within(second).getByRole("checkbox", { name: /Only filter when set/ }));
    expect((within(second).getByRole("checkbox", { name: "required" }) as HTMLInputElement).checked).toBe(false);
    expect(within(second).getByRole("button", { name: /\[\[AND COLUMN = \{since\}\]\]/ })).toBeTruthy();
    await create();
    expect(screen.getByText("Write the SQL it runs.")).toBeTruthy();
    sql("SELECT * FROM {database}.R.X WHERE BUILDING_ID = {building_id} [[AND DAY >= {since}]]");
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect((await screen.findByRole("status")).textContent).toBe('PostgreSQL: relation "x" does not exist');
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/^Valid/);
    // A change clears what Validate said.
    sql("SELECT * FROM {database}.R.X WHERE BUILDING_ID = {building_id} [[AND DAY >= {since}]] ");
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect((await screen.findByRole("status")).textContent).toBe("offline");
    expect(validate.mock.calls[0][0].config).toEqual({
      connection_id: "snowflake-wh",
      params: [
        { name: "building_id", type: "integer", description: "The building's id.", required: true, default: null, optional: false },
        { name: "since", type: "date", description: "", required: false, default: "2026-01-01", optional: true },
      ],
      sql: "SELECT * FROM {database}.R.X WHERE BUILDING_ID = {building_id} [[AND DAY >= {since}]]",
    });
    await create();
    await waitFor(() => expect(p.onSave).toHaveBeenCalled());
    const [saved, fresh] = vi.mocked(p.onSave).mock.calls[0] as unknown as [api.SqlTool, boolean];
    expect(fresh).toBe(true);
    expect(saved).toMatchObject({ name: "calc_my_metric", connectionId: "snowflake-wh" });
    expect(api.sqlToolIn(saved, true).id).toBe(saved.id);
  });

  it("says what the save refused, and removes a parameter", async () => {
    const p = setup({ onSave: vi.fn(async () => Promise.reject(new Error("The SQL uses {x}, which is not a parameter."))) });
    await userEvent.type(screen.getByLabelText("Name"), "calc");
    await userEvent.type(screen.getByLabelText("Description"), "Calc.");
    await userEvent.selectOptions(screen.getByLabelText("Database connection"), "postgres-shop");
    await userEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove parameter 1" }));
    expect(params()).toHaveLength(0);
    sql("SELECT {x}");
    await userEvent.click(screen.getByRole("button", { name: "Create tool" }));
    expect(await screen.findByText("The SQL uses {x}, which is not a parameter.")).toBeTruthy();
    expect(p.onSave).toHaveBeenCalled();
  });

  it("changes a tool, saying when its connection is no longer the agent's", async () => {
    const initial: api.SqlTool = { id: "t9", name: "calc", description: "Calc.", connectionId: "gone", params: [{ name: "n", type: "number", description: "", required: false, default: "", optional: false }], sql: "SELECT {n}" };
    const p = setup({ initial });
    expect(screen.getByRole("heading", { name: "Edit calc" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Not connected to this agent any more/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Pick the database connection it queries.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Manage connections" }));
    expect(p.onConnect).toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("Database connection"), "postgres-shop");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "t9", connectionId: "postgres-shop" }), false));
    // With no connection at all, a tool already made still opens.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("says a proposed change changes nothing when it is the same", () => {
    const same: api.SqlTool = { id: "t1", name: "calc", description: "Calc.", connectionId: "postgres-shop", params: [], sql: "SELECT 1" };
    setup({ initial: { ...same, pending: { ...same } } });
    expect(screen.getByText("It changes: nothing.")).toBeTruthy();
    expect(screen.queryByText("The SQL now:")).toBeNull();
    expect(changedParts(same, { ...same, connectionId: "x", params: [{ name: "n", type: "string", description: "", required: false, default: "", optional: false }] })).toEqual(["connection", "params"]);
  });

  it("checks what the server checks too", () => {
    const ok: api.SqlTool = { id: "i", name: "calc", description: "Calc.", connectionId: "c", params: [], sql: "SELECT 1" };
    const p = (over: Partial<api.SqlParam>): api.SqlParam => ({ name: "n", type: "string", description: "", required: false, default: "", optional: false, ...over });
    expect(sqlToolProblemOf(ok, [])).toBeNull();
    expect(sqlToolProblemOf({ ...ok, name: "-x" }, [])).toBe("agents.tools.sql.badName");
    expect(sqlToolProblemOf(ok, ["calc"])).toBe("agents.tools.sql.taken");
    expect(sqlToolProblemOf({ ...ok, description: " " }, [])).toBe("agents.tools.sql.needDescription");
    expect(sqlToolProblemOf({ ...ok, connectionId: "" }, [])).toBe("agents.tools.sql.needConnection");
    expect(sqlToolProblemOf({ ...ok, params: [p({ name: "database" })] }, [])).toBe("agents.tools.sql.badParam");
    expect(sqlToolProblemOf({ ...ok, params: [p({ name: "1x" })] }, [])).toBe("agents.tools.sql.badParam");
    expect(sqlToolProblemOf({ ...ok, params: [p({}), p({})] }, [])).toBe("agents.tools.sql.twoParams");
  });

  it("reads a tool as Wysebee Cloud keeps it", () => {
    const kept = tool("sql", "calc", { connection_id: "c", params: [{ name: "n", type: "integer", default: 3, required: true }, { name: "m", default: null }, { type: "date" }], sql: "SELECT {n}, {m}" }, { id: "t1", description: "Calc." });
    expect(api.sqlToolOf(kept)).toEqual({
      id: "t1",
      name: "calc",
      description: "Calc.",
      connectionId: "c",
      params: [
        { name: "n", type: "integer", description: "", required: true, default: "3", optional: false },
        { name: "m", type: "string", description: "", required: false, default: "", optional: false },
        { name: "", type: "date", description: "", required: false, default: "", optional: false },
      ],
      sql: "SELECT {n}, {m}",
    });
    expect(api.sqlToolOf(tool("sql", "x"))).toMatchObject({ connectionId: "", params: [], sql: "" });
    // A change proposed with nothing but itself: the tool's own name and description.
    expect(api.sqlToolOf(tool("sql", "x", { pending: {} }, { description: "D." })).pending).toMatchObject({ name: "x", description: "D.", sql: "" });
  });
});
