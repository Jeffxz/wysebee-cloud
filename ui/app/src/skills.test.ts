import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, reply, type FakeRequest } from "../../test/fetch";
import { useFetchTransport } from "../../test/transport";
import { downloadSkillFile } from "./api";
import { addFolder, addSkill, loadSkill, loadSkills, removeFile, removeFolder, removeSkill, renameSkill, resetSkills, treeOf, upload, useSkills, writeFile } from "./skills";

// Uploads and downloads go straight to Wysebee Cloud, signed (cloud/data.ts).
vi.mock("./cloud/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("./cloud/auth")>()), accessToken: async () => "tok", reauthenticate: async () => {} }));

const skill = (id: string, name: string, files: { path: string; id?: string; size: number }[] = [{ path: "SKILL.md", id: "f1", size: 9 }], folders: string[] = []) => ({
  id,
  name,
  description: `${name}.`,
  files,
  folders,
  updated_at: null,
});

beforeEach(() => resetSkills());
useFetchTransport();

describe("the skills store", () => {
  it("reads the skills by name, starts, renames and deletes them", async () => {
    const f = mockFetch({
      "GET /api/v1/skills": { skills: [skill("s1", "zeta"), skill("s2", "alpha")] },
      "POST /api/v1/skills": (r: FakeRequest) => reply(201, skill("s3", (r.body as { name: string }).name)),
      "PUT /api/v1/skills/s1": (r: FakeRequest) => skill("s1", (r.body as { name: string }).name),
      "GET /api/v1/skills/s2": skill("s2", "alpha", [{ path: "SKILL.md", size: 9 }, { path: "run.py", size: 3 }]),
      "DELETE /api/v1/skills/s2": reply(204),
    });
    const { result } = renderHook(() => useSkills());
    await act(() => Promise.all([loadSkills(), loadSkills()]));
    expect(f.to("GET /api/v1/skills")).toHaveLength(1);
    expect(result.current.items?.map((s) => s.name)).toEqual(["alpha", "zeta"]);
    await act(async () => void (await addSkill("beta")));
    expect(result.current.items?.map((s) => s.name)).toEqual(["alpha", "beta", "zeta"]);
    await act(async () => void (await renameSkill("s1", "gamma")));
    expect(result.current.items?.map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
    await act(async () => void (await loadSkill("s2")));
    expect(result.current.items?.find((s) => s.id === "s2")?.files).toHaveLength(2);
    await act(() => removeSkill("s2"));
    expect(result.current.items?.map((s) => s.id)).toEqual(["s3", "s1"]);
  });

  it("writes, uploads and deletes files and folders, keeping each skill as the cloud answers it", async () => {
    const after = skill("s1", "notes", [{ path: "SKILL.md", size: 9 }, { path: "scripts/a.py", size: 1 }], ["empty"]);
    const f = mockFetch({
      "PUT /api/v1/skills/s1/files/scripts/a.py": after,
      "PUT /api/v1/skills/s1/files/scripts/b%20c.bin": after,
      "PUT /api/v1/skills/s1/files/top.txt": after,
      "POST /api/v1/skills/s1/folders/empty": after,
      "DELETE /api/v1/skills/s1/files/scripts/a.py": reply(204),
      "DELETE /api/v1/skills/s1/folders/empty": reply(204),
      "GET /api/v1/skills/s1": skill("s1", "notes"),
      "DELETE /api/v1/skills/gone": reply(204),
    });
    const { result } = renderHook(() => useSkills());
    // A delete before the list was read leaves it empty.
    await act(() => removeSkill("gone"));
    expect(result.current.items).toEqual([]);
    resetSkills();
    // A change before the list was read starts it.
    await act(async () => void (await writeFile("s1", "scripts/a.py", "x")));
    expect(f.to("PUT /api/v1/skills/s1/files/scripts/a.py")[0].body).toEqual({ content: "x" });
    expect(treeOf(result.current.items![0])).toEqual({ files: after.files, folders: ["empty"] });
    await act(async () => void (await addFolder("s1", "empty")));
    // Files from the computer: each sent as it is, one after another.
    const files = [new File(["\x00\x01"], "b c.bin"), new File(["t"], "top.txt")];
    let last: unknown;
    await act(async () => {
      last = await upload("s1", "scripts", [files[0]]);
      await upload("s1", "", [files[1]]);
    });
    expect(last).toEqual(after);
    const sent = f.fn.mock.calls.find(([url]) => String(url).endsWith("b%20c.bin"))![1] as RequestInit;
    expect(sent.body).toBe(files[0]);
    expect((sent.headers as Record<string, string>)["Content-Type"]).toBe("application/octet-stream");
    expect(await upload("s1", "", [])).toBeNull();
    await act(() => removeFile("s1", "scripts/a.py"));
    await act(() => removeFolder("s1", "empty"));
    expect(result.current.items![0].files).toEqual([{ path: "SKILL.md", id: "f1", size: 9 }]);
    expect(treeOf({ ...result.current.items![0], folders: undefined })).toMatchObject({ folders: [] });
  });

  it("says why a read or an upload failed, and downloads a stored file", async () => {
    mockFetch({
      "GET /api/v1/skills": reply(503, { detail: "Could not reach Wysebee Cloud." }),
      "PUT /api/v1/skills/s1/files/big.bin": reply(413, { detail: "A skill file is at most 5242880 bytes." }),
      "GET /api/v1/skill-files/abc": () => new Response("bytes"),
      "GET /api/v1/skill-files/gone": reply(404, { detail: "Skill file not found." }),
    });
    const { result } = renderHook(() => useSkills());
    await act(() => loadSkills());
    expect(result.current.error).toBe("Could not reach Wysebee Cloud.");
    await expect(upload("s1", "", [new File(["x"], "big.bin")])).rejects.toThrow("A skill file is at most 5242880 bytes.");
    expect((await downloadSkillFile("abc")).size).toBe(5);
    await expect(downloadSkillFile("gone")).rejects.toThrow("Skill file not found.");
  });

  it("passes on what is not a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(upload("s1", "", [new File(["x"], "a.txt")])).rejects.toThrow("offline");
    await expect(downloadSkillFile("abc")).rejects.toThrow("offline");
  });
});
