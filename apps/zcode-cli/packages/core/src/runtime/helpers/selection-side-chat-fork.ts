import type { ExecutionState } from "@zcode/shared";

/**
 * 辅助对话（selection side chat）的 fork 语义。
 *
 * 2026-09-23 实测：计划待确认时从计划 tab 提问，辅助对话不回答提问，而是继续产出并提交计划。
 * 原因是 fork 同时带进了父会话本轮「进入计划模式并提交计划」的指令与父会话的 planEnabled。
 * 两个判定都是纯函数，测试跑在 dist 产物上（与 packages/adapters 的 test 约定一致）。
 */

/** fork 历史只需要识别「哪条是父会话本轮的 real-user 输入」，不依赖完整消息类型。 */
export interface SelectionSideChatHistoryMessage {
  info: {
    role: string;
    anchor?: { origin?: string; turnId?: string } | undefined;
  };
}

/**
 * 结尾若还有没有 assistant 回应的 user 消息，它就不是「已完成的对话」，不带进子会话。
 *
 * 两种常见来源：父会话刚收到指令、回复还没落盘；或应用重启丢掉了下半轮（挂起的计划确认
 * 就是这样消失的，实测里那条「去做计划」的指令因此留在了历史末尾）。它正是父会话当前的
 * 任务指令，带进子会话会被当成子会话自己的任务。
 */
function dropTrailingUnansweredUserMessages<T extends SelectionSideChatHistoryMessage>(
  messages: readonly T[],
): T[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1]!.info.role === "user") end -= 1;
  return end === messages.length ? [...messages] : messages.slice(0, end);
}

/**
 * 只复制到父会话上一轮结束：本轮 real-user input 与其后的增量都不进子会话。
 *
 * 本轮输入是「让父会话去做某事」的指令，带进子会话会被当成子会话自己的任务；
 * 找不到本轮 real-user 起点时退回整轮截断——宁可少复制，也不延续父会话任务。
 */
export function selectionSideChatHistoryMessages<T extends SelectionSideChatHistoryMessage>(
  activeMessages: readonly T[],
  activeTurnId?: string,
): T[] {
  if (!activeTurnId) return dropTrailingUnansweredUserMessages(activeMessages);
  const activeUserIndex = activeMessages.findIndex(
    (message) =>
      message.info.role === "user" &&
      message.info.anchor?.turnId === activeTurnId &&
      message.info.anchor.origin === "realUser",
  );
  if (activeUserIndex >= 0) {
    return dropTrailingUnansweredUserMessages(activeMessages.slice(0, activeUserIndex));
  }
  const activeTurnStart = activeMessages.findIndex(
    (message) => message.info.anchor?.turnId === activeTurnId,
  );
  return dropTrailingUnansweredUserMessages(
    activeTurnStart >= 0 ? activeMessages.slice(0, activeTurnStart) : activeMessages,
  );
}

/**
 * 辅助对话是问答用途，不接手父会话的计划流程：保留权限模式，强制关闭 planEnabled。
 *
 * 父会话处于计划模式（计划待确认是最常见形态）时，继承 planEnabled 会让子会话进入计划流程，
 * 把「回答问题」变成「继续提交计划」。
 */
export function resolveSelectionSideChatExecutionState(parent: ExecutionState): ExecutionState {
  return parent.planEnabled ? { ...parent, planEnabled: false } : parent;
}
