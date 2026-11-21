import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { StorageUsage, formatBytes, percentStored } from "./StorageUsage";

useFetchTransport();

const STORAGE = "GET /api/v1/account/storage";
const MB = 1024 * 1024;
const GB = 1024 * MB;
const stored = (used: number, parts = [{ kind: "assets", bytes: used, files: 1 }]) => ({ used, limit: GB, files: 1, parts });

describe("StorageUsage", () => {
  it("shows the storage as a bar towards the quota, with what each kind takes", async () => {
    mockFetch({
      [STORAGE]: stored(256 * MB, [
        { kind: "assets", bytes: 6 * MB, files: 2 },
        { kind: "skill_files", bytes: 250 * MB, files: 40 },
        { kind: "backups", bytes: 0, files: 0 },
        { kind: "something_new", bytes: 5, files: 1 },
      ]),
    });
    render(<StorageUsage />);
    expect(await screen.findByText("256 MB of 1 GB used")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Storage" });
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual([String(256 * MB), String(GB)]);
    expect((bar.firstChild as HTMLElement).style.width).toBe("25%");
    expect((bar.firstChild as HTMLElement).className).toContain("bg-primary-600");
    // Only the kinds that hold something, and that the page can name.
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Pictures: 6 MB", "Skill files: 250 MB"]);
    expect(screen.getByText(/files Wysebee Cloud keeps for you/)).toBeTruthy();
  });

  it("lists no kinds when nothing is stored", async () => {
    mockFetch({ [STORAGE]: { used: 0, limit: GB, files: 0 } });
    render(<StorageUsage />);
    expect(await screen.findByText("0 B of 1 GB used")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("turns amber near the quota and red at it, never past a full bar", async () => {
    mockFetch({ [STORAGE]: stored(900 * MB) });
    const { unmount } = render(<StorageUsage />);
    expect(((await screen.findByRole("progressbar")).firstChild as HTMLElement).className).toContain("bg-amber-500");
    unmount();
    mockFetch({ [STORAGE]: stored(3 * GB) });
    render(<StorageUsage />);
    const bar = await screen.findByRole("progressbar");
    expect((bar.firstChild as HTMLElement).className).toContain("bg-red-500");
    expect((bar.firstChild as HTMLElement).style.width).toBe("100%");
    expect(bar.getAttribute("aria-valuenow")).toBe(String(GB));
  });

  it("says why when it cannot be read, and reads again when the window comes back", async () => {
    mockFetch({ [STORAGE]: () => reply(502, { detail: "Could not reach Wysebee Cloud." }) });
    render(<StorageUsage />);
    expect(await screen.findByText(/Could not reach Wysebee Cloud\./)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    mockFetch({ [STORAGE]: stored(MB) });
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("1 MB of 1 GB used")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Could not reach/)).toBeNull());
  });

  it("writes sizes for people", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(15 * MB, "en")).toBe("15 MB");
    expect(formatBytes(1.25 * GB, "en")).toBe("1.3 GB");
    expect(formatBytes(1.5 * GB, "fr")).toBe("1,5 GB");
    expect(formatBytes(5000 * 1024 * GB, "en")).toBe("5,000 TB");
  });

  it("measures how full it is", () => {
    expect(percentStored({ used: 0, limit: GB })).toBe(0);
    expect(percentStored({ used: GB / 2, limit: GB })).toBe(50);
    expect(percentStored({ used: 2 * GB, limit: GB })).toBe(100);
    expect(percentStored({ used: 1, limit: 0 })).toBe(100);
  });
});
