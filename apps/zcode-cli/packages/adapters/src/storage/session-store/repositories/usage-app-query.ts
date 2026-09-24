/**
 * 全应用用量聚合（设置 → 用量）：按时间窗汇总模型、工具、轮次与本地日分桶。
 *
 * usage.ts 拆分的产物（原文件顶到 oxlint max-lines 上限）。口径与另外两个读面不同：只按时间窗
 * 过滤、不按 status 过滤，所以数字不与 querySessionUsageDetail 互相校验。
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  AppUsageDayModelRow,
  AppUsageDayRow,
  AppUsageModelRow,
  AppUsageQueryInput,
  AppUsageQueryResult,
  AppUsageToolRow,
} from "@zcode/contracts";

// 说明：按本地日归桶用固定偏移 tzOffsetMs，dayIndex = floor((started_at + off)/DAY)。
// DST 跨日边界存在最多 1 小时误差，对用量统计可接受。
export async function queryAppUsage(
  db: DatabaseSync,
  input: AppUsageQueryInput,
): Promise<AppUsageQueryResult> {
  const { since, until, tzOffsetMs } = input;
  const DAY_MS = 86_400_000;

  const totals = db
    .prepare(
      `select
         coalesce(sum(computed_total_tokens), 0) as totalTokens,
         coalesce(sum(input_tokens), 0) as inputTokens,
         coalesce(sum(output_tokens), 0) as outputTokens,
         coalesce(sum(reasoning_tokens), 0) as reasoningTokens,
         coalesce(sum(cache_creation_input_tokens), 0) as cacheCreationTokens,
         coalesce(sum(cache_read_input_tokens), 0) as cacheReadTokens,
         count(*) as modelRequestCount,
         coalesce(sum(case when status = 'error' then 1 else 0 end), 0) as modelErrorCount,
         avg(time_to_first_token_ms) as avgTimeToFirstTokenMs
       from model_usage
       where started_at >= ? and started_at <= ?`,
    )
    .get(since, until) as Record<string, number | null>;

  const turnTotals = db
    .prepare(
      `select
         count(distinct session_id) as totalSessions,
         count(*) as totalTurns,
         avg(case when status = 'completed' then duration_ms else null end) as avgTurnDurationMs
       from turn_usage
       where started_at >= ? and started_at <= ?`,
    )
    .get(since, until) as Record<string, number | null>;
  const longestSession = db
    .prepare(
      `select coalesce(max(sessionDurationMs), 0) as longestSessionMs
       from (
         select coalesce(sum(case when status = 'completed' then duration_ms else 0 end), 0)
           as sessionDurationMs
         from turn_usage
         where started_at >= ? and started_at <= ?
         group by session_id
       )`,
    )
    .get(since, until) as Record<string, number | null>;

  const toolTotals = db
    .prepare(
      `select
         count(*) as toolCallCount,
         coalesce(sum(case when status = 'error' then 1 else 0 end), 0) as toolErrorCount
       from tool_usage
       where started_at >= ? and started_at <= ?`,
    )
    .get(since, until) as Record<string, number>;

  const models = db
    .prepare(
      `select
         model_id as modelId,
         coalesce(sum(computed_total_tokens), 0) as totalTokens,
         coalesce(sum(input_tokens), 0) as inputTokens,
         coalesce(sum(output_tokens), 0) as outputTokens,
         count(*) as requestCount
       from model_usage
       where started_at >= ? and started_at <= ?
       group by model_id
       order by totalTokens desc`,
    )
    .all(since, until) as unknown as AppUsageModelRow[];

  const tools = db
    .prepare(
      `select
         tool_name as toolName,
         count(*) as callCount,
         coalesce(sum(case when status = 'error' then 1 else 0 end), 0) as errorCount,
         avg(duration_ms) as avgDurationMs
       from tool_usage
       where started_at >= ? and started_at <= ?
       group by tool_name
       order by callCount desc`,
    )
    .all(since, until) as unknown as AppUsageToolRow[];

  // 按本地日聚合：这里一次算齐当日的 token 拆分与请求数，供 usage-stats-builder 从中
  // 取出 `today` 分块。不要为"今日"另开一条 SQL——同一个 dayIndex 出现两套口径就会分叉。
  const days = db
    .prepare(
      `select
         cast((started_at + ?) / ? as integer) as dayIndex,
         coalesce(sum(computed_total_tokens), 0) as totalTokens,
         coalesce(sum(input_tokens), 0) as inputTokens,
         coalesce(sum(output_tokens), 0) as outputTokens,
         coalesce(sum(reasoning_tokens), 0) as reasoningTokens,
         coalesce(sum(cache_creation_input_tokens), 0) as cacheCreationTokens,
         coalesce(sum(cache_read_input_tokens), 0) as cacheReadTokens,
         count(*) as modelRequestCount
       from model_usage
       where started_at >= ? and started_at <= ?
       group by dayIndex`,
    )
    .all(tzOffsetMs, DAY_MS, since, until) as Array<
    Omit<AppUsageDayRow, "turnCount" | "toolCallCount">
  >;

  const turnDays = db
    .prepare(
      `select cast((started_at + ?) / ? as integer) as dayIndex, count(*) as turnCount
       from turn_usage
       where started_at >= ? and started_at <= ?
       group by dayIndex`,
    )
    .all(tzOffsetMs, DAY_MS, since, until) as Array<{ dayIndex: number; turnCount: number }>;

  const toolDays = db
    .prepare(
      `select cast((started_at + ?) / ? as integer) as dayIndex, count(*) as toolCallCount
       from tool_usage
       where started_at >= ? and started_at <= ?
       group by dayIndex`,
    )
    .all(tzOffsetMs, DAY_MS, since, until) as Array<{ dayIndex: number; toolCallCount: number }>;

  // 合并三类按日统计到同一 dayIndex
  const dayMap = new Map<number, AppUsageDayRow>();
  for (const row of days) {
    dayMap.set(row.dayIndex, {
      dayIndex: Number(row.dayIndex),
      totalTokens: Number(row.totalTokens),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      reasoningTokens: Number(row.reasoningTokens),
      cacheCreationTokens: Number(row.cacheCreationTokens),
      cacheReadTokens: Number(row.cacheReadTokens),
      modelRequestCount: Number(row.modelRequestCount),
      turnCount: 0,
      toolCallCount: 0,
    });
  }
  const emptyDay = (dayIndex: number): AppUsageDayRow => ({
    dayIndex,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    modelRequestCount: 0,
    turnCount: 0,
    toolCallCount: 0,
  });
  for (const row of turnDays) {
    const existing = dayMap.get(row.dayIndex) ?? emptyDay(row.dayIndex);
    existing.turnCount = Number(row.turnCount);
    dayMap.set(row.dayIndex, existing);
  }
  for (const row of toolDays) {
    const existing = dayMap.get(row.dayIndex) ?? emptyDay(row.dayIndex);
    existing.toolCallCount = Number(row.toolCallCount);
    dayMap.set(row.dayIndex, existing);
  }

  const dayModels = db
    .prepare(
      `select
         cast((started_at + ?) / ? as integer) as dayIndex,
         model_id as modelId,
         coalesce(sum(computed_total_tokens), 0) as totalTokens
       from model_usage
       where started_at >= ? and started_at <= ?
       group by dayIndex, model_id`,
    )
    .all(tzOffsetMs, DAY_MS, since, until) as unknown as AppUsageDayModelRow[];

  return {
    totals: {
      totalTokens: Number(totals.totalTokens ?? 0),
      inputTokens: Number(totals.inputTokens ?? 0),
      outputTokens: Number(totals.outputTokens ?? 0),
      reasoningTokens: Number(totals.reasoningTokens ?? 0),
      cacheCreationTokens: Number(totals.cacheCreationTokens ?? 0),
      cacheReadTokens: Number(totals.cacheReadTokens ?? 0),
      modelRequestCount: Number(totals.modelRequestCount ?? 0),
      modelErrorCount: Number(totals.modelErrorCount ?? 0),
      avgTimeToFirstTokenMs:
        totals.avgTimeToFirstTokenMs == null ? null : Number(totals.avgTimeToFirstTokenMs),
    },
    turnTotals: {
      totalSessions: Number(turnTotals.totalSessions ?? 0),
      totalTurns: Number(turnTotals.totalTurns ?? 0),
      avgTurnDurationMs:
        turnTotals.avgTurnDurationMs == null ? null : Number(turnTotals.avgTurnDurationMs),
      longestSessionMs: Number(longestSession.longestSessionMs ?? 0),
    },
    toolTotals: {
      toolCallCount: Number(toolTotals.toolCallCount ?? 0),
      toolErrorCount: Number(toolTotals.toolErrorCount ?? 0),
    },
    models: models.map((m) => ({
      modelId: m.modelId ?? null,
      totalTokens: Number(m.totalTokens),
      inputTokens: Number(m.inputTokens),
      outputTokens: Number(m.outputTokens),
      requestCount: Number(m.requestCount),
    })),
    tools: tools.map((t) => ({
      toolName: t.toolName,
      callCount: Number(t.callCount),
      errorCount: Number(t.errorCount),
      avgDurationMs: t.avgDurationMs == null ? null : Number(t.avgDurationMs),
    })),
    days: [...dayMap.values()].sort((a, b) => a.dayIndex - b.dayIndex),
    dayModels: dayModels.map((d) => ({
      dayIndex: Number(d.dayIndex),
      modelId: d.modelId ?? null,
      totalTokens: Number(d.totalTokens),
    })),
  };
}
