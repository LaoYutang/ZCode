import { SelectionActionMenu } from "@/v4/SelectionActionMenu.js";
import { SelectionCommentBox } from "@/v4/SelectionCommentBox.js";
import {
  buildSelectionSideChatKey,
  getSelectionSideChatOpenState,
  requestSelectionSideChatOpen,
  subscribeSelectionSideChatRuntime,
} from "@/lib/selectionSideChatRuntime.js";
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useTextSelection } from "@/hooks/useTextSelection.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { hasExcludedConversationSelectionEndpoint } from "@/lib/conversationSelectionGuard.js";
import {
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  dispatchConversationSelectionAdd,
  createConversationSelectionReference,
  type MarkdownSelectionTarget,
} from "@/lib/conversationSelectionReference.js";

interface CommentDraft {
  center: number;
  bottom: number;
  top: number;
  text: string;
}

export function MarkdownSelectionTooltip({
  rootRef,
  sourceKey,
  sourceTitle,
  sourcePath,
  planText,
  target,
  scopeKey,
}: {
  scopeKey: object;
  rootRef: RefObject<HTMLDivElement | null>;
  sourceKey: string;
  sourceTitle: string;
  sourcePath?: string;
  /** 引用所在文档的正文快照（计划 tab 传整份计划）：只给 path 时模型不会主动去读文件。 */
  planText?: string;
  target: MarkdownSelectionTarget;
}) {
  const { intl } = useZCodeIntl();
  const inspect = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const element = (node: Node) => (node instanceof Element ? node : node.parentElement);
    if (
      hasExcludedConversationSelectionEndpoint(
        element(range.startContainer),
        element(range.endContainer),
      )
    )
      return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { text, top: rect.top, bottom: rect.bottom, center: rect.left + rect.width / 2 };
  }, [rootRef]);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const { state, close } = useTextSelection({
    rootRef,
    // 输入态停用实时监听：浮层获焦后选区塌陷，否则打字过程中浮层会被实时 hook 卸掉。
    enabled: !commentDraft,
    inspect,
    scopeKey,
    observeSelectionChange: true,
  });
  useEffect(() => {
    setCommentDraft(null);
  }, [scopeKey]);
  const sideKey = target.sessionId
    ? buildSelectionSideChatKey(target.workspaceKey, target.sessionId)
    : null;
  const sideState = useSyncExternalStore(
    subscribeSelectionSideChatRuntime,
    () => (sideKey ? getSelectionSideChatOpenState(sideKey) : "unavailable"),
    () => "unavailable",
  );
  // 计划正文快照随引用进尾块：辅助对话的 fork 历史只到上一轮，模型不会主动按 path 读文件。
  const planField = planText ? { plan: planText } : {};

  if (commentDraft) {
    return (
      <SelectionCommentBox
        anchor={commentDraft}
        quotedText={commentDraft.text}
        onSubmit={(comment) => {
          const trimmedComment = comment.trim();
          dispatchConversationSelectionAdd({
            targetSessionId: target.sessionId,
            workspaceKey: target.workspaceKey,
            reference: createConversationSelectionReference({
              contentType: "markdown",
              sourceKey,
              sourceTitle,
              path: sourcePath,
              text: commentDraft.text,
              ...planField,
              ...(trimmedComment ? { comment: trimmedComment } : {}),
            }),
          });
          setCommentDraft(null);
          close();
        }}
        onClose={() => {
          setCommentDraft(null);
          close();
        }}
      />
    );
  }

  if (!state) return null;
  const createReference = () =>
    createConversationSelectionReference({
      contentType: "markdown",
      sourceKey,
      sourceTitle,
      path: sourcePath,
      text: state.text,
      ...planField,
    });
  return (
    <SelectionActionMenu
      center={state.center}
      top={state.top}
      bottom={state.bottom}
      singleLimit={state.text.length > CONVERSATION_SELECTION_MAX_TEXT_LENGTH}
      sideActionDisabled={sideState !== "ready"}
      sideDisabledTitle={
        sideState === "ready"
          ? undefined
          : intl.formatMessage({
              id:
                sideState === "blocked"
                  ? "chat.selections.previewSideBlocked"
                  : "chat.selections.previewSideUnavailable",
            })
      }
      onComment={() => {
        setCommentDraft({
          center: state.center,
          top: state.top,
          bottom: state.bottom,
          text: state.text,
        });
      }}
      onAskInSideChat={() => {
        if (sideKey && requestSelectionSideChatOpen(sideKey, createReference())) close();
      }}
    />
  );
}
