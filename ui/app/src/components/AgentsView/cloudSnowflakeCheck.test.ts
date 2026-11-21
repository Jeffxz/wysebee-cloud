import { describe, expect, it } from "vitest";
import type { CloudSnowflakeIn } from "../../api";
import { cloudSnowflakeProblemOf } from "./cloudSnowflakeCheck";

const ok: CloudSnowflakeIn = { description: "", account: "myorg-acct", database: "SHOP", warehouse: "", schema: "", role: "", user: "", auth: "token", changes: false, secret: "pat" };

describe("cloudSnowflakeProblemOf", () => {
  it("says what is wrong as the server would", () => {
    expect(cloudSnowflakeProblemOf("sales", ok, [], false)).toBeNull();
    // A stored secret needs none typed; a key pair names its user.
    expect(cloudSnowflakeProblemOf("sales", { ...ok, secret: undefined }, [], true)).toBeNull();
    expect(cloudSnowflakeProblemOf("sales", { ...ok, auth: "key", user: "kim", warehouse: "WH", schema: "PUBLIC", role: "R" }, ["ops"], false)).toBeNull();
    const cases: [string, Partial<CloudSnowflakeIn>, string][] = [
      ["Sales", {}, "postgres.badName"],
      ["sales", { account: "evil.example/x" }, "snowflake.badAccount"],
      ["sales", { account: "" }, "snowflake.badAccount"],
      ["sales", { database: "" }, "postgres.badDatabase"],
      ["sales", { warehouse: "big wh" }, "snowflake.badWord"],
      ["sales", { schema: "s".repeat(256) }, "snowflake.badWord"],
      ["sales", { role: "a b" }, "snowflake.badWord"],
      ["sales", { auth: "key" }, "snowflake.badUser"],
      ["sales", { user: "a b" }, "snowflake.badUser"],
      ["sales", { secret: undefined }, "snowflake.noToken"],
      ["sales", { secret: undefined, auth: "key", user: "kim" }, "snowflake.noKey"],
      ["sales", { description: "x".repeat(1001) }, "postgres.tooLong"],
    ];
    for (const [name, change, key] of cases) expect(cloudSnowflakeProblemOf(name, { ...ok, ...change }, [], false)).toBe(`agents.tools.${key}`);
    expect(cloudSnowflakeProblemOf("sales", ok, ["sales"], false)).toBe("agents.tools.postgres.taken");
  });
});
