import { memo, useEffect, useMemo, useState } from "react";
import { calculateOutputTps } from "@zcode/shared";
import type { V4ConversationUsageDetailResult } from "@zcode/shared/zcode-protocol-v4";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useSessionUsageDetail } from "@/hooks/useSessionUsageDetail.js";
import { useAppUsageStats } from "@/hooks/useUsageStats.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  formatCompactTokenUsage,
  formatPercent,
} from "@/settings/usage-stats/usageStatsUiParts.js";
import type { UsageSidePaneTab } from "@/lib/workspaceSidePane.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation, V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";

/** 与快照按日分桶同口径的本地日期串（`en-CA` 即 YYYY-MM-DD）。 */
function localDateKey(timeZone: string, now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/**
 * 完成态速度：output ÷ 生成耗时（总耗时减去首 token 前的等待）。
 * 复用 dev 面板同一个 helper，语义是"最近一次完成的请求"，不是流式实时速率。
 */
function resolveOutputTps(
  latest: V4ConversationUsageDetailResult["latestCompletedRequest"],
): number | null {
  if (!latest || latest.durationMs === null || latest.timeToFirstTokenMs === null) return null;
  return calculateOutputTps(latest.outputTokens, latest.durationMs - latest.timeToFirstTokenMs);
}

function MetricCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface px-3 py-2">
      <span className="text-ui-xs text-foreground-subtle">{label}</span>
      <span className="font-mono text-ui-base tabular-nums text-foreground">{value}</span>
      {hint ? <span className="truncate text-ui-xs text-foreground-subtlest">{hint}</span> : null}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-ui-base text-foreground-subtle">{children}</h3>;
}

function EmptyLine({ children }: { children: string }) {
  return <p className="text-ui-sm text-foreground-subtlest">{children}</p>;
}

function NumericCell({ children }: { children: string }) {
  return <td className="py-1 text-right font-mono tabular-nums">{children}</td>;
}

