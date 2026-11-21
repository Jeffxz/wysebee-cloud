import { describe, expect, it } from "vitest";
import { parseObject, str } from "./values";

describe("values", () => {
  it("reads an object as such and anything else as nothing", () => {
    expect(parseObject({ a: 1 })).toEqual({ a: 1 });
    for (const other of [null, undefined, [1], "text", 3]) expect(parseObject(other)).toEqual({});
    expect([str("x"), str(1)]).toEqual(["x", ""]);
  });
});
