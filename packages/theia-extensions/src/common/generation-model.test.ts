import { describe, expect, it } from "vitest";
import {
  coerceDtype,
  DEFAULT_GENERATION_MODEL,
  GEN_DTYPE_ENV,
  GEN_MODEL_ENV,
  resolveGenerationModel,
  sameGenerationModel,
} from "./generation-model.js";

describe("resolveGenerationModel", () => {
  it("falls back to the built-in model on an empty environment", () => {
    expect(resolveGenerationModel({})).toEqual(DEFAULT_GENERATION_MODEL);
  });

  it("reads an overridden id and dtype", () => {
    expect(
      resolveGenerationModel({
        [GEN_MODEL_ENV]: "onnx-community/Qwen3-1.7B-ONNX",
        [GEN_DTYPE_ENV]: "q4f16",
      }),
    ).toEqual({ id: "onnx-community/Qwen3-1.7B-ONNX", dtype: "q4f16" });
  });

  it("keeps the default dtype when only the id is overridden", () => {
    expect(resolveGenerationModel({ [GEN_MODEL_ENV]: "acme/tiny" })).toEqual({
      id: "acme/tiny",
      dtype: "q4",
    });
  });

  it("ignores a blank id rather than loading a nameless model", () => {
    expect(resolveGenerationModel({ [GEN_MODEL_ENV]: "   " })).toEqual(DEFAULT_GENERATION_MODEL);
  });

  it("degrades an unrecognised dtype to the default instead of passing it on", () => {
    expect(coerceDtype("q3_k_m")).toBe("q4");
    expect(coerceDtype(undefined)).toBe("q4");
  });
});

describe("sameGenerationModel", () => {
  it("compares both halves", () => {
    const base = { id: "acme/tiny", dtype: "q4" } as const;
    expect(sameGenerationModel(base, { ...base })).toBe(true);
    expect(sameGenerationModel(base, { ...base, dtype: "q8" })).toBe(false);
    expect(sameGenerationModel(base, { ...base, id: "acme/other" })).toBe(false);
  });
});
