import { SelectionActionMenu } from "@/v4/SelectionActionMenu.js";
import { SelectionCommentBox } from "@/v4/SelectionCommentBox.js";
import { useTextSelection } from "@/hooks/useTextSelection.js";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  createConversationSelectionReference,
  type ConversationSelectionContentType,
  type ConversationSelectionReference,
} from "@/lib/conversationSelectionReference.js";
import {
  guardConversationSelectionCandidate,
  hasExcludedConversationSelectionEndpoint,
} from "@/lib/conversationSelectionGuard.js";

interface TooltipState {
  center: number;
  bottom: number;
  top: number;
  reference?: ConversationSelectionReference;
  error?: "single";
}

/** 输入态冻结的选区：浮层获焦后实时选区已失效，渲染只能依赖这份快照。 */
interface CommentDraft {
  center: number;
  bottom: number;
  top: number;
  reference: ConversationSelectionReference;
}

const SELECTABLE_SELECTOR = "[data-conversation-selectable]";

function contentTypeForRow(row: ConversationRow): ConversationSelectionContentType | null {
  if (row.kind === "userInput") return "user";
  if (row.kind === "assistantText") return "assistant";
  if (row.kind === "reasoning") return "reasoning";
  if (row.kind === "toolCall") return "tool";
  return null;
}

function closestRowElement(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-row-id]") ?? null;
}

export function ConversationSelectionTooltip({
  rootRef,
  rows,
  sourceSessionId,
  enabled,
  sideActionDisabled,
  onAddToCurrentTask,
  onAskInSideChat,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  rows: readonly ConversationRow[];
  sourceSessionId: string;
  enabled: boolean;
  sideActionDisabled?: boolean;
  onAddToCurrentTask: (reference: ConversationSelectionReference) => void;
  onAskInSideChat: (reference: ConversationSelectionReference) => void;
}) {
  const { intl } = useZCodeIntl();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const inspectSelection = useCallback((): TooltipState | null => {
    if (!enabled) return null;
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const startRow = closestRowElement(range.startContainer);
    const endRow = closestRowElement(range.endContainer);
    if (!startRow || !endRow) return null;
    const startElement =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    // 普通 Markdown 跨选到表格单元格时，Range.cloneContents() 会把 DOM 顺序中夹着的
    // select-none 表格工具栏按钮一并克隆，若据此判断会把合法正文误判为控件选区。控件门禁只看
    // Selection 两个端点；跨 row / selectable region 仍由下面的独立 guard 拒绝。
    const excluded = hasExcludedConversationSelectionEndpoint(startElement, endElement);
    const startContent = startElement?.closest(SELECTABLE_SELECTOR);
    const endContent = endElement?.closest(SELECTABLE_SELECTOR);
    const rowId = Number(startRow.dataset.rowId);
    const row = rowsRef.current.find((candidate) => candidate.rowId === rowId);
    const contentType = row ? contentTypeForRow(row) : null;
    const text = selection.toString().trim();
    const rect = range.getBoundingClientRect();
    const guardResult = guardConversationSelectionCandidate({
      enabled,
      sameRow: startRow === endRow,
      insideTimeline: root.contains(startRow),
      excluded,
      sameSelectableRegion: Boolean(
        startContent && startContent === endContent && startRow.contains(startContent),
      ),
      supportedContent: contentType !== null,
      text,
      hasLayout: rect.width > 0 || rect.height > 0,
    });
    if (guardResult === "ineligible" || !contentType) return null;
    const position = {
      center: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
    };
    if (guardResult === "single-limit") {
      return { ...position, error: "single" };
    }
    return {
      ...position,
      reference: createConversationSelectionReference({
        sourceSessionId,
        sourceRowId: rowId,
        contentType,
        text,
      }),
    };
  }, [enabled, rootRef, sourceSessionId]);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const { state, close } = useTextSelection({
    rootRef,
    // 输入态停用实时监听：见 CommentDraft 注释，打字本身会让实时选区失效并卸掉浮层。
    enabled: enabled && !commentDraft,
    inspect: inspectSelection,
    scopeKey: sourceSessionId,
  });
  useEffect(() => {
    setCommentDraft(null);
  }, [enabled, sourceSessionId]);

  if (commentDraft) {
    return (
      <SelectionCommentBox
        anchor={commentDraft}
        quotedText={commentDraft.reference.text}
        onSubmit={(comment) => {
          const trimmedComment = comment.trim();
          onAddToCurrentTask(
            trimmedComment
              ? { ...commentDraft.reference, comment: trimmedComment }
              : commentDraft.reference,
          );
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
  return (
    <SelectionActionMenu
      center={state.center}
      top={state.top}
      bottom={state.bottom}
      singleLimit={Boolean(state.error)}
      sideActionDisabled={sideActionDisabled}
      sideDisabledTitle={intl.formatMessage({ id: "chat.selections.sideBlocked" })}
      onComment={() => {
        if (!state.reference) return;
        setCommentDraft({
          center: state.center,
          top: state.top,
          bottom: state.bottom,
          reference: state.reference,
        });
      }}
      onAskInSideChat={() => {
        if (state.reference) onAskInSideChat(state.reference);
        close();
      }}
    />
  );
}
