import { describe, expect, it } from "vitest";
import { cleaned, problemOf, programsOf, splitCommand } from "./localPrograms";

describe("localPrograms", () => {
  it("reads the programs in a config, leaving out what cannot be read", () => {
    expect(programsOf(undefined)).toEqual([]);
    expect(programsOf("x")).toEqual([]);
    expect(
      programsOf([
        { name: "wc", description: "Count", command: "wc", args: [{ value: "-w" }, { param: "file", description: "The file" }, { param: "n" }] },
        { name: "bare", command: 5 },
        null,
        "x",
        { name: "bad", description: "d", command: "c", args: [{ other: 1 }] },
        { name: "bad2", description: "d", command: "c", args: [null] },
      ]),
    ).toEqual([
      { name: "wc", description: "Count", command: "wc", args: [{ value: "-w" }, { param: "file", description: "The file" }, { param: "n", description: "" }] },
      { name: "bare", description: "", command: "", args: [] },
    ]);
  });

  it("finds what the server would refuse, in order", () => {
    const ok = { name: "wc", description: "Count", command: "wc", args: [{ value: "-w" }, { param: "file", description: "" }] };
    expect(problemOf(ok, [])).toBeNull();
    expect(problemOf({ ...ok, name: "Wc" }, [])?.key).toBe("agents.tools.local.badName");
    expect(problemOf(ok, [ok])).toEqual({ key: "agents.tools.local.nameTaken", values: { name: "wc" } });
    expect(problemOf({ ...ok, description: " " }, [])?.key).toBe("agents.tools.local.needDescription");
    expect(problemOf({ ...ok, description: "d".repeat(1001) }, [])?.key).toBe("agents.tools.local.needDescription");
    expect(problemOf({ ...ok, command: " " }, [])?.key).toBe("agents.tools.local.needCommand");
    expect(problemOf({ ...ok, args: [{ param: "1x", description: "" }] }, [])?.key).toBe("agents.tools.local.badBlank");
    expect(problemOf({ ...ok, args: [{ param: "a", description: "" }, { param: "a", description: "" }] }, [])).toEqual({
      key: "agents.tools.local.blankTaken",
      values: { name: "a" },
    });
    expect(problemOf({ ...ok, args: [{ value: "" }] }, [])?.key).toBe("agents.tools.local.emptyArg");
  });

  it("trims what is saved, but never a fixed argument's text", () => {
    expect(cleaned({ name: " wc ", description: " Count ", command: " /bin/wc ", args: [{ value: " -w " }, { param: " f ", description: " x " }] })).toEqual({
      name: "wc",
      description: "Count",
      command: "/bin/wc",
      args: [{ value: " -w " }, { param: "f", description: "x" }],
    });
  });

  it("cuts a command line into its words, quotes keeping spaces together", () => {
    expect(splitCommand("open /Applications/Postman.app")).toEqual(["open", "/Applications/Postman.app"]);
    expect(splitCommand("  open  -a   'Google Chrome' \"a b\"c ''  ")).toEqual(["open", "-a", "Google Chrome", "a bc", ""]);
    expect(splitCommand("/usr/bin/wc")).toEqual(["/usr/bin/wc"]);
    expect(splitCommand("   ")).toEqual([]);
    expect(splitCommand("say 'unclosed quote")).toEqual(["say", "unclosed quote"]);
  });
});
