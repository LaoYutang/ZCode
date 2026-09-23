import { createUuid } from "@zcode/shared";

export const CONVERSATION_SELECTION_MAX_TEXT_LENGTH = 8_000;
const CONVERSATION_SELECTION_MAX_COUNT = 8;
const CONVERSATION_SELECTION_MAX_TOTAL_LENGTH = 16_000;
/**
 * 计划正文另计一条总量：与 CLI 的 `PLAN_MODE_MAX_PLAN_CHARS` 对齐，单份计划不可能超过它。
 * 不并入选段的 16,000：整份计划会直接撑爆既有额度，而选段与文档正文是两类上下文。
 */
const CONVERSATION_SELECTION_MAX_PLAN_TOTAL_LENGTH = 20_000;

export type ConversationSelectionContentType = "user" | "assistant" | "reasoning" | "tool";

export interface ConversationSelectionText {
  text: string;
  path?: string;
  /** 用户对这段引文的补充说明；缺省与空串都表示「只引用，不评论」。 */
  comment?: string;
  /**
   * 引用所在文档的正文快照（计划 tab 携带整份计划）。模型不会主动按 `path` 去读文件，
   * 只给路径时辅助对话只能照着 fork 历史作答；快照让上下文直接可见。
   */
  plan?: string;
}

export interface MessageSelectionReference extends ConversationSelectionText {
  id: string;
  sourceSessionId: string;
  sourceRowId: number;
  contentType: ConversationSelectionContentType;
}

export interface MarkdownSelectionReference extends ConversationSelectionText {
  id: string;
  contentType: "markdown";
  sourceKey: string;
  sourceTitle: string;
}

export type ConversationSelectionReference = MessageSelectionReference | MarkdownSelectionReference;

export interface MarkdownSelectionTarget {
  sessionId: string | null;
  workspaceKey: string;
}

export type ConversationSelectionDisplayReference =
  | ConversationSelectionText
  | ConversationSelectionReference;

interface ConversationSelectionAddRequest {
  targetSessionId: string | null;
  workspaceKey: string;
  reference: ConversationSelectionReference;
}

interface ConversationSelectionChangeDetail {
  sessionId: string | null;
  workspaceKey: string;
}

export type ConversationSelectionLimitReason = "count" | "single" | "total";
type ConversationSelectionAppendResult =
  | {
      ok: true;
      references: readonly ConversationSelectionReference[];
      duplicate: boolean;
    }
  | { ok: false; reason: ConversationSelectionLimitReason };

const CHANGE_EVENT = "zcode:conversation-selection-change";
const USER_SELECT_BLOCK_PATTERN = /(?:\n\n)?# userselect:\n```userselect\n([\s\S]*?)\n```\s*$/;
const LEGACY_BLOCK_PATTERN =
  /(?:\n\n)?# Conversation selections:\n```zcode-conversation-selections\n([\s\S]*?)\n```\s*$/;
const EMPTY_SELECTION_REFERENCES: readonly ConversationSelectionReference[] = [];
const referencesByScope = new Map<string, readonly ConversationSelectionReference[]>();
const limitReasonByScope = new Map<string, ConversationSelectionLimitReason>();

function referenceScopeKey(sessionId: string | null, workspaceKey: string): string {
  return `${workspaceKey}\0${sessionId ?? "__draft__"}`;
}

/**
 * 引用是跨组件共享的事实（composer 与计划确认卡片会同时挂载，后者出现时前者只是被隐藏），
 * 因此所有写入都必须广播：订阅方各自持有渲染用的本地副本，只有这条通知能让它们保持一致。
 */
function notifyConversationSelectionChange(sessionId: string | null, workspaceKey: string): void {
  window.dispatchEvent(
    new CustomEvent<ConversationSelectionChangeDetail>(CHANGE_EVENT, {
      detail: { sessionId, workspaceKey },
    }),
  );
}

export function getConversationSelectionReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
): readonly ConversationSelectionReference[] {
  return (
    referencesByScope.get(referenceScopeKey(sessionId, workspaceKey)) ?? EMPTY_SELECTION_REFERENCES
  );
}

export function setConversationSelectionReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
  references: readonly ConversationSelectionReference[],
): void {
  const key = referenceScopeKey(sessionId, workspaceKey);
  if (references.length > 0) referencesByScope.set(key, references);
  else referencesByScope.delete(key);
  limitReasonByScope.delete(key);
  notifyConversationSelectionChange(sessionId, workspaceKey);
}

