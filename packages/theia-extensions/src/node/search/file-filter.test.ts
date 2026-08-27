import { describe, expect, it } from "vitest";
import {
  ALWAYS_SKIP_DIRS,
  isSkippedExtension,
  isSkippedFile,
  isBinaryBuffer,
  createIgnoreFilter,
} from "./file-filter.js";

describe("ALWAYS_SKIP_DIRS", () => {
  it("includes the heavy build/VCS directories", () => {
    for (const dir of ["node_modules", ".git", ".spexr", "dist", "lib", "build", "out", ".turbo"]) {
      expect(ALWAYS_SKIP_DIRS.has(dir)).toBe(true);
    }
  });
  it("includes vendor trees and framework build/cache output", () => {
    for (const dir of ["vendor", "bower_components", "Pods", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".svelte-kit", ".astro", ".gradle", ".cache", "coverage"]) {
      expect(ALWAYS_SKIP_DIRS.has(dir)).toBe(true);
    }
  });
});

describe("isSkippedExtension", () => {
  it("skips known binary extensions", () => {
    expect(isSkippedExtension("a/b/logo.png")).toBe(true);
    expect(isSkippedExtension("x.WOFF2")).toBe(true);
  });
  it("keeps text/code files", () => {
    expect(isSkippedExtension("src/index.ts")).toBe(false);
    expect(isSkippedExtension("README.md")).toBe(false);
  });
  it("skips generated/derived text artifacts (diff, patch, snapshot, build cache, log)", () => {
    expect(isSkippedExtension("feature.diff")).toBe(true);
    expect(isSkippedExtension("0001-fix.patch")).toBe(true);
    expect(isSkippedExtension("Button.test.tsx.snap")).toBe(true);
    expect(isSkippedExtension("tsconfig.tsbuildinfo")).toBe(true);
    expect(isSkippedExtension("server.log")).toBe(true);
  });
  it("skips .gitignore (extension is 'gitignore')", () => {
    expect(isSkippedExtension(".gitignore")).toBe(true);
  });
  it("does not skip other dotfiles whose extension is indexable", () => {
    // .eslintrc.js → extension is "js", must remain indexable
    expect(isSkippedExtension(".eslintrc.js")).toBe(false);
  });
});

describe("isSkippedFile", () => {
  it("skips everything isSkippedExtension does", () => {
    expect(isSkippedFile("a/b/logo.png")).toBe(true);
    expect(isSkippedFile("feature.diff")).toBe(true);
  });
  it("skips minified bundles the extension check misses", () => {
    expect(isSkippedFile("assets/vendor.min.js")).toBe(true);
    expect(isSkippedFile("styles.min.css")).toBe(true);
    expect(isSkippedFile("dir/app.min.mjs")).toBe(true);
  });
  it("skips lockfiles identified by name, not extension", () => {
    expect(isSkippedFile("package-lock.json")).toBe(true);
    expect(isSkippedFile("frontend/pnpm-lock.yaml")).toBe(true);
    expect(isSkippedFile("bun.lockb")).toBe(true);
    expect(isSkippedFile("go.sum")).toBe(true);
    expect(isSkippedFile("yarn.lock")).toBe(true); // via the "lock" extension
  });
  it("keeps real source files, including ones that merely contain 'min'", () => {
    expect(isSkippedFile("src/index.ts")).toBe(false);
    expect(isSkippedFile("src/minify.ts")).toBe(false); // no ".min." segment
    expect(isSkippedFile("data/package.json")).toBe(false);
  });
});

describe("isBinaryBuffer", () => {
  it("detects a NUL byte as binary", () => {
    expect(isBinaryBuffer(Buffer.from([104, 105, 0, 121]))).toBe(true);
  });
  it("treats NUL-free content as text", () => {
    expect(isBinaryBuffer(Buffer.from("plain text"))).toBe(false);
  });
});

describe("createIgnoreFilter", () => {
  it("matches .gitignore patterns", () => {
    const ignored = createIgnoreFilter("dist/\n*.log\n");
    expect(ignored("dist/app.js")).toBe(true);
    expect(ignored("server.log")).toBe(true);
    expect(ignored("src/index.ts")).toBe(false);
  });
  it("never ignores when the gitignore is empty", () => {
    const ignored = createIgnoreFilter("");
    expect(ignored("anything.ts")).toBe(false);
  });
});
