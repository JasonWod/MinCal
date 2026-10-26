import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 静态回归检查：JS 组件里无法验证 CSS 继承，因此直接对样式表做断言。
// 背景：body { user-select: none } 会被 <input>/<textarea> 继承，在 WebView2 下
// 表现为“输入框打不进字、已有内容改不掉”（用户上报的核心问题之一）。
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");
const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 把样式表拆成 { selector, declarations } 列表 */
function parseRules(src: string) {
  return [...src.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    sel: m[1].replace(/\s+/g, " ").trim(),
    decl: m[2].replace(/\s+/g, " ").trim(),
  }));
}

const rules = parseRules(clean);

describe("index.css: 可编辑控件必须恢复文本选择", () => {
  it("存在同时覆盖 input/textarea/select/contenteditable 且声明 user-select: text 的规则", () => {
    const target = rules.find((r) => {
      const parts = r.sel.split(",").map((p) => p.trim());
      return (
        parts.includes("input") &&
        parts.includes("textarea") &&
        parts.includes("select") &&
        parts.some((p) => p.includes("contenteditable")) &&
        /(^|;)\s*user-select:\s*text/.test(r.decl)
      );
    });
    expect(target).toBeDefined();
    expect(target!.decl).toMatch(/-webkit-user-select:\s*text/);
  });

  it("body 仍然禁止选中标题/文字（恢复规则不是靠删掉 body 规则实现的）", () => {
    const bodyRule = rules.find((r) => r.sel === "body");
    expect(bodyRule).toBeDefined();
    expect(bodyRule!.decl).toMatch(/user-select:\s*none/);
  });

  it("未禁用的输入框给出 text 光标，禁用的给出 not-allowed", () => {
    const editableCursor = rules.find((r) => /input:not\(\[disabled\]\)/.test(r.sel));
    expect(editableCursor).toBeDefined();
    expect(editableCursor!.decl).toMatch(/cursor:\s*text/);

    const disabledRule = rules.find((r) => /input\[disabled\]/.test(r.sel));
    expect(disabledRule).toBeDefined();
    expect(disabledRule!.decl).toMatch(/cursor:\s*not-allowed/);
  });
});