export function getConversationSelectionReferenceLimitReason(
  sessionId: string | null,
  workspaceKey: string,
): ConversationSelectionLimitReason | null {
  return limitReasonByScope.get(referenceScopeKey(sessionId, workspaceKey)) ?? null;
}

export function clearConversationSelectionReferenceScope(
  sessionId: string,
  workspaceKey: string,
): void {
  referencesByScope.delete(referenceScopeKey(sessionId, workspaceKey));
  limitReasonByScope.delete(referenceScopeKey(sessionId, workspaceKey));
  notifyConversationSelectionChange(sessionId, workspaceKey);
}

export function clearConversationSelectionReferenceLimitReason(
  sessionId: string | null,
  workspaceKey: string,
): void {
  limitReasonByScope.delete(referenceScopeKey(sessionId, workspaceKey));
}

export function createConversationSelectionReference(
  input: Omit<MessageSelectionReference, "id"> | Omit<MarkdownSelectionReference, "id">,
): ConversationSelectionReference {
  return { ...input, id: createUuid() };
}

// 评论纳入去重键：同一句引文可以分别写两条不同评论，只有「同文同评论」才算重复添加。
function getConversationSelectionDedupeKey(reference: ConversationSelectionReference): string {
  if (reference.contentType === "markdown") {
    return ["markdown", reference.sourceKey, reference.text, reference.comment ?? ""].join("\0");
  }
  return [
    reference.sourceSessionId,
    reference.sourceRowId,
    reference.contentType,
    reference.text,
    reference.comment ?? "",
  ].join("\0");
}

// 单条上限仍只看引文正文（保持「单条引用最多 8,000 个字符」的语义）；
// 总量预算必须把评论算进来，否则评论可以绕过 16,000 上限。plan 走独立总额度。
function getConversationSelectionReferenceLength(
  reference: ConversationSelectionDisplayReference,
): number {
  return reference.text.length + (reference.comment?.length ?? 0);
}

function getConversationSelectionPlanLength(
  reference: ConversationSelectionDisplayReference,
): number {
  return reference.plan?.length ?? 0;
}

function appendConversationSelectionReference(
  current: readonly ConversationSelectionReference[],
  reference: ConversationSelectionReference,
): ConversationSelectionAppendResult {
  if (reference.text.length > CONVERSATION_SELECTION_MAX_TEXT_LENGTH) {
    return { ok: false, reason: "single" };
  }
  const key = getConversationSelectionDedupeKey(reference);
  if (current.some((item) => getConversationSelectionDedupeKey(item) === key)) {
    return { ok: true, references: current, duplicate: true };
  }
  if (current.length >= CONVERSATION_SELECTION_MAX_COUNT) {
    return { ok: false, reason: "count" };
  }
  const totalLength = current.reduce(
    (sum, item) => sum + getConversationSelectionReferenceLength(item),
    0,
  );
  if (
    totalLength + getConversationSelectionReferenceLength(reference) >
    CONVERSATION_SELECTION_MAX_TOTAL_LENGTH
  ) {
    return { ok: false, reason: "total" };
  }
  const planTotalLength = current.reduce(
    (sum, item) => sum + getConversationSelectionPlanLength(item),
    0,
  );
  if (
    planTotalLength + getConversationSelectionPlanLength(reference) >
    CONVERSATION_SELECTION_MAX_PLAN_TOTAL_LENGTH
  ) {
    return { ok: false, reason: "total" };
  }
  return { ok: true, references: [...current, reference], duplicate: false };
}

export function buildPromptWithConversationSelections(
  visibleContent: string,
  references: readonly ConversationSelectionDisplayReference[],
): string {
  if (references.length === 0) return visibleContent;
  // 文件选段曾只发正文，导致模型与历史丢失文件来源；只保留路径、评论与文档正文快照，
  // 不发送内部身份字段。plan 是计划 tab 的正文快照，模型据此作答而不必自己读文件。
  const block = [
    "# userselect:",
    "```userselect",
    JSON.stringify(
      references.map(({ text, path, comment, plan }) => {
        const trimmedComment = comment?.trim();
        return {
          ...(path?.trim() ? { path } : {}),
          text,
          ...(trimmedComment ? { comment: trimmedComment } : {}),
          ...(plan ? { plan } : {}),
        };
      }),
    ),
    "```",
  ].join("\n");
  return visibleContent ? `${visibleContent}\n\n${block}` : block;
}

