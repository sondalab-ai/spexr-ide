import { describe, expect, it } from "vitest";
import { buildPrompt, buildSymbolSummary, cleanGenerated, DESCRIPTION_SYSTEM_PROMPT, cleanSummaryLine, NOW_SYSTEM_PROMPT, OVERVIEW_SYSTEM_PROMPT, buildOverviewPrompt, buildNowPrompt } from "./description-format.js";

describe("cleanGenerated", () => {
  it("keeps only the first non-empty line", () => {
    expect(cleanGenerated("Handles auth.\nExtra.")).toBe("Handles auth.");
    expect(cleanGenerated("\n\n  Does X.  \nmore")).toBe("Does X.");
  });
  it("trims surrounding whitespace and quotes", () => {
    expect(cleanGenerated('  "Does X."  ')).toBe("Does X.");
  });
  it("strips 'This file' prefix and re-capitalizes", () => {
    expect(cleanGenerated("This file handles authentication.")).toBe("Handles authentication.");
    expect(cleanGenerated("This file manages user sessions.")).toBe("Manages user sessions.");
    expect(cleanGenerated("this file exports utility functions.")).toBe("Exports utility functions.");
  });
  it("strips bare 'This' prefix and re-capitalizes", () => {
    expect(cleanGenerated("This defines the workspace indexer.")).toBe("Defines the workspace indexer.");
  });
  it("does not mangle sentences that start with 'This' but are not prefixes", () => {
    // "This" as subject of a meaningful sentence that can't be stripped cleanly
    // (currently we strip — acceptable trade-off, tested for awareness)
    expect(cleanGenerated("This is a utility module.")).toBe("Is a utility module.");
  });
  it("does not truncate or append an ellipsis (model output is length-bounded)", () => {
    const long = "word ".repeat(40).trim();
    const out = cleanGenerated(long);
    expect(out).toBe(long);
    expect(out).not.toContain("…");
  });
});

describe("buildSymbolSummary", () => {
  describe("code files", () => {
    it("extracts exported top-level names (JS/TS)", () => {
      const s = buildSymbolSummary("src/a.ts", "export const TOKEN = 'x';\nexport function foo() {}");
      expect(s).toContain("TOKEN");
      expect(s).toContain("foo");
    });

    it("extracts non-exported class and methods (TS bare methods)", () => {
      const s = buildSymbolSummary("src/b.ts", "class AuthService {\n  login() {}\n  private helper() {}\n}");
      expect(s).toContain("AuthService");
      expect(s).toContain("login");
      expect(s).toContain("helper");
    });

    it("extracts Python def declarations", () => {
      const s = buildSymbolSummary("auth.py", "class Manager:\n    def login(self):\n        pass\n    def logout(self):\n        pass");
      expect(s).toContain("Manager");
      expect(s).toContain("login");
      expect(s).toContain("logout");
    });

    it("extracts Go func and type declarations", () => {
      const s = buildSymbolSummary("service.go", "type UserService struct{}\nfunc (s *UserService) FindById(id int) {}\nfunc NewService() *UserService {}");
      expect(s).toContain("UserService");
      expect(s).toContain("FindById");
      expect(s).toContain("NewService");
    });

    it("extracts Rust fn and struct", () => {
      const s = buildSymbolSummary("lib.rs", "pub struct AuthManager;\nimpl AuthManager {\n    pub fn login(&self) {}\n    fn internal(&self) {}\n}");
      expect(s).toContain("AuthManager");
      expect(s).toContain("login");
      expect(s).toContain("internal");
    });

    it("extracts Java-style methods with modifiers and return type", () => {
      const s = buildSymbolSummary("Service.java", "public class UserService {\n    public String findById(Long id) {}\n    private void delete(Long id) {}\n}");
      expect(s).toContain("UserService");
      expect(s).toContain("findById");
      expect(s).toContain("delete");
    });

    it("includes file header comment", () => {
      const s = buildSymbolSummary("src/b.ts", "// Handles auth flows.\nexport class AuthService {}");
      expect(s).toContain("Handles auth flows");
      expect(s).toContain("AuthService");
    });

    it("skips noise comments (license/eslint)", () => {
      const s = buildSymbolSummary("src/c.ts", "// eslint-disable\nexport function go() {}");
      expect(s).not.toContain("eslint");
      expect(s).toContain("go");
    });

    it("returns empty string when no symbols and no comment", () => {
      expect(buildSymbolSummary("src/d.ts", "const x = 1;")).toBe("");
    });
  });

  describe("prose/config files fall back to raw content", () => {
    it("sends raw content for markdown", () => {
      const s = buildSymbolSummary("README.md", "# My Project\n\nHandles authentication.");
      expect(s).toContain("Content:");
      expect(s).toContain("# My Project");
    });

    it("sends raw content for YAML", () => {
      const s = buildSymbolSummary("config.yml", "name: my-service\nversion: 1.0");
      expect(s).toContain("Content:");
      expect(s).toContain("name: my-service");
    });

    it("sends raw content for CSS", () => {
      const s = buildSymbolSummary("styles.css", ".btn { color: red; }");
      expect(s).toContain("Content:");
    });
  });
});

