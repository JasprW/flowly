import { expect, test } from "vitest";
import { columnWidth, isInlineUiFence, parseSessionInline, parseSessionMarkdown } from "./session-markdown";

test("tables accept short delimiters, alignment and missing outer pipes", () => {
  const [table] = parseSessionMarkdown(
    "a | b | c\n:-|:-:|-:\n1 | 2 | 3\nx | y\\|z | `p|q`",
  );
  expect(table).toEqual({
    kind: "table",
    headers: ["a", "b", "c"],
    align: ["left", "center", "right"],
    rows: [
      ["1", "2", "3"],
      ["x", "y|z", "`p|q`"],
    ],
  });
});

test("a pipe line with a mismatched delimiter stays a paragraph", () => {
  expect(parseSessionMarkdown("a | b\n--- | --- | ---")[0].kind).toBe("paragraph");
});

test("ui/app fences are detected by first language word, like genui", () => {
  expect(isInlineUiFence("ui")).toBe(true);
  expect(isInlineUiFence("app")).toBe(true);
  expect(isInlineUiFence("UI")).toBe(true);
  expect(isInlineUiFence(" App ")).toBe(true);
  expect(isInlineUiFence("ui demo")).toBe(true);
  expect(isInlineUiFence("")).toBe(false);
  expect(isInlineUiFence("apples")).toBe(false);
  expect(isInlineUiFence("ui-js")).toBe(false);
});

test("a ui fence parses to the code block the notice keys off, closed or streaming", () => {
  expect(parseSessionMarkdown('Here:\n```ui\nCard("Demo", [])')).toEqual([
    { kind: "paragraph", text: "Here:" },
    { kind: "code", language: "ui", text: 'Card("Demo", [])' },
  ]);
  expect(parseSessionMarkdown("~~~APP\n<html>\n~~~")[0]).toEqual({
    kind: "code",
    language: "APP",
    text: "<html>",
  });
});

test("links accept <angle> destinations with spaces, nested parens and titles", () => {
  const link = (text: string) => parseSessionInline(text)[0];
  expect(link("[验收](</Users/a/Search System/docs/D+1.md>)")).toEqual({
    kind: "link",
    text: "验收",
    url: "/Users/a/Search System/docs/D+1.md",
  });
  expect(link("[w](https://x.org/a_(b))").url).toBe("https://x.org/a_(b)");
  expect(link('[t](https://x.org "title")').url).toBe("https://x.org");
});

test("bare and <angle> URLs become links without trailing punctuation", () => {
  expect(parseSessionInline("see https://a.io/x_y_z, then (https://b.io/p).")).toEqual([
    { kind: "text", text: "see " },
    { kind: "link", text: "https://a.io/x_y_z", url: "https://a.io/x_y_z" },
    { kind: "text", text: ", then (" },
    { kind: "link", text: "https://b.io/p", url: "https://b.io/p" },
    { kind: "text", text: ")." },
  ]);
  expect(parseSessionInline("<https://c.io>")[0].url).toBe("https://c.io");
});

const joined = (text: string) =>
  parseSessionInline(text)
    .map((part) => part.text)
    .join("");

test("underscores inside words stay literal text", () => {
  for (const text of [
    "user_id_name",
    "a_b_c_d",
    "foo__bar__baz",
    "a__b__c",
    "描述_中的_下划线",
    "flowly的描述中下划线_都没有展示出来，复制的话也会缺少下划线_",
    "path/to/my_file_v2.ts",
  ]) {
    expect(parseSessionInline(text)).toEqual([{ kind: "text", text }]);
  }
});

test("standalone underscore emphasis still renders", () => {
  expect(parseSessionInline("an _italic_ word")).toEqual([
    { kind: "text", text: "an " },
    { kind: "italic", text: "italic" },
    { kind: "text", text: " word" },
  ]);
  expect(parseSessionInline("(__bold__)")[1]).toEqual({ kind: "bold", text: "bold" });
  expect(parseSessionInline("my_var and _em_")).toEqual([
    { kind: "text", text: "my_var and " },
    { kind: "italic", text: "em" },
  ]);
  expect(joined("snake_case **bold** x_y")).toBe("snake_case bold x_y");
});

test.each([
  ["说明：_强调_。", "说明：", "强调", "。", "italic"],
  ["说明：__强调__。", "说明：", "强调", "。", "bold"],
  ["说明: _强调_。", "说明: ", "强调", "。", "italic"],
  ["说明：_强调_ word", "说明：", "强调", " word", "italic"],
  ["「_强调_」", "「", "强调", "」", "italic"],
  ["【__强调__】", "【", "强调", "】", "bold"],
])(
  "underscore emphasis recognizes Unicode punctuation: %s",
  (input, before, text, after, kind) => {
    expect(parseSessionInline(input)).toEqual([
      { kind: "text", text: before },
      { kind, text },
      { kind: "text", text: after },
    ]);
  },
);

test("table column widths count English characters once and use the widest cell", () => {
  expect(columnWidth(["a", "abcdef", "abc"])).toBe(72);
  expect(columnWidth(["1234567890123"])).toBe(128);
});

test.each(["中文列宽", "かなカナ", "한글너비", "ＡＢＣＤ", "𠀀𠀁𠀂𠀃"])(
  "table column widths count wide characters twice: %s",
  (cell) => expect(columnWidth([cell])).toBe(88),
);

test("table column widths combine narrow and wide characters", () => {
  expect(columnWidth(["abc中文"])).toBe(80);
});

test("table column widths keep empty and short columns at 64", () => {
  expect(columnWidth([])).toBe(64);
  expect(columnWidth(["", "abc"])).toBe(64);
});

test("table column widths cap long identifiers and wide text at 260", () => {
  expect(columnWidth(["tx_port_fraud_fore_select_exinfo_cache"])).toBe(260);
  expect(columnWidth(["中".repeat(30)])).toBe(260);
});
