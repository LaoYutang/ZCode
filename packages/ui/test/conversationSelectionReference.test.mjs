import assert from "node:assert/strict";
import { test } from "node:test";

// 模块只在调用期触碰 window（派发 add 事件），因此测试内给一个最小替身即可覆盖写入、预算与去重。
globalThis.window = { dispatchEvent: () => true };

const {
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  buildPromptWithConversationSelections,
  createConversationSelectionReference,
  dispatchConversationSelectionAdd,
  getConversationSelectionReferenceLimitReason,
  getConversationSelectionReferenceScope,
  parsePromptConversationSelections,
  setConversationSelectionReferenceScope,
} = await import("../src/lib/conversationSelectionReference.ts");
const { parseComposerPromptContexts, serializeComposerPromptContexts } =
  await import("../src/v4/composer/composerPromptContexts.ts");

function parseBlockItem(prompt) {
  const match = /```userselect\n([\s\S]*?)\n```/.exec(prompt);
  assert.ok(match, "prompt 必须包含 userselect 尾块");
  return JSON.parse(match[1]);
}

test("引用与评论一起进入尾块，并能解析回展示引用", () => {
  const prompt = buildPromptWithConversationSelections("看这里", [
    { text: "选中的原文", comment: "这里为什么要重试两次？" },
  ]);
  assert.deepEqual(parseBlockItem(prompt), [
    { text: "选中的原文", comment: "这里为什么要重试两次？" },
  ]);

  const parsed = parsePromptConversationSelections(prompt);
  assert.equal(parsed.visibleContent, "看这里");
  assert.deepEqual(parsed.references, [{ text: "选中的原文", comment: "这里为什么要重试两次？" }]);
});

test("文件选段保留路径与评论", () => {
  const prompt = buildPromptWithConversationSelections("", [
    { path: "src/a.ts", text: "const a = 1", comment: "这里" },
  ]);
  assert.deepEqual(parseBlockItem(prompt), [
    { path: "src/a.ts", text: "const a = 1", comment: "这里" },
  ]);
  assert.deepEqual(parsePromptConversationSelections(prompt).references, [
    { path: "src/a.ts", text: "const a = 1", comment: "这里" },
  ]);
});

test("没有评论时不写 comment 键，空白评论等同于没有评论", () => {
  const withoutComment = buildPromptWithConversationSelections("", [{ text: "a" }]);
  assert.deepEqual(parseBlockItem(withoutComment), [{ text: "a" }]);

  const blankComment = buildPromptWithConversationSelections("", [{ text: "a", comment: "   " }]);
  assert.deepEqual(parseBlockItem(blankComment), [{ text: "a" }]);
});

test("评论两侧空白在尾块里被裁掉", () => {
  const prompt = buildPromptWithConversationSelections("", [
    { text: "a", comment: "  前后都有空格  " },
  ]);
  assert.deepEqual(parseBlockItem(prompt), [{ text: "a", comment: "前后都有空格" }]);
});

test("键集合严格：出现未知键时整块回退为可见原文", () => {
  const prompt = [
    "正文",
    "",
    "# userselect:",
    "```userselect",
    JSON.stringify([{ text: "a", legacyField: "x" }]),
    "```",
  ].join("\n");
  const parsed = parsePromptConversationSelections(prompt);
  assert.equal(parsed.references.length, 0);
  assert.equal(parsed.visibleContent, prompt);
});

test("历史尾块仍可解析（回归）", () => {
  const legacy = [
    "正文",
    "",
    "# Conversation selections:",
    "```zcode-conversation-selections",
    JSON.stringify([
      {
        id: "x",
        sourceSessionId: "s",
        sourceRowId: 3,
        contentType: "assistant",
        text: "旧引用",
      },
    ]),
    "```",
  ].join("\n");
  const parsed = parsePromptConversationSelections(legacy);
  assert.equal(parsed.visibleContent, "正文");
  assert.equal(parsed.references[0].text, "旧引用");
});

test("单条上限只判引文正文", () => {
  const scope = { targetSessionId: "single", workspaceKey: "ws" };
  setConversationSelectionReferenceScope(scope.targetSessionId, scope.workspaceKey, []);
  const result = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      sourceSessionId: "src",
      sourceRowId: 1,
      contentType: "assistant",
      text: "x".repeat(CONVERSATION_SELECTION_MAX_TEXT_LENGTH + 1),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "single");
  assert.equal(
    getConversationSelectionReferenceLimitReason(scope.targetSessionId, scope.workspaceKey),
    "single",
  );
});

test("总量预算把评论算进来", () => {
  const scope = { targetSessionId: "total", workspaceKey: "ws" };
  setConversationSelectionReferenceScope(scope.targetSessionId, scope.workspaceKey, []);
  // 引文只有 10 个字符，单条上限不会拦下它；超预算的是评论长度。
  const result = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      sourceSessionId: "src",
      sourceRowId: 1,
      contentType: "assistant",
      text: "短引文",
      comment: "c".repeat(16_000),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "total");
});

test("去重键区分评论：同文不同评论并存", () => {
  const scope = { targetSessionId: "dedupe", workspaceKey: "ws" };
  setConversationSelectionReferenceScope(scope.targetSessionId, scope.workspaceKey, []);
  const create = (comment) =>
    createConversationSelectionReference({
      sourceSessionId: "src",
      sourceRowId: 7,
      contentType: "assistant",
      text: "同一句",
      ...(comment ? { comment } : {}),
    });

  dispatchConversationSelectionAdd({ ...scope, reference: create("第一条") });
  const duplicate = dispatchConversationSelectionAdd({ ...scope, reference: create("第一条") });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    getConversationSelectionReferenceScope(scope.targetSessionId, scope.workspaceKey).length,
    1,
  );

  dispatchConversationSelectionAdd({ ...scope, reference: create("第二条") });
  dispatchConversationSelectionAdd({ ...scope, reference: create(undefined) });
  const references = getConversationSelectionReferenceScope(
    scope.targetSessionId,
    scope.workspaceKey,
  );
  assert.equal(references.length, 3);
  assert.deepEqual(
    references.map((reference) => reference.comment),
    ["第一条", "第二条", undefined],
  );
});

test("四类外部上下文一起序列化后，评论随引用无损解析", () => {
  const serialized = serializeComposerPromptContexts("正文", {
    codeComments: [
      {
        id: "comment-1",
        workspacePath: "/ws",
        sourcePath: "src/a.ts",
        sourceTitle: "a.ts",
        startLine: 1,
        endLine: 2,
        selectedText: "const a = 1",
        comment: "代码评论",
      },
    ],
    conversationSelections: [{ text: "引用", comment: "引用评论" }],
    webElements: [],
    pptxElements: [],
  });
  const parsed = parseComposerPromptContexts(serialized, { workspacePath: "/ws" });
  assert.equal(parsed.visibleContent, "正文");
  assert.deepEqual(parsed.conversationSelections, [{ text: "引用", comment: "引用评论" }]);
  assert.equal(parsed.codeComments.length, 1);
  assert.equal(parsed.codeComments[0].comment, "代码评论");
  assert.equal(parsed.codeComments[0].selectedText, "const a = 1");
});
