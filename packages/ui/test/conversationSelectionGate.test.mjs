// 选区入口的阻塞门禁：计划审批不算阻塞，权限请求与普通问答仍然阻塞。
// 判定是纯函数，注册/请求链路走 selectionSideChatRuntime 的运行时状态；两者都不需要 DOM。
import assert from "node:assert/strict";
import { test } from "node:test";

// planApproval 的导入链会在调用期触碰 window（引用变更广播），给一个最小替身即可。
globalThis.window = { dispatchEvent: () => true };

const { isPlanApprovalPendingInteraction, resolveSelectionInteractionBlocked } =
  await import("../src/lib/planApproval.ts");

test("选区阻塞门禁：计划审批不阻塞，权限与普通问答仍阻塞", () => {
  // 判定只读 payload（kind + schema.interaction），因此不需要构造完整协议对象。
  const hookReview = {
    interactionId: "hook-1",
    kind: "workspaceHookReview",
    payload: { kind: "workspaceHookReview" },
  };
  const planApproval = {
    interactionId: "plan-1",
    kind: "userInput",
    payload: {
      kind: "userInput",
      prompt: "确认计划",
      freeText: true,
      schema: { interaction: "plan_approval", toolName: "ExitPlanMode" },
    },
  };
  const permission = {
    interactionId: "perm-1",
    kind: "permission",
    payload: {
      kind: "permission",
      toolCallId: "t1",
      toolName: "Bash",
      summary: "rm -rf build",
      detail: {},
    },
  };
  const question = {
    interactionId: "q-1",
    kind: "userInput",
    payload: { kind: "userInput", prompt: "选一个", freeText: true },
  };

  assert.equal(resolveSelectionInteractionBlocked([]), false);
  assert.equal(resolveSelectionInteractionBlocked([hookReview]), false);
  // 计划待确认：选区入口要可用（计划 tab / 文件预览 / 会话正文三表面同一判定）。
  assert.equal(resolveSelectionInteractionBlocked([planApproval]), false);
  assert.equal(resolveSelectionInteractionBlocked([planApproval, hookReview]), false);
  // 并存真实阻塞时不能让计划审批把它们一起放开。
  assert.equal(resolveSelectionInteractionBlocked([planApproval, permission]), true);
  assert.equal(resolveSelectionInteractionBlocked([permission]), true);
  assert.equal(resolveSelectionInteractionBlocked([question]), true);

  assert.equal(isPlanApprovalPendingInteraction(planApproval), true);
  assert.equal(isPlanApprovalPendingInteraction(question), false);
  assert.equal(isPlanApprovalPendingInteraction(permission), false);
});

test("辅助对话门禁：计划审批挂起时带引用的提问不会被拒", async () => {
  const {
    buildSelectionSideChatKey,
    getSelectionSideChatOpenState,
    registerSelectionSideChatOpener,
    requestSelectionSideChatOpen,
  } = await import("../src/lib/selectionSideChatRuntime.ts");
  const planApproval = {
    interactionId: "plan-1",
    kind: "userInput",
    payload: {
      kind: "userInput",
      prompt: "确认计划",
      freeText: true,
      schema: { interaction: "plan_approval", toolName: "ExitPlanMode" },
    },
  };
  const permission = {
    interactionId: "perm-1",
    kind: "permission",
    payload: { kind: "permission", toolCallId: "t1", toolName: "Bash", summary: "x", detail: {} },
  };
  const reference = { contentType: "markdown", id: "r1", text: "计划片段" };
  const key = buildSelectionSideChatKey("/ws", "s1");
  const received = [];

  const unregisterReady = registerSelectionSideChatOpener(
    key,
    async (incoming) => {
      received.push(incoming);
    },
    true,
    resolveSelectionInteractionBlocked([planApproval]),
  );
  assert.equal(getSelectionSideChatOpenState(key), "ready");
  assert.equal(requestSelectionSideChatOpen(key, reference), true);
  await Promise.resolve();
  assert.deepEqual(received, [reference]);
  unregisterReady();

  const unregisterBlocked = registerSelectionSideChatOpener(
    key,
    async (incoming) => {
      received.push(incoming);
    },
    true,
    resolveSelectionInteractionBlocked([planApproval, permission]),
  );
  assert.equal(getSelectionSideChatOpenState(key), "blocked");
  assert.equal(requestSelectionSideChatOpen(key, reference), false);
  unregisterBlocked();
  assert.deepEqual(received, [reference]);
});
