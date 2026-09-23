import assert from "node:assert/strict";
import { test } from "node:test";

// 模块只在调用期触碰 window（派发引用变更广播），因此测试内给一个最小替身即可覆盖写入、预算与去重。
globalThis.window = { dispatchEvent: () => true };

const {
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  buildPromptWithConversationSelections,
  createConversationSelectionReference,
  dispatchConversationSelectionAdd,
  getConversationSelectionChangeEventName,
  getConversationSelectionReferenceLimitReason,
  getConversationSelectionReferenceScope,
  isConversationSelectionChangeEvent,
  parsePromptConversationSelections,
  setConversationSelectionReferenceScope,
} = await import("../src/lib/conversationSelectionReference.ts");
const {
  PLAN_APPROVAL_APPROVE_VALUE,
  resolvePlanApprovalFeedbackAnswer,
  resolvePlanApprovalOptions,
} = await import("../src/lib/planApproval.ts");
const { parseComposerPromptContexts, serializeComposerPromptContexts } =
  await import("../src/v4/composer/composerPromptContexts.ts");
const { resolvePlanSelectionSource } = await import("../src/lib/planToolCall.ts");

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

test("计划来源：身份只由对话与工具调用决定，不随正文漂移", () => {
  const base = { parentSessionId: "s1", toolCallId: "t1", fallbackTitle: "计划" };
  const streaming = resolvePlanSelectionSource({ ...base, markdown: "# 方案 A\n\n第一步" });
  const finished = resolvePlanSelectionSource({
    ...base,
    markdown: "# 方案 A\n\n第一步\n\n第二步\n\n第三步",
  });
  assert.equal(streaming.sourceKey, "plan:s1:t1");
  assert.equal(finished.sourceKey, streaming.sourceKey, "正文追加不应改变来源身份");
  assert.notEqual(
    resolvePlanSelectionSource({ ...base, toolCallId: "t2", markdown: "" }).sourceKey,
    streaming.sourceKey,
  );
  assert.notEqual(
    resolvePlanSelectionSource({ ...base, parentSessionId: "s2", markdown: "" }).sourceKey,
    streaming.sourceKey,
  );
});

test("计划来源：标题回退链与文件路径", () => {
  const base = { parentSessionId: "s1", toolCallId: "t1", fallbackTitle: "计划" };
  assert.equal(
    resolvePlanSelectionSource({ ...base, markdown: "# 实现登录\n\n正文" }).sourceTitle,
    "实现登录",
  );
  assert.equal(
    resolvePlanSelectionSource({ ...base, markdown: "- 第一步\n- 第二步" }).sourceTitle,
    "第一步",
  );
  assert.equal(
    resolvePlanSelectionSource({ ...base, markdown: "   ", planFilePath: "/ws/plan.md" })
      .sourceTitle,
    "plan.md",
  );
  assert.equal(
    resolvePlanSelectionSource({ ...base, markdown: "   ", planFilePath: "/ws/plan.md" }).path,
    "/ws/plan.md",
  );
  const bare = resolvePlanSelectionSource({ ...base, markdown: "" });
  assert.equal(bare.sourceTitle, "计划");
  assert.equal("path" in bare, false, "没有计划文件时不应写入 path");
});

test("计划确认：有评论时批准选项被收窄，评论组装成反馈文本", () => {
  const approveOption = { value: PLAN_APPROVAL_APPROVE_VALUE, label: "批准" };
  const otherOption = { value: "other", label: "其它" };
  const options = [approveOption, otherOption];
  assert.deepEqual(resolvePlanApprovalOptions(options, false), options, "没有评论时批准照旧");
  assert.deepEqual(resolvePlanApprovalOptions(options, true), [otherOption]);

  const comments = [{ text: "第二步重试两次没必要", comment: "改成一次性调用" }];
  // 只有评论：答复文本就是尾块本身，不再依赖用户手打理由。
  const commentsOnly = resolvePlanApprovalFeedbackAnswer("", comments);
  assert.deepEqual(parseBlockItem(commentsOnly), [
    { text: "第二步重试两次没必要", comment: "改成一次性调用" },
  ]);
  assert.equal(parsePromptConversationSelections(commentsOnly).visibleContent, "");

  // 评论 + 理由：理由在前，尾块在后。
  const withReason = resolvePlanApprovalFeedbackAnswer("按这个方向改", comments);
  assert.equal(parsePromptConversationSelections(withReason).visibleContent, "按这个方向改");

  // 残留草稿里的批准值不能带评论通过：答案被改写成纯反馈。
  const staleApprove = resolvePlanApprovalFeedbackAnswer(PLAN_APPROVAL_APPROVE_VALUE, comments);
  assert.equal(parsePromptConversationSelections(staleApprove).visibleContent, "");
  assert.deepEqual(parseBlockItem(staleApprove), [
    { text: "第二步重试两次没必要", comment: "改成一次性调用" },
  ]);
});

test("计划确认：没有评论时批准与空答案语义完全不变", () => {
  assert.equal(resolvePlanApprovalFeedbackAnswer(PLAN_APPROVAL_APPROVE_VALUE, []), "approve");
  assert.equal(resolvePlanApprovalFeedbackAnswer("", []), "");
  assert.equal(resolvePlanApprovalFeedbackAnswer("原地改", []), "原地改");
});

test("引用变更广播：写入与移除都通知同一 scope（composer 与确认卡片共用）", () => {
  const events = [];
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  try {
    const reference = createConversationSelectionReference({
      contentType: "markdown",
      sourceKey: "plan:s1:t1",
      sourceTitle: "计划",
      text: "选中的计划段落",
      comment: "这里要改",
    });
    setConversationSelectionReferenceScope("s1", "/ws", [reference]);
    setConversationSelectionReferenceScope("s1", "/ws", []);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, getConversationSelectionChangeEventName());
    assert.ok(isConversationSelectionChangeEvent(events[0]));
    assert.deepEqual(events[0].detail, { sessionId: "s1", workspaceKey: "/ws" });
    assert.deepEqual(events[1].detail, { sessionId: "s1", workspaceKey: "/ws" });
  } finally {
    globalThis.window = originalWindow;
  }
});
