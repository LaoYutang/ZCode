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
