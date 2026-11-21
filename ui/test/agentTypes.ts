import type { AgentType, AgentTypeSetting } from "../app/src/api";

/** A switch as Wysebee Cloud's packs describe it. */
const s = (field: string, label: string, tool_kind: string | null = null): AgentTypeSetting => ({ field, label, tool_kind, description: "" });
const ANY = s("run_any_program", "Run any program", "any_program");
const SCREEN = s("screen_control", "Screen control", "screen");
const DEV = s("developer_access", "Developer access", "developer");
const ANDROID = s("android_toolkit", "Android Development Toolkit", "android_toolkit");
const IOS = s("ios_toolkit", "iPhone Development Toolkit", "ios_toolkit");
const COMPUTER = ["local", "folder", "sqlite", "skill_scripts", "any_program", "developer", "android_toolkit"];

/** The seeded agent types as `GET /api/v1/agent-types` lists them (migrations 0050-0079 and the
 * packs' switches): enabled first, then by key. */
export const TYPES: AgentType[] = [
  { id: "t-android", key: "wysebee-android", name: "Wysebee Android Agent", description: "", enabled: true, kind: "android", link_field: "android_link", tool_kinds: ["android"], settings: [] },
  {
    id: "t-chrome", key: "wysebee-browser-chrome", name: "Wysebee Chrome Agent", description: "", enabled: true, kind: "browser", link_field: "browser_link",
    tool_kinds: ["browser", "devtools", "gmail", "calendar", "travel", "news", "website"], settings: [s("browser_access", "Browser access"), s("browser_devtools", "Web development tools", "devtools")],
  },
  { id: "t-linux", key: "wysebee-linux", name: "Wysebee Linux Agent", description: "", enabled: true, kind: "osx", link_field: "mac_link", tool_kinds: COMPUTER, settings: [ANY, DEV, ANDROID] },
  { id: "t-osx", key: "wysebee-osx", name: "Wysebee OSX Agent", description: "", enabled: true, kind: "osx", link_field: "mac_link", tool_kinds: [...COMPUTER, "screen", "ios_toolkit"], settings: [ANY, SCREEN, DEV, ANDROID, IOS] },
  { id: "t-windows", key: "wysebee-windows", name: "Wysebee Windows Agent", description: "", enabled: true, kind: "osx", link_field: "mac_link", tool_kinds: [...COMPUTER, "screen"], settings: [ANY, SCREEN, DEV, ANDROID] },
];
