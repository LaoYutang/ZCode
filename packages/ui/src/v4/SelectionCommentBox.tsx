import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useAnchoredPopupPosition } from "@/hooks/useAnchoredPopupPosition.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatCommandShortcutLabel, matchesPrimaryShortcut } from "@/lib/keyboardShortcuts.js";

interface SelectionCommentAnchor {
  center: number;
  top: number;
  bottom: number;
}

/**
 * 选区评论输入态。打开期间调用方必须停用实时选区监听：浮层获得焦点后 DOM 选区塌陷，
 * 实时 hook 的 selectionchange/keyup 会在打字过程中把浮层卸掉，因此这里只依赖冻结的锚点与引文。
 */
export function SelectionCommentBox({
  anchor,
  quotedText,
  onSubmit,
  onClose,
}: {
  anchor: SelectionCommentAnchor;
  quotedText: string;
  onSubmit: (comment: string) => void;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const ref = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState("");
  useAnchoredPopupPosition(ref, { center: anchor.center, top: anchor.top, bottom: anchor.bottom });
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node | null)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);
  useEffect(() => {
    // 快捷键挂在 document 而不是 textarea 上：点到浮层空白处会让焦点离开输入框，
    // 挂在输入框上的话 Esc 与提交键会静默失效。
    const handleKeyDown = (event: KeyboardEvent) => {
      // 组合态下的 Enter/Escape 属于输入法（确认候选、取消候选），不能当成提交或关闭。
      if (event.isComposing) return;
      if (matchesPrimaryShortcut(event, "Enter")) {
        event.preventDefault();
        onSubmit(comment);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [comment, onClose, onSubmit]);
  return createPortal(
    <div
      ref={ref}
      data-selection-comment-box="true"
      style={{ left: 12, top: 12 }}
      className="fixed z-50 flex w-96 max-w-[calc(100vw-24px)] flex-col gap-2 rounded-lg border border-popover-border bg-menu p-2 shadow-md"
    >
      <div className="line-clamp-3 border-l-2 border-border pl-2 text-ui-sm break-words whitespace-pre-wrap text-foreground-subtle">
        {quotedText}
      </div>
      <Textarea
        autoFocus
        rows={3}
        value={comment}
        onChange={(event) => setComment(event.currentTarget.value)}
        placeholder={intl.formatMessage({ id: "chat.selections.commentPlaceholder" })}
        className="min-h-14 text-ui-base"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-ui-sm text-foreground-subtlest">
          {formatCommandShortcutLabel("↵")}
        </span>
        <Button type="button" onClick={() => onSubmit(comment)}>
          {intl.formatMessage({ id: "chat.selections.commentSubmit" })}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
