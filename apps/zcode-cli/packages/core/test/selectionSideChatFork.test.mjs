// 辅助对话（selection side chat）fork 语义的单测。
//
// 跑在 dist 产物上：先 `tsc`（或 `pnpm --filter @zcode/core build`）再 `node --test test/*.test.mjs`，
// 与 packages/adapters 的约定一致。覆盖 2026-09-23 实测缺陷的两条修复：
// 历史只到上一轮结束（不带父会话本轮指令）、子会话不继承 planEnabled。
import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSelectionSideChatExecutionState,
  selectionSideChatHistoryMessages,
} from "../dist/runtime/helpers/selection-side-chat-fork.js";

function userMessage(turnId, origin = "realUser") {
  return { info: { role: "user", id: `${turnId}:user`, anchor: { turnId, origin } } };
}

function assistantMessage(turnId) {
  return { info: { role: "assistant", id: `${turnId}:assistant`, anchor: { turnId } } };
}

function ids(messages) {
  return messages.map((message) => message.info.id);
}

test("本轮进行中：只复制到本轮用户输入之前", () => {
  const history = [
    userMessage("t1"),
    assistantMessage("t1"),
    userMessage("t2"),
    assistantMessage("t2"),
    userMessage("t3"),
  ];
  const copied = selectionSideChatHistoryMessages(history, "t3");
  assert.deepEqual(ids(copied), ["t1:user", "t1:assistant", "t2:user", "t2:assistant"]);
});

test("父会话等待确认（本轮只有 user 输入）：本轮输入不进子会话", () => {
  const history = [userMessage("t1"), assistantMessage("t1"), userMessage("t2")];
  assert.deepEqual(ids(selectionSideChatHistoryMessages(history, "t2")), [
    "t1:user",
    "t1:assistant",
  ]);
});

test("父会话第一轮就在进行中：历史为空", () => {
  const history = [userMessage("t1")];
  assert.deepEqual(selectionSideChatHistoryMessages(history, "t1"), []);
});

test("父会话空闲：复制完整历史，且返回新数组", () => {
  const history = [userMessage("t1"), assistantMessage("t1")];
  const copied = selectionSideChatHistoryMessages(history);
  assert.deepEqual(ids(copied), ["t1:user", "t1:assistant"]);
  assert.notEqual(copied, history);
});

test("父会话空闲但末尾是没有回复的指令：那条指令不进子会话", () => {
  // 实测形态：父会话发出「去做计划」后应用重启，下半轮丢失，历史停在 user 消息上。
  const history = [userMessage("t1"), assistantMessage("t1"), userMessage("t2")];
  assert.deepEqual(ids(selectionSideChatHistoryMessages(history)), ["t1:user", "t1:assistant"]);
});

test("父会话空闲且末尾连续多条未回复消息：整段丢弃", () => {
  const history = [
    userMessage("t1"),
    assistantMessage("t1"),
    userMessage("t2"),
    userMessage("t2", "synthetic"),
  ];
  assert.deepEqual(ids(selectionSideChatHistoryMessages(history)), ["t1:user", "t1:assistant"]);
});

test("本轮没有 real-user 起点：整轮截断，宁可少复制也不延续父任务", () => {
  const history = [userMessage("t1"), assistantMessage("t1"), userMessage("t2", "synthetic")];
  assert.deepEqual(ids(selectionSideChatHistoryMessages(history, "t2")), [
    "t1:user",
    "t1:assistant",
  ]);
  const orphanTurn = [userMessage("t1"), assistantMessage("t1"), assistantMessage("t2")];
  assert.deepEqual(ids(selectionSideChatHistoryMessages(orphanTurn, "t2")), [
    "t1:user",
    "t1:assistant",
  ]);
});

test("找不到任何本轮锚点：原样复制，不误删历史", () => {
  const history = [userMessage("t1"), assistantMessage("t1")];
  assert.deepEqual(ids(selectionSideChatHistoryMessages(history, "t9")), [
    "t1:user",
    "t1:assistant",
  ]);
});

test("子会话执行状态：保留权限模式，强制关闭 planEnabled", () => {
  assert.deepEqual(resolveSelectionSideChatExecutionState({ mode: "yolo", planEnabled: true }), {
    mode: "yolo",
    planEnabled: false,
  });
  assert.deepEqual(resolveSelectionSideChatExecutionState({ mode: "build", planEnabled: true }), {
    mode: "build",
    planEnabled: false,
  });
  const alreadyOff = { mode: "edit", planEnabled: false };
  assert.equal(resolveSelectionSideChatExecutionState(alreadyOff), alreadyOff);
});
