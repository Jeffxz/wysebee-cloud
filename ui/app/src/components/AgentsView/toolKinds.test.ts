import { describe, expect, it } from "vitest";
import { SITE_KINDS, type AgentType } from "../../api";
import { TYPES } from "../../../../test/agentTypes";
import { agentKind, listedMay, listing, mayAdd, switchesOf, toolKind, typeOf } from "./toolKinds";

const CHROME = { browser_link: "l1", agent_type_id: "t-chrome" };
const MAC = { mac_link: "m1", agent_type_id: "t-osx" };
const LINUX = { mac_link: "m1", agent_type_id: "t-linux" };
const PHONE = { android_link: "p1", agent_type_id: "t-android" };
// A kind of device to come, served by a pack: its own link, tool and switch.
const GLASSES: AgentType = {
  id: "t-glasses", key: "wysebee-glasses", name: "Wysebee Glasses Agent", description: "", enabled: true, kind: "glasses", link_field: "glasses_link",
  tool_kinds: ["camera"], settings: [{ field: "glasses_camera", label: "Camera", tool_kind: "camera", description: "Let Wysebee see what you see." }],
};

describe("toolKinds", () => {
  it("tags each tool with the kind of device whose types list it, and leaves the rest to any agent", () => {
    for (const key of ["browser", "devtools", ...SITE_KINDS]) expect(toolKind(key, TYPES)).toBe("browser");
    for (const key of ["local", "folder", "sqlite", "screen", "ios_toolkit"]) expect(toolKind(key, TYPES)).toBe("osx");
    expect(toolKind("android", TYPES)).toBe("android");
    for (const key of ["postgres", "snowflake", "sql", "unheard-of"]) expect(toolKind(key, TYPES)).toBe("any");
    expect(listing("screen", TYPES).map((t) => t.key)).toEqual(["wysebee-osx", "wysebee-windows"]);
  });

  it("reads an agent's type from the type its settings name, while it holds that type's link", () => {
    expect(typeOf(MAC, TYPES)?.key).toBe("wysebee-osx");
    expect(typeOf(PHONE, TYPES)?.kind).toBe("android");
    // Unpaired (its link gone), or naming a type whose link it does not hold: none.
    expect(typeOf({ agent_type_id: "t-osx" }, TYPES)).toBeNull();
    expect(typeOf({ browser_link: "l1", agent_type_id: "t-osx" }, TYPES)).toBeNull();
    expect(typeOf({ mac_link: 1, agent_type_id: "t-osx" }, TYPES)).toBeNull();
    // No type named: none, whatever link it holds or kind it was made for (as the server reads it).
    expect(typeOf({ mac_link: "m1", paired_kind: "wysebee-windows" }, TYPES)).toBeNull();
    expect(typeOf({ browser_link: "l1" }, TYPES)).toBeNull();
    expect(mayAdd({ mac_link: "m1" }, "local", TYPES)).toBe(false);
    expect([agentKind({}, TYPES), agentKind(CHROME, TYPES), agentKind(LINUX, TYPES)]).toEqual(["plain", "browser", "osx"]);
  });

  it("lets an agent add only the tools its type may have, and those of any — nothing before the types are read", () => {
    expect(mayAdd({}, "browser", TYPES)).toBe(false);
    expect(mayAdd({}, "local", TYPES)).toBe(false);
    expect(mayAdd({}, "postgres", TYPES)).toBe(true);
    expect(mayAdd(CHROME, "devtools", TYPES)).toBe(true);
    expect(mayAdd(CHROME, "local", TYPES)).toBe(false);
    expect(mayAdd(MAC, "local", TYPES) && mayAdd(MAC, "folder", TYPES) && mayAdd(MAC, "ios_toolkit", TYPES)).toBe(true);
    expect(mayAdd(MAC, "gmail", TYPES)).toBe(false);
    // As the rows say: a Linux machine has no screen, only a Mac the iPhone toolkit.
    expect([mayAdd(LINUX, "local", TYPES), mayAdd(LINUX, "screen", TYPES), mayAdd(LINUX, "ios_toolkit", TYPES)]).toEqual([true, false, false]);
    expect([mayAdd(PHONE, "android", TYPES), mayAdd(MAC, "android", TYPES)]).toEqual([true, false]);
    expect(mayAdd(MAC, "postgres", null)).toBe(false);
  });

  it("gives an agent its type's switches, a kind to come's too", () => {
    expect(switchesOf(LINUX, TYPES).map((s) => s.field)).toEqual(["run_any_program", "developer_access", "android_toolkit"]);
    expect(switchesOf(CHROME, TYPES).map((s) => s.field)).toEqual(["browser_access", "browser_devtools"]);
    expect([switchesOf({}, TYPES), switchesOf(MAC, null), switchesOf(PHONE, TYPES)]).toEqual([[], [], []]);
    const types = [...TYPES, GLASSES];
    const glasses = { glasses_link: "g1", agent_type_id: "t-glasses" };
    expect(switchesOf(glasses, types)).toEqual(GLASSES.settings);
    expect([mayAdd(glasses, "camera", types), mayAdd(MAC, "camera", types), toolKind("camera", types)]).toEqual([true, false, "glasses"]);
  });

  it("says which of the person's agents may be given a tool, by its paired device's type", () => {
    expect(listedMay({}, "postgres", TYPES)).toBe(true);
    expect(listedMay({}, "local", TYPES)).toBe(false);
    expect(listedMay({ device: "wysebee-linux" }, "local", TYPES)).toBe(true);
    expect(listedMay({ device: "wysebee-linux" }, "screen", TYPES)).toBe(false);
    expect(listedMay({ device: "wysebee-android" }, "android", TYPES)).toBe(true);
    expect([listedMay({ device: "wysebee-browser-chrome" }, "gmail", TYPES), listedMay({ device: "wysebee-browser-chrome" }, "local", TYPES), listedMay({ device: "wysebee-gone" }, "local", TYPES)]).toEqual([true, false, false]);
  });
});
