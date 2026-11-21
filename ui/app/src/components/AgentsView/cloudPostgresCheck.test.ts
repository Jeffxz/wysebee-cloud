import { describe, expect, it } from "vitest";
import type { CloudPostgresIn } from "../../api";
import { cloudPostgresProblemOf } from "./cloudPostgresCheck";

const good: CloudPostgresIn = { description: "", host: "db.example.com", port: 5432, database: "shop", user: "reader", ssl: "verify", changes: false };

describe("cloudPostgresProblemOf", () => {
  it("passes a good connection, and names what is wrong otherwise", () => {
    expect(cloudPostgresProblemOf("sales", good, ["ops"])).toBeNull();
    expect(cloudPostgresProblemOf("Sales", good, [])).toBe("agents.tools.postgres.badName");
    expect(cloudPostgresProblemOf("ops", good, ["ops"])).toBe("agents.tools.postgres.taken");
    expect(cloudPostgresProblemOf("sales", { ...good, host: "" }, [])).toBe("agents.tools.postgres.badHost");
    expect(cloudPostgresProblemOf("sales", { ...good, host: "a.example.com,b.example.com" }, [])).toBe("agents.tools.postgres.badHost");
    expect(cloudPostgresProblemOf("sales", { ...good, port: 0 }, [])).toBe("agents.tools.postgres.badPort");
    expect(cloudPostgresProblemOf("sales", { ...good, port: 1.5 }, [])).toBe("agents.tools.postgres.badPort");
    expect(cloudPostgresProblemOf("sales", { ...good, database: "two words" }, [])).toBe("agents.tools.postgres.badDatabase");
    expect(cloudPostgresProblemOf("sales", { ...good, user: "x".repeat(256) }, [])).toBe("agents.tools.postgres.badUser");
    expect(cloudPostgresProblemOf("sales", { ...good, description: "x".repeat(1001) }, [])).toBe("agents.tools.postgres.tooLong");
  });
});