describe("buildPrompt", () => {
  it("includes the path and extracted symbol names", () => {
    const p = buildPrompt("src/a.ts", "export const x = 1;\nexport function foo() {}");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("foo");
    expect(p).toContain("one short sentence");
  });
});

describe("DESCRIPTION_SYSTEM_PROMPT", () => {
  it("instructs the model not to invent technologies and to use only the input", () => {
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/only/i);
    expect(DESCRIPTION_SYSTEM_PROMPT).toMatch(/never name or assume any technology/i);
  });
});

describe("summary system prompts", () => {
  it("carry no concrete example clause the small model could echo verbatim", () => {
    expect(OVERVIEW_SYSTEM_PROMPT).not.toMatch(/auth middleware|token expiry/i);
    expect(NOW_SYSTEM_PROMPT).not.toMatch(/auth middleware|token expiry/i);
  });

  it("each ask for ONE third-person line (the paired ask came back merged or echoing tool payloads)", () => {
    for (const p of [OVERVIEW_SYSTEM_PROMPT, NOW_SYSTEM_PROMPT]) {
      expect(p).toMatch(/one line/i);
      expect(p).toMatch(/third person/i);
      expect(p).not.toMatch(/two lines/i);
    }
  });

  it("overview targets the whole session; now targets the current task", () => {
    expect(OVERVIEW_SYSTEM_PROMPT).toMatch(/accomplishing/i);
    expect(NOW_SYSTEM_PROMPT).toMatch(/right now/i);
  });
});

describe("buildOverviewPrompt / buildNowPrompt", () => {
  it("overview carries the goal and, when present, recent progress", () => {
    const p = buildOverviewPrompt("add OAuth to the API", "inspecting the redirect handler");
    expect(p).toContain("add OAuth to the API");
    expect(p).toContain("inspecting the redirect handler");
  });

  it("overview omits the progress block when progress is empty", () => {
    expect(buildOverviewPrompt("add OAuth to the API", "   ")).not.toMatch(/recent progress/i);
  });

  it("now carries only the recent activity", () => {
    expect(buildNowPrompt("running the login tests")).toContain("running the login tests");
  });
});

describe("cleanSummaryLine", () => {
  it("strips punctuation and capitalizes a plain line", () => {
    expect(cleanSummaryLine("adding OAuth support to the API.")).toBe("Adding OAuth support to the API");
  });

  it("strips a stray Now:/Overview: label the model may prepend", () => {
    expect(cleanSummaryLine("Now: editing the auth module")).toBe("Editing the auth module");
    expect(cleanSummaryLine("**Overview:** fixing the session tiles")).toBe("Fixing the session tiles");
  });

  it("takes the first non-empty line when the model adds extra lines", () => {
    expect(cleanSummaryLine("\nrefactoring the wall widget\ntrailing noise")).toBe("Refactoring the wall widget");
  });

  it("strips a leading 'The'/'This' the model may add", () => {
    expect(cleanSummaryLine("The agent edits the parser")).toBe("Agent edits the parser");
  });

  it("strips first/second-person subjects so the clause reads third-person", () => {
    expect(cleanSummaryLine("I'm fixing the login bug")).toBe("Fixing the login bug");
    expect(cleanSummaryLine("we are running the migration")).toBe("Running the migration");
  });

  it("returns empty for a label-only or empty reply", () => {
    expect(cleanSummaryLine("Overview:")).toBe("");
    expect(cleanSummaryLine("")).toBe("");
  });
});