function UsageSidePaneContent({ tab }: { tab: UsageSidePaneTab }) {
  const { intl, locale } = useZCodeIntl();
  const { layer } = useV4Conversation();
  const [lease, setLease] = useState<SessionLease | null>(null);

  useEffect(() => {
    const nextLease = layer.acquire(tab.parentSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, tab.parentSessionId]);
  const projection = useConversationProjection(lease);

  // 刷新键：主轮请求完成恰好让 cumulative.outputTokens 变一次；子代理变化另有 revision。
  // snapshot.revision 不能当键——usage 不属于它的承载字段，这类推送不会 bump 它。
  const refreshKey = `${projection.snapshot?.usage.cumulative.outputTokens ?? 0}:${
    projection.snapshot?.subagents?.revision ?? 0
  }`;
  const { detail, error, loading, unsupported, refresh } = useSessionUsageDetail({
    refreshKey,
    sessionId: tab.parentSessionId,
    workspacePath: tab.workspacePath,
    ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
    ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
  });
  const appUsage = useAppUsageStats("7d");
  const contextWindow = projection.snapshot?.usage.contextWindow ?? null;

  const todayTokens = useMemo(() => {
    if (!appUsage.snapshot) return null;
    const today = localDateKey(appUsage.snapshot.timeZone, Date.now());
    for (const week of appUsage.snapshot.heatmap.weeks) {
      for (const cell of week.days) {
        if (cell && cell.date === today) return cell.totalTokens;
      }
    }
    return null;
  }, [appUsage.snapshot]);

  const contextValue = contextWindow
    ? `${formatCompactTokenUsage(locale, contextWindow.usedTokens)} / ${
        contextWindow.maxTokens === null
          ? "--"
          : formatCompactTokenUsage(locale, contextWindow.maxTokens)
      }`
    : "--";
  const contextHint =
    contextWindow && contextWindow.maxTokens
      ? formatPercent(locale, contextWindow.usedTokens / contextWindow.maxTokens)
      : undefined;
  const tps = resolveOutputTps(detail?.latestCompletedRequest ?? null);
  const tpsValue =
    tps === null
      ? "--"
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(tps)} t/s`;

  return (
    <div
      data-testid="usage-side-pane"
      data-usage-session-id={tab.parentSessionId}
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-background p-4"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-ui-base text-foreground">
          {intl.formatMessage({ id: "sidePane.usage" })}
        </span>
        {/* 保留期口径常驻可见：绝不让界面暗示这是会话历史总量。 */}
        {detail ? (
          <span className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage(
              { id: "sidePane.usageRetention" },
              { days: String(detail.retentionDays) },
            )}
          </span>
        ) : null}
      </div>

      {unsupported ? (
        <p className="text-ui-base text-foreground-subtle" data-usage-unsupported="true">
          {intl.formatMessage({ id: "sidePane.usageUnsupported" })}
        </p>
      ) : null}

      {error ? (
        <div className="flex min-w-0 flex-col gap-2" data-usage-error="true">
          <div className="flex min-w-0 items-center gap-2 text-ui-base text-destructive">
            <TriangleAlertIcon className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              {intl.formatMessage({ id: "sidePane.usageLoadFailed" })}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="w-max rounded-md px-2 py-1 text-ui-sm text-foreground-subtle hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-input-border-focused)]"
          >
            {intl.formatMessage({ id: "common.retry" })}
          </button>
        </div>
      ) : null}

      {loading && !detail ? (
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-foreground-subtle" />
      ) : null}

      {detail ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <MetricCell
              label={intl.formatMessage({ id: "sidePane.usageColumnTotal" })}
              value={formatCompactTokenUsage(locale, detail.billed.totalTokens)}
              hint={intl.formatMessage(
                { id: "sidePane.usageRequests" },
                { count: String(detail.billed.modelRequestCount) },
              )}
            />
            <MetricCell
              label={intl.formatMessage({ id: "chat.statusPanel.usageContext" })}
              value={contextValue}
              {...(contextHint === undefined ? {} : { hint: contextHint })}
            />
            <MetricCell
              label={intl.formatMessage({ id: "chat.statusPanel.usageSpeed" })}
              value={tpsValue}
            />
            <MetricCell
              label={intl.formatMessage({ id: "sidePane.usageToday" })}
              value={todayTokens === null ? "--" : formatCompactTokenUsage(locale, todayTokens)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <SectionTitle>{intl.formatMessage({ id: "sidePane.usageByModel" })}</SectionTitle>
            <table className="w-full border-collapse text-ui-base">
              <thead>
                <tr className="text-ui-xs text-foreground-subtle">
                  <th className="py-1 text-left font-normal">
                    {intl.formatMessage({ id: "chat.toolbar.model.label" })}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {intl.formatMessage({ id: "sidePane.usageColumnInput" })}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {intl.formatMessage({ id: "sidePane.usageColumnOutput" })}
                  </th>
                  <th className="py-1 text-right font-normal">
                    {intl.formatMessage({ id: "sidePane.usageColumnTotal" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.models.map((row) => (
                  <tr key={row.modelId ?? "unknown"} className="text-foreground">
                    <td className="max-w-0 truncate py-1 pr-2 font-mono" title={row.modelId ?? ""}>
                      {row.modelId ?? "--"}
                    </td>
                    <NumericCell>{formatCompactTokenUsage(locale, row.inputTokens)}</NumericCell>
                    <NumericCell>{formatCompactTokenUsage(locale, row.outputTokens)}</NumericCell>
                    <NumericCell>{formatCompactTokenUsage(locale, row.totalTokens)}</NumericCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <SectionTitle>{intl.formatMessage({ id: "sidePane.usageTools" })}</SectionTitle>
            {detail.tools.length === 0 ? (
              <EmptyLine>{intl.formatMessage({ id: "sidePane.usageNoTools" })}</EmptyLine>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {detail.tools.map((row) => (
                  <li
                    key={row.toolName}
                    className="flex min-w-0 items-center gap-2 text-ui-base text-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono" title={row.toolName}>
                      {row.toolName}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{row.callCount}</span>
                    {row.errorCount > 0 ? (
                      <span className="shrink-0 font-mono tabular-nums text-destructive">
                        {intl.formatMessage(
                          { id: "sidePane.usageToolErrors" },
                          { count: String(row.errorCount) },
                        )}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <SectionTitle>{intl.formatMessage({ id: "sidePane.usageSubagents" })}</SectionTitle>
            {detail.subagents.children.length === 0 ? (
              <EmptyLine>{intl.formatMessage({ id: "sidePane.usageNoSubagents" })}</EmptyLine>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {detail.subagents.children.map((row) => (
                  <li
                    key={row.sessionId}
                    className="flex min-w-0 items-center gap-2 text-ui-base text-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate" title={row.title ?? row.sessionId}>
                      {row.title ?? row.sessionId}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {formatCompactTokenUsage(locale, row.totalTokens)}
                    </span>
                  </li>
                ))}
                <li className="flex min-w-0 items-center gap-2 text-ui-sm text-foreground-subtle">
                  <span className="min-w-0 flex-1 truncate">
                    {intl.formatMessage({ id: "sidePane.usageSubagentTotal" })}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatCompactTokenUsage(locale, detail.subagents.totalTokens)}
                  </span>
                </li>
              </ul>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <SectionTitle>{intl.formatMessage({ id: "sidePane.usageRecent" })}</SectionTitle>
            <ul className="flex min-w-0 flex-col gap-1">
              {detail.recentRequests.map((row) => (
                <li
                  key={row.requestId}
                  className="flex min-w-0 items-center gap-2 text-ui-sm text-foreground"
                >
                  <span className="shrink-0 font-mono text-foreground-subtle">
                    {row.completedAt === null
                      ? "--"
                      : new Intl.DateTimeFormat(locale, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(row.completedAt))}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono" title={row.modelId ?? ""}>
                    {row.modelId ?? "--"}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatCompactTokenUsage(locale, row.totalTokens)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      {!loading && !detail && !error && !unsupported ? (
        <EmptyLine>{intl.formatMessage({ id: "sidePane.usageEmpty" })}</EmptyLine>
      ) : null}
    </div>
  );
}

export const UsageSidePane = memo(function UsageSidePane({ tab }: { tab: UsageSidePaneTab }) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  return (
    <V4PaneConversationProvider scope={scope}>
      <UsageSidePaneContent tab={tab} />
    </V4PaneConversationProvider>
  );
});