export function parsePromptConversationSelections(text: string): {
  visibleContent: string;
  references: readonly ConversationSelectionDisplayReference[];
} {
  const userSelectMatch = text.match(USER_SELECT_BLOCK_PATTERN);
  if (userSelectMatch) {
    return parseConversationSelectionBlock(text, userSelectMatch, (value) => {
      if (!isConversationSelectionText(value)) return null;
      // 与发送合同一致，历史保留文件路径、评论与文档正文快照，普通对话继续只恢复正文。
      const display: ConversationSelectionDisplayReference = {
        ...(value.path ? { path: value.path } : {}),
        text: value.text,
        ...(value.plan ? { plan: value.plan } : {}),
      };
      return value.comment ? { ...display, comment: value.comment } : display;
    });
  }
  const legacyMatch = text.match(LEGACY_BLOCK_PATTERN);
  if (!legacyMatch) return { visibleContent: text, references: [] };
  return parseConversationSelectionBlock(text, legacyMatch, (value) =>
    isConversationSelectionReference(value) ? value : null,
  );
}

function parseConversationSelectionBlock<T extends ConversationSelectionDisplayReference>(
  text: string,
  match: RegExpMatchArray,
  parseItem: (value: unknown) => T | null,
): { visibleContent: string; references: readonly T[] } {
  try {
    const parsed = JSON.parse(match[1] ?? "[]");
    if (!Array.isArray(parsed)) throw new Error("selection block is not an array");
    const references: T[] = [];
    for (const value of parsed) {
      const reference = parseItem(value);
      if (!reference) throw new Error("invalid selection reference");
      references.push(reference);
    }
    return {
      visibleContent: text.slice(0, match.index).trimEnd(),
      references,
    };
  } catch {
    return { visibleContent: text, references: [] };
  }
}

export function dispatchConversationSelectionAdd(
  detail: ConversationSelectionAddRequest,
): ConversationSelectionAppendResult {
  const current = getConversationSelectionReferenceScope(
    detail.targetSessionId,
    detail.workspaceKey,
  );
  const result = appendConversationSelectionReference(current, detail.reference);
  if (result.ok) {
    setConversationSelectionReferenceScope(
      detail.targetSessionId,
      detail.workspaceKey,
      result.references,
    );
  } else {
    limitReasonByScope.set(
      referenceScopeKey(detail.targetSessionId, detail.workspaceKey),
      result.reason,
    );
    // 被拒也广播：限流提示是订阅方（composer）要显示的共享事实，写入路径的成功分支
    // 已经由 setConversationSelectionReferenceScope 广播，这里只补失败分支，避免重复通知。
    notifyConversationSelectionChange(detail.targetSessionId, detail.workspaceKey);
  }
  return result;
}

export function isConversationSelectionChangeEvent(
  event: Event,
): event is CustomEvent<ConversationSelectionChangeDetail> {
  return event.type === CHANGE_EVENT && event instanceof CustomEvent;
}

export function getConversationSelectionChangeEventName(): string {
  return CHANGE_EVENT;
}

function isConversationSelectionText(value: unknown): value is ConversationSelectionText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ConversationSelectionText>;
  return (
    typeof candidate.text === "string" &&
    (!("path" in value) ||
      (typeof candidate.path === "string" && candidate.path.trim().length > 0)) &&
    (!("comment" in value) || typeof candidate.comment === "string") &&
    (!("plan" in value) || typeof candidate.plan === "string") &&
    Object.keys(value).every(
      (key) => key === "text" || key === "path" || key === "comment" || key === "plan",
    )
  );
}

export function isConversationSelectionReference(
  value: unknown,
): value is ConversationSelectionReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConversationSelectionReference>;
  if (candidate.contentType === "markdown") {
    return (
      typeof candidate.id === "string" &&
      typeof candidate.text === "string" &&
      typeof candidate.sourceKey === "string" &&
      typeof candidate.sourceTitle === "string"
    );
  }
  return (
    typeof candidate.id === "string" &&
    "sourceSessionId" in candidate &&
    typeof candidate.sourceSessionId === "string" &&
    "sourceRowId" in candidate &&
    typeof candidate.sourceRowId === "number" &&
    typeof candidate.text === "string" &&
    ["user", "assistant", "reasoning", "tool"].includes(candidate.contentType ?? "")
  );
}
