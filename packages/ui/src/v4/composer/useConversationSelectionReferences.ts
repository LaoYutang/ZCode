import { useCallback, useEffect, useState } from "react";
import {
  clearConversationSelectionReferenceLimitReason,
  getConversationSelectionReferenceScope,
  getConversationSelectionReferenceLimitReason,
  getConversationSelectionChangeEventName,
  isConversationSelectionChangeEvent,
  setConversationSelectionReferenceScope,
  type ConversationSelectionLimitReason,
  type ConversationSelectionReference,
} from "@/lib/conversationSelectionReference.js";

export function useConversationSelectionReferences(options: {
  sessionId: string | null;
  workspaceKey: string;
}) {
  const [references, setReferencesState] = useState<readonly ConversationSelectionReference[]>(() =>
    getConversationSelectionReferenceScope(options.sessionId, options.workspaceKey),
  );
  const [limitReason, setLimitReason] = useState<ConversationSelectionLimitReason | null>(() =>
    getConversationSelectionReferenceLimitReason(options.sessionId, options.workspaceKey),
  );

  useEffect(() => {
    setReferencesState(
      getConversationSelectionReferenceScope(options.sessionId, options.workspaceKey),
    );
    setLimitReason(
      getConversationSelectionReferenceLimitReason(options.sessionId, options.workspaceKey),
    );
  }, [options.sessionId, options.workspaceKey]);

  const setReferences = useCallback(
    (
      update:
        | readonly ConversationSelectionReference[]
        | ((
            current: readonly ConversationSelectionReference[],
          ) => readonly ConversationSelectionReference[]),
    ) => {
      setReferencesState((current) => {
        const next = typeof update === "function" ? update(current) : update;
        setConversationSelectionReferenceScope(options.sessionId, options.workspaceKey, next);
        return next;
      });
    },
    [options.sessionId, options.workspaceKey],
  );

  useEffect(() => {
    // 订阅的是变更广播而不是「新增」事件：同一个 scope 可能有多个挂载中的消费方
    // （例如计划确认期间被隐藏的 composer 与确认卡片），任一方的写入或移除都要让另一方看到。
    const handleChange = (event: Event) => {
      if (!isConversationSelectionChangeEvent(event)) return;
      if (
        event.detail.sessionId !== options.sessionId ||
        event.detail.workspaceKey !== options.workspaceKey
      ) {
        return;
      }
      setReferencesState(
        getConversationSelectionReferenceScope(options.sessionId, options.workspaceKey),
      );
      setLimitReason(
        getConversationSelectionReferenceLimitReason(options.sessionId, options.workspaceKey),
      );
    };
    window.addEventListener(getConversationSelectionChangeEventName(), handleChange);
    return () =>
      window.removeEventListener(getConversationSelectionChangeEventName(), handleChange);
  }, [options.sessionId, options.workspaceKey]);

  const removeReference = useCallback(
    (id: string) => {
      setReferences((current) => current.filter((reference) => reference.id !== id));
      setLimitReason(null);
    },
    [setReferences],
  );
  const clearReferences = useCallback(() => {
    setReferences([]);
    setLimitReason(null);
  }, [setReferences]);
  const dismissLimitReason = useCallback(() => {
    clearConversationSelectionReferenceLimitReason(options.sessionId, options.workspaceKey);
    setLimitReason(null);
  }, [options.sessionId, options.workspaceKey]);

  return {
    references,
    limitReason,
    dismissLimitReason,
    removeReference,
    clearReferences,
  };
}
