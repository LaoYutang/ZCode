import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { extractPlanToolCallContent, resolvePlanSelectionSource } from "@/lib/planToolCall.js";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import type { PlanDetailSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import { MarkdownSelectionTooltip } from "@/v4/MarkdownSelectionTooltip.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation, V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";

const PlanDetailContent = memo(function PlanDetailContent({
  tab,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: {
  tab: PlanDetailSidePaneTab;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}) {
  const { intl } = useZCodeIntl();
  const { layer } = useV4Conversation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [lease, setLease] = useState<SessionLease | null>(null);
  const [lastMarkdown, setLastMarkdown] = useState(tab.markdown);
  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");
  const codePreviewSettings = useZCodeStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );

  useEffect(() => {
    const nextLease = layer.acquire(tab.parentSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, tab.parentSessionId]);
  const state = useConversationProjection(lease);

  const liveMarkdown = useMemo(() => {
    const row = state.snapshot?.rows.window.find(
      (candidate) => candidate.kind === "toolCall" && candidate.toolCallId === tab.toolCallId,
    );
    if (!row || row.kind !== "toolCall") return undefined;
    const node = toolCallRowToLegacyNode(row);
    return extractPlanToolCallContent(node.toolCall, tab.workspacePath).markdown;
  }, [state.snapshot, tab.toolCallId, tab.workspacePath]);

  useEffect(() => {
    if (liveMarkdown) setLastMarkdown(liveMarkdown);
  }, [liveMarkdown]);
  useEffect(() => {
    if (tab.markdown) setLastMarkdown(tab.markdown);
  }, [tab.markdown]);

  const markdown = liveMarkdown ?? lastMarkdown;
  // 引用目标从 tab 自身推导：侧栏 tab 的可见性本就按 `parentSessionId === 当前任务` 收窄，
  // 工作区 key 又与 composer 同源，因此引用必然落回计划所属对话的输入区。
  const selectionTarget = useMemo(
    () => ({
      sessionId: tab.parentSessionId,
      workspaceKey: buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity),
    }),
    [tab.parentSessionId, tab.workspaceIdentity, tab.workspacePath],
  );
  const selectionSource = resolvePlanSelectionSource({
    parentSessionId: tab.parentSessionId,
    toolCallId: tab.toolCallId,
    markdown,
    ...(tab.planFilePath ? { planFilePath: tab.planFilePath } : {}),
    fallbackTitle: intl.formatMessage({ id: "planTool.panel.planTab" }),
  });
  const selectionScope = useMemo(
    () => ({}),
    // 只随来源重建，不随正文：正文来自 live 投影，若把 markdown 算进依赖，
    // 计划流式输出的每次增量都会丢弃刚建立的选区快照。
    [selectionSource.sourceKey, selectionSource.path],
  );
  return (
    <div
      ref={rootRef}
      data-plan-detail-tool-call-id={tab.toolCallId}
      className="h-full min-h-0 overflow-y-auto bg-background px-4 py-4"
    >
      <MarkdownSelectionTooltip
        scopeKey={selectionScope}
        rootRef={rootRef}
        sourceKey={selectionSource.sourceKey}
        sourceTitle={selectionSource.sourceTitle}
        sourcePath={selectionSource.path}
        target={selectionTarget}
      />
      <MessageResponse
        className="mx-auto w-full max-w-4xl min-w-0 break-words text-foreground"
        workspacePath={tab.workspacePath}
        theme={theme}
        codePreviewSettings={codePreviewSettings}
        onOpenCodeViewer={onOpenCodeViewer}
        onOpenFileLink={onOpenFileLink}
        onOpenExternalUrl={onOpenBrowserUrl}
      >
        {markdown}
      </MessageResponse>
    </div>
  );
});

export const PlanDetailSidePane = memo(function PlanDetailSidePane({
  tab,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: {
  tab: PlanDetailSidePaneTab;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  return (
    // provider 接口已收敛为仅按 scope 做连接路由，不再接受
    // isShellWorkspace 参数；side pane 不需要额外的 shell 身份分支。
    <V4PaneConversationProvider scope={scope}>
      <PlanDetailContent
        tab={tab}
        onOpenBrowserUrl={onOpenBrowserUrl}
        onOpenCodeViewer={onOpenCodeViewer}
        onOpenFileLink={onOpenFileLink}
      />
    </V4PaneConversationProvider>
  );
});
