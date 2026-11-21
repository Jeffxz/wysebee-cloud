import { describe, expect, it } from "vitest";
import { cleaned, problemOf } from "./localPrograms";
import { computerOf, onLinux, onWindows, runsOn, WINDOWS_PROGRAMS, windowsProgramsToOffer } from "./windowsPrograms";

describe("the ready-made Windows programs", () => {
  it("are each a program tool Wysebee Cloud takes, with names of their own", () => {
    expect(WINDOWS_PROGRAMS.map((p) => p.name)).toEqual(["system_info", "network_config", "running_programs", "ping_host", "current_user", "open_folder", "open_settings"]);
    for (const p of WINDOWS_PROGRAMS) {
      expect(problemOf(cleaned(p), []), p.name).toBeNull();
      // A bare program System32 has: never a shell, never a batch file.
      expect(p.command, p.name).toMatch(/^[a-z]+$/);
      expect(["cmd", "powershell", "pwsh"]).not.toContain(p.command);
    }
  });

  it("are offered to an agent paired with Wysebee Agent for Windows only", () => {
    expect(onWindows({ mac_link: "m1", paired_kind: "wysebee-windows" })).toBe(true);
    expect(onWindows({ mac_link: "m1", paired_kind: "wysebee-osx" })).toBe(false);
    expect(onWindows({ mac_link: "", paired_kind: "wysebee-windows" })).toBe(false);
    expect(onWindows({ paired_kind: "wysebee-windows" })).toBe(false);
    expect(onWindows({ mac_link: "m1", paired_kind: "wysebee-linux" })).toBe(false);
  });

  it("say which computer can run a program, by its command", () => {
    for (const command of ["systeminfo", "explorer", "tasklist", "powershell", "SYSTEMINFO.EXE", "C:\\Tools\\x.exe", "build.bat", "run.ps1", "tools\\x"]) {
      expect([runsOn({ command }, "windows"), runsOn({ command }, "linux"), runsOn({ command }, "mac")], command).toEqual([true, false, false]);
    }
    for (const command of ["/usr/bin/say", "~/bin/backup.sh"]) {
      expect([runsOn({ command }, "windows"), runsOn({ command }, "linux"), runsOn({ command }, "mac")], command).toEqual([false, true, true]);
    }
    // A name any computer may have on its PATH.
    for (const command of ["git", "python3", "whoami", "ping", "pwsh", ""]) {
      expect([runsOn({ command }, "windows"), runsOn({ command }, "linux"), runsOn({ command }, "mac")], command).toEqual([true, true, true]);
    }
    // Every ready-made Windows tool but whoami and ping is Windows' own.
    expect(WINDOWS_PROGRAMS.filter((p) => runsOn(p, "linux")).map((p) => p.command)).toEqual(["ping", "whoami"]);
  });

  it("tell a Linux machine's agent (2026-11-18) from a Windows PC's and a Mac's", () => {
    expect(onLinux({ mac_link: "m1", paired_kind: "wysebee-linux" })).toBe(true);
    expect(onLinux({ mac_link: "", paired_kind: "wysebee-linux" })).toBe(false);
    expect(computerOf({ mac_link: "m1", paired_kind: "wysebee-linux" })).toBe("linux");
    expect(computerOf({ mac_link: "m1", paired_kind: "wysebee-windows" })).toBe("windows");
    expect(computerOf({ mac_link: "m1", paired_kind: "wysebee-osx" })).toBe("mac");
  });

  it("leave out one whose name the person's programs already have", () => {
    const left = windowsProgramsToOffer([{ name: "system_info" }, { name: "say" }]).map((p) => p.name);
    expect(left).not.toContain("system_info");
    expect(left).toHaveLength(WINDOWS_PROGRAMS.length - 1);
  });
});
