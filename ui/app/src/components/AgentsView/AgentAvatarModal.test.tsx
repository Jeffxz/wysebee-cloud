import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";

const downscale = vi.hoisted(() => vi.fn());
vi.mock("./avatarImage", () => ({ downscaleImageToDataUrl: downscale }));
const png = vi.hoisted(() => vi.fn());
vi.mock("./avatarGenerate", async (real) => ({ ...(await real<typeof import("./avatarGenerate")>()), avatarPng: png }));

import { AgentAvatarModal } from "./AgentAvatarModal";

function setup(avatar = "🤖", onApply = vi.fn(async () => {})) {
  const onClose = vi.fn();
  const utils = render(<AgentAvatarModal avatar={avatar} label="Bee" onApply={onApply} onClose={onClose} />);
  return { onApply, onClose, ...utils };
}

describe("AgentAvatarModal", () => {
  it("applies a grid emoji and closes", async () => {
    const { onApply, onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: /🧠/ }));
    expect(onApply).toHaveBeenCalledWith("🧠");
    expect(onClose).toHaveBeenCalled();
  });

  it("applies typed text by Enter or Use, and ignores blank Enter", async () => {
    const { onApply } = setup("");
    const input = screen.getByRole("textbox");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /default/i })).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "a" });
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.type(input, " 🦄 ");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("🦄"));
  });

  it("applies typed text with Use", async () => {
    const { onApply } = setup("⭐");
    await userEvent.click(screen.getByRole("button", { name: /^use$/i }));
    expect(onApply).toHaveBeenCalledWith("⭐");
  });

  it("starts empty for an image avatar and can reset to default", async () => {
    const { onApply } = setup("data:image/png;base64,AA");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: /default/i }));
    expect(onApply).toHaveBeenCalledWith("");
  });

  it("stays open with the error when applying fails", async () => {
    const fail = vi
      .fn<(n: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce("plain");
    const { onClose } = setup("🤖", fail);
    await userEvent.click(screen.getByRole("button", { name: /🧠/ }));
    await screen.findByText("nope");
    await userEvent.click(screen.getByRole("button", { name: /🧠/ }));
    await screen.findByText("plain");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the backdrop unless busy, never from the panel", async () => {
    let finish!: () => void;
    const pending = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { onClose } = setup("🤖", pending);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(screen.getByText(/choose an avatar|avatar/i, { selector: "h3" }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /🧠/ }));
    expect(screen.getByText(/saving/i)).toBeTruthy();
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes from the backdrop and Cancel when idle", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("dialog"));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uploads a picked image, reporting a failed read", async () => {
    const { onApply, container } = setup();
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(file, "click");
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(file, { target: { files: [] } });
    downscale.mockRejectedValueOnce(new Error("bad image")).mockRejectedValueOnce("x").mockResolvedValueOnce("data:ok");
    const png = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(file, { target: { files: [png] } });
    await screen.findByText("bad image");
    fireEvent.change(file, { target: { files: [png] } });
    await screen.findByText(/process/i);
    fireEvent.change(file, { target: { files: [png] } });
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("data:ok"));
  });

  it("offers generated avatars in each style, a new batch on Shuffle, saved as a picture", async () => {
    png.mockResolvedValueOnce("data:image/png;base64,AA");
    const { onApply, onClose } = setup();
    const first = await screen.findByRole("button", { name: "Use generated avatar 1" });
    const before = first.querySelector("img")!.getAttribute("src");
    await userEvent.click(screen.getByRole("button", { name: "Pixel art" }));
    expect(screen.getByRole("button", { name: "Pixel art" }).getAttribute("aria-pressed")).toBe("true");
    const pixel = screen.getByRole("button", { name: "Use generated avatar 1" }).querySelector("img")!.getAttribute("src");
    expect(pixel).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(screen.getByRole("button", { name: "Use generated avatar 1" }).querySelector("img")!.getAttribute("src")).not.toBe(pixel);
    await userEvent.click(screen.getByRole("button", { name: "Use generated avatar 3" }));
    expect(png).toHaveBeenLastCalledWith("pixelArt", expect.any(String));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("data:image/png;base64,AA"));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when a generated avatar could not be made, Error or not", async () => {
    const { onApply } = setup();
    png.mockRejectedValueOnce(new Error("no canvas"));
    await userEvent.click(await screen.findByRole("button", { name: "Use generated avatar 1" }));
    expect(await screen.findByText("no canvas")).toBeTruthy();
    png.mockRejectedValueOnce("odd");
    await userEvent.click(screen.getByRole("button", { name: "Use generated avatar 2" }));
    expect(await screen.findByText(/could not|couldn't/i)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("closed before the generator is read, nothing happens", () => {
    const { unmount } = setup();
    unmount();
  });

});
