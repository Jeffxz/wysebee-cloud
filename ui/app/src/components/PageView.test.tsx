import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import * as api from "../api";
import { applyTheme } from "../theme";
import { DocumentPage, PageFrame, PageView } from "./PageView";

const PAGE: api.WorkspacePage = { id: "pg1", workspace_id: "w 1", workspace_name: "Docs", source_path: "guide/plan.md", title: "The plan", view_url: "/api/v1/page-view/pg1/k1", updated_at: "" };

beforeEach(() => {
  vi.restoreAllMocks();
  applyTheme("dark");
});

describe("a page the AI app made", () => {
  it("is shown sandboxed from its own address, with no origin of its own", () => {
    render(<PageFrame src="/api/v1/page-view/p/k" title="X" />);
    const frame = screen.getByTitle("X");
    // Its scripts run, but never with Wysebee's origin.
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    // In Wysebee's look.
    expect(frame.getAttribute("src")).toBe("/api/v1/page-view/p/k?theme=dark");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("is told when the look changes, and when it loads, without reloading", () => {
    const { rerender } = render(<PageFrame src="/api/v1/page-view/p/k?x=1" title="X" />);
    const frame = screen.getByTitle("X") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("/api/v1/page-view/p/k?x=1&theme=dark");
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    act(() => applyTheme("light"));
    expect(post).toHaveBeenLastCalledWith({ wysebeeTheme: "light" }, "*");
    expect(frame.getAttribute("src")).toBe("/api/v1/page-view/p/k?x=1&theme=dark");
    fireEvent.load(frame);
    expect(post).toHaveBeenCalledTimes(2);
    // A new page: asked for in the look of now.
    rerender(<PageFrame src="/api/v1/page-view/p/k2" title="X" />);
    expect(frame.getAttribute("src")).toBe("/api/v1/page-view/p/k2?theme=light");
  });

  it("shows the document's page in the editor, or how to get one, read again with Refresh", async () => {
    const doc = vi.spyOn(api, "fetchDocumentPage").mockResolvedValueOnce({ page: null }).mockResolvedValue({ page: { id: "pg1", title: "", updated_at: "" } });
    vi.spyOn(api, "fetchPage").mockResolvedValue({ ...PAGE, title: "" });
    render(<DocumentPage workspaceId="w 1" path="guide/plan.md" />);
    expect(screen.getByText("Loading the page…")).toBeTruthy();
    expect(await screen.findByText("No page for this document yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    // Untitled: named by its document.
    const frame = await screen.findByTitle("guide/plan.md");
    expect(frame.getAttribute("src")).toBe("/api/v1/page-view/pg1/k1?theme=dark");
    const open = screen.getByRole("link", { name: "Open on its own" });
    // In a new tab, the page alone.
    expect(open.getAttribute("href")).toBe("#/pages/pg1");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(doc).toHaveBeenCalledWith("w 1", "guide/plan.md");
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(doc).toHaveBeenCalledTimes(3));
  });

  it("says why the document's page could not be read", async () => {
    vi.spyOn(api, "fetchDocumentPage").mockRejectedValue(new Error("HTTP 503: Wysebee Cloud is busy."));
    render(<DocumentPage workspaceId="w" path="a.md" />);
    expect(await screen.findByText("Wysebee Cloud is busy.")).toBeTruthy();
  });

  it("opens at its own address alone, filling the window, named by its title", async () => {
    vi.spyOn(api, "fetchPage").mockResolvedValue(PAGE);
    document.title = "Wysebee";
    const { unmount } = render(<PageView pageId="pg1" />);
    expect(screen.getByText("Loading the page…")).toBeTruthy();
    const frame = await screen.findByTitle("The plan");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toBe("/api/v1/page-view/pg1/k1?theme=dark");
    // None of Wysebee's own UI but the look's switch: no heading, no link back, no note.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Shown sandboxed/)).toBeNull();
    expect(document.title).toBe("The plan");
    const save = vi.spyOn(api, "saveAppearance").mockResolvedValueOnce({ theme: "light" }).mockRejectedValueOnce(new Error("offline"));
    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(save).toHaveBeenLastCalledWith("light");
    const error = vi.spyOn(toast, "error");
    await userEvent.click(toggle);
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("offline")));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    unmount();
    expect(document.title).toBe("Wysebee");
    // Untitled: its document's path.
    vi.mocked(api.fetchPage).mockResolvedValue({ ...PAGE, title: "" });
    render(<PageView pageId="pg1" />);
    expect(await screen.findByTitle("guide/plan.md")).toBeTruthy();
  });

  it("says why it could not be read, and ignores an answer that comes too late", async () => {
    vi.spyOn(api, "fetchPage").mockRejectedValue(new Error("HTTP 404: There is no such page."));
    const { unmount } = render(<PageView pageId="nope" />);
    expect(await screen.findByText("There is no such page.")).toBeTruthy();
    unmount();
    let answer: (p: api.WorkspacePage) => void = () => {};
    let refuse: (e: Error) => void = () => {};
    vi.mocked(api.fetchPage).mockReturnValueOnce(new Promise((ok) => (answer = ok))).mockReturnValueOnce(new Promise((_, no) => (refuse = no)));
    const late = render(<PageView pageId="a" />);
    late.unmount();
    answer(PAGE);
    const later = render(<PageView pageId="b" />);
    later.unmount();
    refuse(new Error("gone"));
    await new Promise((r) => setTimeout(r, 0));
  });

  it("is shared with anyone with the link, and no longer, from the editor's Page view", async () => {
    vi.spyOn(api, "fetchDocumentPage").mockResolvedValue({ page: { id: "pg1", title: "", updated_at: "" } });
    vi.spyOn(api, "fetchPage").mockResolvedValue({ ...PAGE, share: null });
    const SHARE: api.PageShare = { audience: "public", url: "https://wysebee.io/s/abc", shared_at: "" };
    const share = vi.spyOn(api, "sharePage").mockRejectedValueOnce(new Error("HTTP 503: Wysebee Cloud is busy.")).mockResolvedValue(SHARE);
    const unshare = vi.spyOn(api, "unsharePage").mockResolvedValue();
    render(<DocumentPage workspaceId="w" path="guide/plan.md" />);
    await userEvent.click(await screen.findByRole("button", { name: "Share" }));
    const dialog = screen.getByRole("dialog", { name: "Share page" });
    const only = screen.getByRole("radio", { name: /Only you/ }) as HTMLInputElement;
    const anyone = screen.getByRole("radio", { name: /Anyone with the link/ }) as HTMLInputElement;
    expect(only.checked).toBe(true);
    // Refused: said, and still private.
    await userEvent.click(anyone);
    expect(await screen.findByText("Wysebee Cloud is busy.")).toBeTruthy();
    expect(only.checked).toBe(true);
    // Shared: its link, to copy and open.
    await userEvent.click(anyone);
    await waitFor(() => expect(anyone.checked).toBe(true));
    expect(share).toHaveBeenLastCalledWith("pg1", "public");
    expect(screen.queryByText("Wysebee Cloud is busy.")).toBeNull();
    expect(dialog.textContent).toContain("https://wysebee.io/s/abc");
    const open = screen.getByRole("link", { name: "Open link" });
    expect(open.getAttribute("href")).toBe("https://wysebee.io/s/abc");
    expect(open.getAttribute("target")).toBe("_blank");
    // Closed: the toolbar says it is public.
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Public" }));
    // No longer shared: no link.
    await userEvent.click(screen.getByRole("radio", { name: /Only you/ }));
    await waitFor(() => expect(unshare).toHaveBeenCalledWith("pg1"));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Open link" })).toBeNull());
    // Escape closes it.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("says why the person may not share publicly, links to Billing, and still lets a page shared before go private", async () => {
    vi.spyOn(api, "fetchDocumentPage").mockResolvedValue({ page: { id: "pg1", title: "", updated_at: "" } });
    const refusal = { detail: "Sharing a page publicly needs the Starter or Pro plan.", code: "plan_feature", billing_url: "/app/#/account/billing" };
    vi.spyOn(api, "fetchPage").mockResolvedValue({ ...PAGE, share: null, share_refusal: refusal });
    const share = vi.spyOn(api, "sharePage");
    const first = render(<DocumentPage workspaceId="w" path="guide/plan.md" />);
    await userEvent.click(await screen.findByRole("button", { name: "Share" }));
    expect(screen.getByText(/Sharing a page publicly needs the Starter or Pro plan\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("#/account/billing");
    const anyone = screen.getByRole("radio", { name: /Anyone with the link/ }) as HTMLInputElement;
    expect(anyone.disabled).toBe(true);
    await userEvent.click(anyone);
    expect(share).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("link", { name: "See plans" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    // Shared before (their plan since changed): shown as shared, and Only you still works.
    vi.mocked(api.fetchPage).mockResolvedValue({ ...PAGE, share: { audience: "public", url: "https://wysebee.io/s/abc", shared_at: "" }, share_refusal: refusal });
    const unshare = vi.spyOn(api, "unsharePage").mockResolvedValue();
    render(<DocumentPage workspaceId="w" path="guide/plan.md" />);
    await userEvent.click(await screen.findByRole("button", { name: "Public" }));
    expect((screen.getByRole("radio", { name: /Anyone with the link/ }) as HTMLInputElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole("radio", { name: /Only you/ }));
    await waitFor(() => expect(unshare).toHaveBeenCalledWith("pg1"));
  });
});
