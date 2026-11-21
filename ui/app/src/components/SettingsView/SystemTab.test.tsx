import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";

const telemetry = vi.hoisted(() => ({ setTelemetryEnabled: vi.fn() }));
vi.mock("../../telemetry", () => telemetry);

import { SystemTab } from "./SystemTab";

useFetchTransport();

describe("Settings → System on the web", () => {
  it("turns usage analytics off and on, at once in this page too", async () => {
    const api = mockFetch({
      "GET /api/v1/system/settings": { telemetry_enabled: true },
      "PUT /api/v1/system/settings": (r: { body: unknown }) => r.body,
    });
    render(<SystemTab />);
    const box = (await screen.findByRole("checkbox", { name: /Send usage analytics/ })) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    expect(screen.getByText(/never what you type/)).toBeTruthy();
    await userEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
    expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({ telemetry_enabled: false });
    expect(telemetry.setTelemetryEnabled).toHaveBeenLastCalledWith(false);
    await userEvent.click(box);
    await waitFor(() => expect(telemetry.setTelemetryEnabled).toHaveBeenLastCalledWith(true));
  });

  it("says why it could not be read or saved", async () => {
    const api = mockFetch({ "GET /api/v1/system/settings": reply(500, { detail: "down" }) });
    const { unmount } = render(<SystemTab />);
    expect(await screen.findByText(/down/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    unmount();
    api.set("GET /api/v1/system/settings", { telemetry_enabled: false });
    api.set("PUT /api/v1/system/settings", reply(500, { detail: "refused" }));
    render(<SystemTab />);
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    await userEvent.click(box);
    expect(await screen.findByText(/refused/)).toBeTruthy();
    expect(box.checked).toBe(false);
  });
});
