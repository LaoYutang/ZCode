import { RefreshCcw } from "lucide-react";
import { Fragment, lazy, useState } from "react";
import { APP_USAGE_RANGES } from "@zcode/shared";
import type { AppUsageRange, AppUsageSnapshot } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useAppUsageStats } from "@/hooks/useUsageStats.js";
import { UsageChartLoadBoundary } from "@/settings/usage-stats/UsageChartLoadBoundary.js";
import { UsageHeatmap } from "@/settings/usage-stats/UsageHeatmap.js";
import { UsageStatsErrorNotice } from "@/settings/usage-stats/UsageStatsErrorNotice.js";
import {
  USAGE_STATS_TABS_LIST_CLASS,
  USAGE_STATS_TABS_TRIGGER_CLASS,
  UsageEmptyState,
  formatCompactNumber,
  formatCompactTokenUsage,
  formatFullDay,
  formatPercent,
} from "@/settings/usage-stats/usageStatsUiParts.js";

// Recharts 会在模块初始化阶段触发 decimal.js-light 的 LN10 校验，
// 在 Electron Linux 容器里会阻断整个 renderer 启动。图表按需加载后，
// 普通启动和 e2e 首页不会被 Usage 页图表依赖影响，打开 Usage 时也由局部边界隔离。
const AppUsageDailyModelTrendChart = lazy(() =>
  import("@/settings/usage-stats/AppUsageDailyModelTrendChart.js").then((module) => ({
    default: module.AppUsageDailyModelTrendChart,
  })),
);
const AppUsageModelUsagePieChart = lazy(() =>
  import("@/settings/usage-stats/AppUsageModelUsagePieChart.js").then((module) => ({
    default: module.AppUsageModelUsagePieChart,
  })),
);

