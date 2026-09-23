import type { PendingInteraction } from "@zcode/shared/zcode-protocol-v4";
import {
  buildPromptWithConversationSelections,
  type ConversationSelectionDisplayReference,
} from "@/lib/conversationSelectionReference.js";

/** 批准值由 CLI 投影给出（ExitPlanMode 审批只有一个 `approve` 选项），UI 只负责识别它。 */
export const PLAN_APPROVAL_APPROVE_VALUE = "approve";

/**
 * 计划待确认期间存在待发评论时，批准入口不再可用：评论的语义是「改计划」，
 * 而"带评论批准"只会让评论静默顺延到下一条消息。想直接批准必须先移除评论。
 */
export function resolvePlanApprovalOptions<T extends { value: string }>(
  options: T[],
  hasPendingComments: boolean,
): T[] {
  if (!hasPendingComments) return options;
  return options.filter((option) => option.value !== PLAN_APPROVAL_APPROVE_VALUE);
}

/**
 * 组装计划确认的答复文本：只有评论时就是按评论修改计划。
 *
 * 有评论时即使答案等于批准值（历史草稿等残留）也改写成「评论即修改意见」，
 * 不存在带评论批准；没有评论时原样返回，保持既有批准/空答案语义不变。
 */
export function resolvePlanApprovalFeedbackAnswer(
  answerText: string,
  references: readonly ConversationSelectionDisplayReference[],
): string {
  if (references.length === 0) return answerText;
  const trimmed = answerText.trim();
  const visibleText = trimmed === PLAN_APPROVAL_APPROVE_VALUE ? "" : trimmed;
  return buildPromptWithConversationSelections(visibleText, references);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 计划审批的挂起交互：ExitPlanMode 的 v4 投影是 `userInput` + `schema.interaction === "plan_approval"`。
 * 判据只取 `schema.interaction`，不依赖 `toolName`；legacy 权限卡片形态不在本判定的范围内。
 */
export function isPlanApprovalPendingInteraction(
  interaction: Pick<PendingInteraction, "payload">,
): boolean {
  const payload = interaction.payload;
  if (payload.kind !== "userInput") return false;
  const { schema } = payload;
  return isRecord(schema) && schema.interaction === "plan_approval";
}

/**
 * 选区入口（评论 / 在辅助对话中提问）的父会话阻塞判定。
 *
 * 计划审批不算阻塞：待确认期间「看计划、就某段提问」正是要支持的场景，而选区提问的引用落点是
 * 辅助对话的 scope（`targetSessionId = childSessionId`），不写父会话 composer，不影响审批答复语义。
 * 权限请求与普通问答仍视为阻塞，保持既有门禁；`workspaceHookReview` 两种情况下都不计。
 */
export function resolveSelectionInteractionBlocked(
  pendingInteractions: readonly PendingInteraction[],
): boolean {
  const blocking = pendingInteractions.filter(
    (interaction) => interaction.payload.kind !== "workspaceHookReview",
  );
  if (blocking.length === 0) return false;
  return !blocking.every(isPlanApprovalPendingInteraction);
}
