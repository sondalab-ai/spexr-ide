import { describe, expect, it } from "vitest";
import { isFoldable, renderBlock, renderInline, todoBody } from "./todo-markdown.js";

describe("todoBody", () => {
  it("joins the checkbox line and the lines under it", () => {
    expect(todoBody({ title: "**Idea.** Today", details: "every memory" })).toBe("**Idea.** Today\nevery memory");
    expect(todoBody({ title: "short", details: "" })).toBe("short");
  });
});

describe("isFoldable", () => {
  it("leaves a short item alone and folds a long one", () => {
    expect(isFoldable({ title: "short", details: "two lines" })).toBe(false);
    expect(isFoldable({ title: "x".repeat(100), details: "y".repeat(60) })).toBe(true);
  });

  it("folds an item that carries a list, a quote or a code fence", () => {
    for (const details of ["- one\n- two", "1. one", "> quoted", "```\ncode\n```"]) {
      expect(isFoldable({ title: "t", details })).toBe(true);
    }
  });
});

describe("renderInline", () => {
  it("renders bold and code, and joins hard-wrapped lines into one", () => {
    expect(renderInline("**Idea.** Today `a`\nevery")).toBe("<strong>Idea.</strong> Today <code>a</code> every");
  });

  it("shows raw HTML as text", () => {
    expect(renderInline("<img src=x onerror=alert(1)> hi")).not.toContain("<img");
    expect(renderInline("<script>x</script>")).not.toContain("<script");
  });

  it("keeps https links and drops the rest to plain text", () => {
    expect(renderInline("[a](https://x.dev/p)")).toBe('<a href="https://x.dev/p" rel="noopener noreferrer">a</a>');
    expect(renderInline("[a](javascript:alert(1))")).toBe("a");
    expect(renderInline("[a](http://x.dev)")).toBe("a");
  });
});

describe("renderBlock", () => {
  it("renders paragraphs, lists and code blocks", () => {
    const html = renderBlock("para\n\n- one\n- two\n\n```\ncode\n```");
    expect(html).toContain("<p>para</p>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<pre><code>");
  });

  it("shows raw HTML and images as text", () => {
    expect(renderBlock("<div onclick=x>hi</div>")).not.toContain("<div");
    expect(renderBlock("![alt](https://x.dev/a.png)")).not.toContain("<img");
  });
});