export function AppUsagePanel() {
  const { intl, locale } = useZCodeIntl();
  const [range, setRange] = useState<AppUsageRange>("7d");
  const { snapshot: lifetimeSnapshot, refresh: refreshLifetime } = useAppUsageStats("all");
  const { snapshot, loading, error, refresh } = useAppUsageStats(range);

  if (loading && !snapshot) {
    return (
      <div className="space-y-5">
        <AppUsageTodaySection snapshot={lifetimeSnapshot} />
        <AppUsageOverviewStrip snapshot={lifetimeSnapshot} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
          </div>
          <AppUsageRangeTabs range={range} onRangeChange={setRange} />
        </div>
        {/* App Usage 只聚合本地 session 历史，不能复用 Coding Plan 的 monitor API 加载说明。*/}
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.loadingTitle" })}
          description={intl.formatMessage({
            id: "settings.usage.appUsageLoadingDescription",
          })}
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-5">
        <AppUsageTodaySection snapshot={lifetimeSnapshot} />
        <AppUsageOverviewStrip snapshot={lifetimeSnapshot} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
          </div>
          <AppUsageRangeTabs range={range} onRangeChange={setRange} />
        </div>
        {error ? <UsageStatsErrorNotice error={error} /> : null}
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usage.emptyTitle" })}
          description={intl.formatMessage({
            id: "settings.usage.emptyDescription",
          })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AppUsageTodaySection snapshot={lifetimeSnapshot} />
      <AppUsageOverviewStrip snapshot={lifetimeSnapshot} />
      {lifetimeSnapshot?.heatmap.weeks.length ? (
        <UsageHeatmap locale={locale} intl={intl} weeks={lifetimeSnapshot.heatmap.weeks} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.usage.appUsageRangeTitle" })}
        </div>
        <AppUsageRangeTabs range={range} onRangeChange={setRange} />
      </div>
      {error ? <UsageStatsErrorNotice error={error} /> : null}

      <UsageChartLoadBoundary
        scope="settings.usage.app-daily-model-chart"
        resetKeys={[snapshot.range, snapshot.generatedAt]}
        loadingDescription={intl.formatMessage({
          id: "settings.usage.appUsageLoadingDescription",
        })}
      >
        <AppUsageDailyModelTrendChart snapshot={snapshot} />
      </UsageChartLoadBoundary>
      <UsageChartLoadBoundary
        scope="settings.usage.app-model-pie-chart"
        resetKeys={[snapshot.range, snapshot.generatedAt, "model-pie"]}
        loadingDescription={intl.formatMessage({
          id: "settings.usage.appUsageLoadingDescription",
        })}
      >
        <AppUsageModelUsagePieChart snapshot={snapshot} />
      </UsageChartLoadBoundary>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 rounded-md bg-background"
          onClick={() => {
            void Promise.all([refresh(), refreshLifetime()]);
          }}
        >
          <RefreshCcw className="size-3.5" />
          {intl.formatMessage({ id: "settings.usage.refresh" })}
        </Button>
      </div>
    </div>
  );
}

/**
 * 今日用量（本机本地日，跨会话合计）。
 *
 * 口径来自快照的 `today` 分块，与热力图"当日"格子同源（同一个按日聚合的 `dayIndex`）。
 * `today` 是可选分块：旧宿主不返回时整块显示 `--` 并给出提示，**不用区间数字冒充今日**
 * ——同一屏出现两个"今日"比不显示更糟。
 */
function AppUsageTodaySection({ snapshot }: { snapshot: AppUsageSnapshot | null }) {
  const { intl, locale } = useZCodeIntl();
  const today = snapshot?.today ?? null;
  // 值为 undefined 只可能是"宿主没给这个分块"，0 是真实的零，两者不能混。
  const tokens = (value: number | undefined): string =>
    value === undefined ? "--" : formatCompactTokenUsage(locale, value);
  const count = (value: number | undefined): string =>
    value === undefined ? "--" : formatCompactNumber(locale, value);

  const items = [
    {
      key: "total",
      label: intl.formatMessage({ id: "settings.usage.todayTotalTokens" }),
      value: tokens(today?.totalTokens),
      primary: true,
    },
    {
      key: "input",
      label: intl.formatMessage({ id: "settings.usage.todayInputTokens" }),
      value: tokens(today?.inputTokens),
    },
    {
      key: "output",
      label: intl.formatMessage({ id: "settings.usage.todayOutputTokens" }),
      value: tokens(today?.outputTokens),
    },
    {
      key: "cache-read",
      label: intl.formatMessage({ id: "settings.usage.todayCacheReadTokens" }),
      value: tokens(today?.cacheReadTokens),
    },
    {
      key: "cache-creation",
      label: intl.formatMessage({ id: "settings.usage.todayCacheCreationTokens" }),
      value: tokens(today?.cacheCreationTokens),
    },
    {
      key: "cache-hit-rate",
      label: intl.formatMessage({ id: "settings.usage.cacheHitRate" }),
      value: today ? formatPercent(locale, today.cacheHitRate) : "--",
    },
    {
      key: "requests",
      label: intl.formatMessage({ id: "settings.usage.todayRequests" }),
      value: count(today?.modelRequestCount),
    },
    {
      key: "tool-calls",
      label: intl.formatMessage({ id: "settings.usage.todayToolCalls" }),
      value: count(today?.toolCallCount),
    },
  ];

  return (
    <section className="rounded-xl bg-surface px-3 py-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.usage.todayTitle" })}
        </h3>
        {today ? (
          <span className="text-ui-sm text-foreground-subtle">
            {formatFullDay(locale, today.date)}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.key} className="min-w-0 rounded-lg bg-card px-3 py-2">
            <dt className="truncate text-ui-sm text-foreground-subtle">{item.label}</dt>
            <dd
              className={cn(
                "mt-1 truncate font-mono tabular-nums text-foreground",
                item.primary ? "text-ui-lg font-medium" : "text-ui-base",
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {snapshot && !today ? (
        <p className="mt-2 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.todayUnavailable" })}
        </p>
      ) : null}
    </section>
  );
}

/**
 * 累计概览。
 *
 * 只保留跨区间能解释的四项。原先的"最长聊天时长 / 当前连续天数 / 最长连续天数"已删除：
 * 三者都不指向可行动的信息，也不改善任何决策。
 */
function AppUsageOverviewStrip({ snapshot }: { snapshot: AppUsageSnapshot | null }) {
  const { intl, locale } = useZCodeIntl();
  const items = [
    {
      label: intl.formatMessage({ id: "settings.usage.lifetimeTotalTokens" }),
      value: snapshot ? formatCompactTokenUsage(locale, snapshot.summary.totalTokens) : "--",
    },
    {
      label: intl.formatMessage({ id: "settings.usage.lifetimePeakTokens" }),
      value: snapshot ? formatCompactTokenUsage(locale, snapshot.summary.peakDayTokens) : "--",
    },
    {
      label: intl.formatMessage({ id: "settings.usage.activeDays" }),
      value: snapshot ? formatCompactNumber(locale, snapshot.summary.activeDays) : "--",
    },
    {
      label: intl.formatMessage({ id: "settings.usage.sessions" }),
      value: snapshot ? formatCompactNumber(locale, snapshot.summary.totalSessions) : "--",
    },
  ];

  return (
    <section className="rounded-xl bg-surface px-3 py-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.usage.summaryTitle" })}
        </h3>
        {/* 用量库受保留期约束（每次写入都会 prune），文案不承诺历史总量。 */}
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usage.summaryRetentionHint" })}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center">
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 ? (
              <div aria-hidden="true" className="hidden h-7 w-px bg-border sm:block" />
            ) : null}
            <div className="min-w-0 flex-1 py-1 text-center sm:py-0">
              <div className="truncate font-mono text-ui-lg font-medium tabular-nums text-foreground">
                {item.value}
              </div>
              <div className="mt-1 truncate text-ui-base text-foreground-subtle">{item.label}</div>
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function AppUsageRangeTabs({
  range,
  onRangeChange,
}: {
  range: AppUsageRange;
  onRangeChange: (range: AppUsageRange) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Tabs
      value={range}
      onValueChange={(value) => onRangeChange(value as AppUsageRange)}
      className="shrink-0"
    >
      <TabsList className={USAGE_STATS_TABS_LIST_CLASS}>
        {APP_USAGE_RANGES.filter((option) => option !== "all").map((option) => (
          <TabsTrigger key={option} value={option} className={USAGE_STATS_TABS_TRIGGER_CLASS}>
            {intl.formatMessage({ id: `settings.usage.range.${option}` })}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
