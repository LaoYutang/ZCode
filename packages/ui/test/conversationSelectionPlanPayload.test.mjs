// 计划正文快照（引用的 plan 字段）：随引用进尾块、走独立额度、不进去重键。
import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.window = { dispatchEvent: () => true };

const {
  buildPromptWithConversationSelections,
  createConversationSelectionReference,
  dispatchConversationSelectionAdd,
  getConversationSelectionReferenceLimitReason,
  getConversationSelectionReferenceScope,
  parsePromptConversationSelections,
} = await import("../src/lib/conversationSelectionReference.ts");

function parseBlockItem(prompt) {
  const match = /```userselect\n([\s\S]*?)\n```/.exec(prompt);
  assert.ok(match, "prompt 必须包含 userselect 尾块");
  return JSON.parse(match[1]);
}

test("计划正文随引用进尾块，并能解析回来", () => {
  const plan = "# 计划：周末整理书桌\n\n## 背景\n书桌已形成稳定的生态系统。";
  const prompt = buildPromptWithConversationSelections("这段什么意思？", [
    {
      path: "/ws/.zcode/plans/plan-s1.md",
      text: "## 背景",
      comment: "这里不对",
      plan,
    },
  ]);
  assert.deepEqual(parseBlockItem(prompt), [
    { path: "/ws/.zcode/plans/plan-s1.md", text: "## 背景", comment: "这里不对", plan },
  ]);
  const parsed = parsePromptConversationSelections(prompt);
  assert.equal(parsed.visibleContent, "这段什么意思？");
  assert.deepEqual(parsed.references, [
    { path: "/ws/.zcode/plans/plan-s1.md", text: "## 背景", plan, comment: "这里不对" },
  ]);
});

test("item 键序固定为 path/text/comment/plan", () => {
  const prompt = buildPromptWithConversationSelections("", [
    { plan: "P", comment: "C", path: "/p.md", text: "T" },
  ]);
  assert.equal(Object.keys(parseBlockItem(prompt)[0]).join(","), "path,text,comment,plan");
  // 没有 path 与 comment 时也不留下空键。
  const minimal = buildPromptWithConversationSelections("", [{ text: "T", plan: "P" }]);
  assert.deepEqual(parseBlockItem(minimal), [{ text: "T", plan: "P" }]);
});

test("严格键集只放开 plan：出现未知键仍整块回退为可见原文", () => {
  const raw = '看这个\n\n# userselect:\n```userselect\n[{"text":"x","plan":"y","extra":1}]\n```';
  const parsed = parsePromptConversationSelections(raw);
  assert.deepEqual(parsed.references, []);
  assert.equal(parsed.visibleContent, raw);
});

test("计划正文走独立额度：不挤占选段预算，超出 20,000 判总计超限", () => {
  const scope = { targetSessionId: "plan-budget", workspaceKey: "/ws-plan" };
  const plan = "P".repeat(20_000);
  const base = { contentType: "markdown", sourceTitle: "计划" };
  const first = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      ...base,
      sourceKey: "plan:s:t1",
      text: "片段一",
      plan,
    }),
  });
  assert.equal(first.ok, true);
  // 选段预算仍是 16,000：8,000 引文能进来，说明整份计划没有占用它。
  const second = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      ...base,
      sourceKey: "plan:s:t2",
      text: "T".repeat(8_000),
    }),
  });
  assert.equal(second.ok, true);
  // 第二份满额计划会被计划额度拦下。
  const third = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      ...base,
      sourceKey: "plan:s:t3",
      text: "片段二",
      plan,
    }),
  });
  assert.equal(third.ok, false);
  assert.equal(third.reason, "total");
  assert.equal(
    getConversationSelectionReferenceLimitReason(scope.targetSessionId, scope.workspaceKey),
    "total",
  );
  assert.equal(
    getConversationSelectionReferenceScope(scope.targetSessionId, scope.workspaceKey).length,
    2,
  );
});

test("去重键不含 plan：计划修订后同片段同评论仍判重复", () => {
  const scope = { targetSessionId: "plan-dedupe", workspaceKey: "/ws-plan" };
  const base = { contentType: "markdown", sourceKey: "plan:s:t", sourceTitle: "计划" };
  const first = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      ...base,
      text: "第二阶段的时间窗",
      comment: "改这里",
      plan: "第一版计划",
    }),
  });
  assert.equal(first.ok, true);
  const second = dispatchConversationSelectionAdd({
    ...scope,
    reference: createConversationSelectionReference({
      ...base,
      text: "第二阶段的时间窗",
      comment: "改这里",
      plan: "第二版计划（已修订）",
    }),
  });
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(
    getConversationSelectionReferenceScope(scope.targetSessionId, scope.workspaceKey).length,
    1,
  );
});
