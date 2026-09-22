import type { AppUsageQueryResult } from "@zcode/contracts";
import type {
  AppUsageHeatmap,
  AppUsageHeatmapCell,
  AppUsageHeatmapWeek,
  AppUsageRange,
  AppUsageSnapshot,
} from "@zcode/shared";

const DAY_MS = 86_400_000;

interface BuildAppUsageOptions {
  range: AppUsageRange;
  timeZone: string;
  tzOffsetMs: number;
  generatedAt: number;
  since: number;
  until: number;
}

/** 用 Intl 计算 timeZone 在 atMs 时刻相对 UTC 的偏移（ms）。无法解析时回退 0。 */
export function resolveTzOffsetMs(timeZone: string, atMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(atMs));
    const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      lookup("year"),
      lookup("month") - 1,
      lookup("day"),
      lookup("hour"),
      lookup("minute"),
      lookup("second"),
    );
    return asUtc - Math.trunc(atMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

function dayIndexToDate(dayIndex: number): string {
  // dayIndex*DAY 是「本地午夜当作 UTC」的时刻，取其 UTC 日历分量即本地日期。
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

function levelFor(tokens: number, max: number): AppUsageHeatmapCell["level"] {
  if (tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function resolveUsageStartDayIndex(
  result: AppUsageQueryResult,
  opts: BuildAppUsageOptions,
  endDayIndex: number,
): number {
  if (opts.range !== "all") {
    return Math.floor((opts.since + opts.tzOffsetMs) / DAY_MS);
  }

  const dayIndexes = [
    ...result.days.map((day) => day.dayIndex),
    ...result.dayModels.map((dayModel) => dayModel.dayIndex),
  ];
  if (dayIndexes.length === 0) {
    return endDayIndex;
  }
  return Math.min(...dayIndexes);
}

/**
 * 缓存命中率。用量库的 inputTokens 已是 total input，cache 字段只是 breakdown：
 * 命中率分母不能再加 cacheRead/cacheCreation，否则会把命中率压低。
 * 区间汇总与当日分块共用这一份实现，两处不允许各算一套。
 */
function resolveCacheHitRate(input: {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  const denominator =
    input.inputTokens > 0 ? input.inputTokens : input.cacheCreationTokens + input.cacheReadTokens;
  return denominator > 0 ? input.cacheReadTokens / denominator : 0;
}

export function buildAppUsageSnapshot(
  result: AppUsageQueryResult,
  opts: BuildAppUsageOptions,
): AppUsageSnapshot {
  const { totals, turnTotals, toolTotals } = result;

  const cacheHitRate = resolveCacheHitRate(totals);
  const modelErrorRate =
    totals.modelRequestCount > 0 ? totals.modelErrorCount / totals.modelRequestCount : 0;
  const toolErrorRate =
    toolTotals.toolCallCount > 0 ? toolTotals.toolErrorCount / toolTotals.toolCallCount : 0;

  // 按日 token 映射，用于 activeDays / streak / heatmap / today
  const dayTokenMap = new Map<
    number,
    {
      totalTokens: number;
      turnCount: number;
      toolCallCount: number;
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      modelRequestCount: number;
    }
  >();
  for (const d of result.days) {
    dayTokenMap.set(d.dayIndex, {
      totalTokens: d.totalTokens,
      turnCount: d.turnCount,
      toolCallCount: d.toolCallCount,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      reasoningTokens: d.reasoningTokens,
      cacheCreationTokens: d.cacheCreationTokens,
      cacheReadTokens: d.cacheReadTokens,
      modelRequestCount: d.modelRequestCount,
    });
  }

  const endDayIndex = Math.floor((opts.until + opts.tzOffsetMs) / DAY_MS);
  const startDayIndex = resolveUsageStartDayIndex(result, opts, endDayIndex);

  let activeDays = 0;
  let currentStreakDays = 0;
  let longestStreakDays = 0;
  let runningStreakDays = 0;
  let streakBroken = false;
  for (let di = endDayIndex; di >= startDayIndex; di--) {
    const tokens = dayTokenMap.get(di)?.totalTokens ?? 0;
    if (tokens > 0) {
      activeDays++;
      runningStreakDays++;
      longestStreakDays = Math.max(longestStreakDays, runningStreakDays);
      if (!streakBroken) currentStreakDays++;
    } else if (!streakBroken) {
      streakBroken = true;
      runningStreakDays = 0;
    } else {
      runningStreakDays = 0;
    }
  }

  const maxTokens = result.days.reduce((m, d) => Math.max(m, d.totalTokens), 0);

  // heatmap：从 startDayIndex 到 endDayIndex，按 7 天一周切片（与现有 GitHub 式一致）
  const weeks: AppUsageHeatmapWeek[] = [];
  let week: Array<AppUsageHeatmapCell | null> = [];
  for (let di = startDayIndex; di <= endDayIndex; di++) {
    const day = dayTokenMap.get(di);
    week.push({
      date: dayIndexToDate(di),
      level: levelFor(day?.totalTokens ?? 0, maxTokens),
      totalTokens: day?.totalTokens ?? 0,
      turnCount: day?.turnCount ?? 0,
      toolCallCount: day?.toolCallCount ?? 0,
    });
    if (week.length === 7) {
      weeks.push({ weekIndex: weeks.length, days: week });
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push({ weekIndex: weeks.length, days: week });
  }

  const heatmap: AppUsageHeatmap = {
    startDate: dayIndexToDate(startDayIndex),
    endDate: dayIndexToDate(endDayIndex),
    maxTokens,
    weeks,
  };

  // trend：按日聚合 dayModels
  const dailyMap = new Map<number, Map<string | null, number>>();
  for (const dm of result.dayModels) {
    const inner = dailyMap.get(dm.dayIndex) ?? new Map<string | null, number>();
    inner.set(dm.modelId, (inner.get(dm.modelId) ?? 0) + dm.totalTokens);
    dailyMap.set(dm.dayIndex, inner);
  }
  const dailyModelUsage: AppUsageSnapshot["dailyModelUsage"] = [];
  for (let di = startDayIndex; di <= endDayIndex; di++) {
    const inner = dailyMap.get(di);
    dailyModelUsage.push({
      date: dayIndexToDate(di),
      models: inner
        ? [...inner.entries()].map(([modelId, totalTokens]) => ({ modelId, totalTokens }))
        : [],
    });
  }

  // 模型排行 + favorite
  const totalModelTokens = result.models.reduce((s, m) => s + m.totalTokens, 0);
  const models = result.models.map((m) => ({
    modelId: m.modelId,
    totalTokens: m.totalTokens,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    requestCount: m.requestCount,
    share: totalModelTokens > 0 ? m.totalTokens / totalModelTokens : 0,
  }));
  const favoriteModel =
    models.length > 0
      ? { modelId: models[0].modelId, totalTokens: models[0].totalTokens, share: models[0].share }
      : null;

  const tools = result.tools.map((t) => ({
    toolName: t.toolName,
    callCount: t.callCount,
    errorCount: t.errorCount,
    errorRate: t.callCount > 0 ? t.errorCount / t.callCount : 0,
    avgDurationMs: t.avgDurationMs,
  }));

  // 今日：直接取按日聚合里 endDayIndex 那一行，不另开查询。今天没有任何 model_usage
  // 行时该 dayIndex 不存在，此时全部为 0——这是正确结果，不是缺数据。
  const todayRow = dayTokenMap.get(endDayIndex);
  const today: AppUsageSnapshot["today"] = {
    date: dayIndexToDate(endDayIndex),
    totalTokens: todayRow?.totalTokens ?? 0,
    inputTokens: todayRow?.inputTokens ?? 0,
    outputTokens: todayRow?.outputTokens ?? 0,
    reasoningTokens: todayRow?.reasoningTokens ?? 0,
    cacheCreationTokens: todayRow?.cacheCreationTokens ?? 0,
    cacheReadTokens: todayRow?.cacheReadTokens ?? 0,
    cacheHitRate: resolveCacheHitRate({
      inputTokens: todayRow?.inputTokens ?? 0,
      cacheCreationTokens: todayRow?.cacheCreationTokens ?? 0,
      cacheReadTokens: todayRow?.cacheReadTokens ?? 0,
    }),
    modelRequestCount: todayRow?.modelRequestCount ?? 0,
    turnCount: todayRow?.turnCount ?? 0,
    toolCallCount: todayRow?.toolCallCount ?? 0,
  };

  return {
    range: opts.range,
    generatedAt: opts.generatedAt,
    timeZone: opts.timeZone,
    source: "agent-db",
    today,
    summary: {
      totalTokens: totals.totalTokens,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      reasoningTokens: totals.reasoningTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheHitRate,
      totalSessions: turnTotals.totalSessions,
      totalTurns: turnTotals.totalTurns,
      toolCallCount: toolTotals.toolCallCount,
      toolErrorRate,
      modelErrorRate,
      avgTimeToFirstTokenMs: totals.avgTimeToFirstTokenMs,
      avgTurnDurationMs: turnTotals.avgTurnDurationMs,
      activeDays,
      currentStreakDays,
      longestSessionMs: turnTotals.longestSessionMs,
      longestStreakDays,
      peakDayTokens: maxTokens,
      favoriteModel,
    },
    heatmap,
    dailyModelUsage,
    models,
    tools,
  };
}
