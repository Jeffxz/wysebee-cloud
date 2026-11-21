/**
 * Ready-made "Run local program" tools for a Windows PC's agent (2026-11-16, the owner's
 * call): programs every Windows 10 and 11 has, in System32 on its PATH. The Tool library
 * offers each to an agent paired with Wysebee Agent for Windows (`wysebee-windows`); adding one
 * opens the program dialog filled in, so the person sees exactly what will run, and it runs
 * only once they allow it in Wysebee Agent on the PC — as any program tool.
 *
 * Each is a plain program with an argument list (Wysebee Agent for Windows starts `.exe` files
 * only, never a shell): the opening ones go through `explorer.exe`, which hands a folder or an
 * `ms-settings:` page to Windows and returns at once, so nothing waits on a window the
 * person keeps open. Pure, so it is tested on its own.
 */
import type { LocalProgram } from "./localPrograms";

/** The agent type of Wysebee Agent for Windows (wysebee-cloud migration 0051). */
export const WINDOWS_TYPE = "wysebee-windows";

export const WINDOWS_PROGRAMS: readonly LocalProgram[] = [
  {
    name: "system_info",
    description: "Show this Windows PC's system information: the Windows edition and version, when it last started, the processor, memory, BIOS, hotfixes and network adapters.",
    command: "systeminfo",
    args: [{ value: "/FO" }, { value: "LIST" }],
  },
  {
    name: "network_config",
    description: "Show this PC's network configuration: every adapter with its IP addresses, gateway, DNS servers and MAC address.",
    command: "ipconfig",
    args: [{ value: "/all" }],
  },
  {
    name: "running_programs",
    description: "List the programs running on this PC, with each one's process id and memory use.",
    command: "tasklist",
    args: [],
  },
  {
    name: "ping_host",
    description: "Check whether a computer or website answers over the network from this PC, and how fast (four pings).",
    command: "ping",
    args: [{ value: "-n" }, { value: "4" }, { param: "host", description: "The host name or IP address to ping, like example.com." }],
  },
  {
    name: "current_user",
    description: "Say which Windows account Wysebee Agent runs as on this PC (domain and user name).",
    command: "whoami",
    args: [],
  },
  {
    name: "open_folder",
    description: "Open a folder on this PC in File Explorer, for the person to see.",
    command: "explorer",
    args: [{ param: "folder", description: "The folder's full path, like C:\\Users\\Public\\Documents." }],
  },
  {
    name: "open_settings",
    description: "Open the Windows Settings app on this PC, for the person.",
    command: "explorer",
    args: [{ value: "ms-settings:" }],
  },
];

/** The agent type of Wysebee Agent for Linux (wysebee-cloud migration 0079, 2026-11-18). */
export const LINUX_TYPE = "wysebee-linux";

const pairedAs = (config: Record<string, unknown>, type: string) => config.paired_kind === type && typeof config.mac_link === "string" && config.mac_link !== "";

/** Whether an agent's settings say it is paired with Wysebee Agent for Windows. */
export function onWindows(config: Record<string, unknown>): boolean {
  return pairedAs(config, WINDOWS_TYPE);
}

/** Whether an agent's settings say it is paired with Wysebee Agent for Linux (no screen, no window). */
export function onLinux(config: Record<string, unknown>): boolean {
  return pairedAs(config, LINUX_TYPE);
}

/** Which computer an agent holding a computer's link works on: its link is held where a Mac's is. */
export function computerOf(config: Record<string, unknown>): "windows" | "linux" | "mac" {
  return onWindows(config) ? "windows" : onLinux(config) ? "linux" : "mac";
}

/** Programs only Windows has (by name, without `.exe`): its own tools and shells. Not `whoami`,
 * `ping` or `pwsh`, which a Mac and Linux have too. */
const WINDOWS_ONLY = new Set(["systeminfo", "tasklist", "taskkill", "ipconfig", "explorer", "powershell", "cmd", "wmic", "reg", "netsh", "msiexec", "getmac", "winget", "robocopy", "xcopy", "control", "notepad", "mstsc"]);

/** Whether a program (the person's "Run local program" tool) can run on that computer, by its
 * command (2026-11-18, the person's call: a Windows PC's programs are not offered to a Linux
 * machine's agent): one of Windows' own programs, an .exe, .bat, .cmd or .ps1, or a path with
 * a drive or backslashes is a Windows PC's; a path from / or ~/ is a Mac's or a Linux machine's.
 * Any other name (git, python3, whoami) may be on any computer's PATH. */
export function runsOn(program: { command: string }, computer: ReturnType<typeof computerOf>): boolean {
  const command = program.command.trim();
  const base = command.split(/[\\/]/).pop()!.toLowerCase();
  const windows = WINDOWS_ONLY.has(base.replace(/\.exe$/, "")) || /\.(exe|bat|cmd|ps1)$/.test(base) || /^[a-z]:[\\/]/i.test(command) || command.includes("\\");
  if (windows) return computer === "windows";
  if (command.startsWith("/") || command.startsWith("~/")) return computer !== "windows";
  return true;
}

/** The ready-made tools still to offer: those whose name none of the person's programs has. */
export function windowsProgramsToOffer(taken: readonly { name: string }[]): LocalProgram[] {
  return WINDOWS_PROGRAMS.filter((p) => !taken.some((t) => t.name === p.name));
}
