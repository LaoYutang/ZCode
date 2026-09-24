/**
 * 会话用量明细（状态条 / 用量面板的数据源）。
 *
 * usage.ts 拆分的产物（原文件顶到 oxlint max-lines 上限）。这里一律是**计费口径**：
 * 每条请求的 `computed_total_tokens` 原始求和，且只算 status = 'completed'。
 */

import type { DatabaseSync } from "node:sqlite";
import type {
  SessionId,
  SessionUsageBilledTotals,
  SessionUsageDetailQueryInput,
  SessionUsageDetailQueryResult,
  SessionUsageModelRow,
  SessionUsageRequestRow,
  SessionUsageSubagentRow,
  SessionUsageTimedGeneration,
  SessionUsageToolRow,
} from "@zcode/contracts";
import { GENERATION_QUERY_SOURCES, integer, USAGE_RETENTION_DAYS } from "./usage-shared.js";

/**
 * 会话用量明细（状态条/用量面板的数据源）。
 *
 * 与 `queryTaskUsage` 的区别是口径而非形状：这里一律是**计费口径**
 * （`sum(computed_total_tokens)` 原始求和），而 `queryTaskUsage`
 * 是"前缀只计一次"的增量口径。两种口径能差数倍（长会话里共享前缀只算一次 vs 每次请求
 * 都计一整份 input），所以展示值只允许取这里的 `billed`，不要在 UI 层混用。
 *
 * 与 `queryAppUsage`（设置 → 用量）**不是同一口径**：后者只按时间窗过滤、不按 status
 * 过滤，而这里只算 completed。两者的 `computed_total_tokens` 求和形状相同，但窗口不同，
 * 数字不可互相校验，也不要试图把任一侧"对齐"到另一边（会改动用户已看到的数）。
 *
 * 只统计 `status='completed'`：实测库中 token 全部落在 completed 行（cancelled/running 都为 0），
 * 排除非 completed 同时挡掉在途请求，避免同一条请求在完成前后被计两次。
 */
export async function querySessionUsageDetail(
  db: DatabaseSync,
  input: SessionUsageDetailQueryInput,
): Promise<SessionUsageDetailQueryResult> {
  const recentRequestLimit = Math.max(1, Math.trunc(input.recentRequestLimit ?? 20));

  // 按模型分组，同时作为计费合计的唯一来源：合计由分组结果折叠得出，
  // 保证"按模型子项之和 = 合计"恒成立，不在 UI 层再做一次加法。
  const modelRows = db
    .prepare(
      `select
         model_id as modelId,
         coalesce(sum(computed_total_tokens), 0) as totalTokens,
         coalesce(sum(input_tokens), 0) as inputTokens,
         coalesce(sum(output_tokens), 0) as outputTokens,
         coalesce(sum(reasoning_tokens), 0) as reasoningTokens,
         coalesce(sum(cache_creation_input_tokens), 0) as cacheCreationTokens,
         coalesce(sum(cache_read_input_tokens), 0) as cacheReadTokens,
         count(*) as requestCount
       from model_usage
       where session_id = ? and status = 'completed'
       group by modelId
       order by totalTokens desc`,
    )
    .all(input.sessionID) as Array<{
    modelId: string | null;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    requestCount: number;
  }>;

  const billed: SessionUsageBilledTotals = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    modelRequestCount: 0,
  };
  const models: SessionUsageModelRow[] = [];
  for (const row of modelRows) {
    billed.totalTokens += integer(row.totalTokens);
    billed.inputTokens += integer(row.inputTokens);
    billed.outputTokens += integer(row.outputTokens);
    billed.reasoningTokens += integer(row.reasoningTokens);
    billed.cacheCreationTokens += integer(row.cacheCreationTokens);
    billed.cacheReadTokens += integer(row.cacheReadTokens);
    billed.modelRequestCount += integer(row.requestCount);
    models.push({
      modelId: row.modelId,
      totalTokens: integer(row.totalTokens),
      inputTokens: integer(row.inputTokens),
      outputTokens: integer(row.outputTokens),
      requestCount: integer(row.requestCount),
    });
  }

  const recentRequests = db
    .prepare(
      `select
         id as requestId,
         model_id as modelId,
         query_source as querySource,
         started_at as startedAt,
         completed_at as completedAt,
         duration_ms as durationMs,
         time_to_first_token_ms as timeToFirstTokenMs,
         computed_total_tokens as totalTokens,
         input_tokens as inputTokens,
         output_tokens as outputTokens
       from model_usage
       where session_id = ? and status = 'completed'
       order by completed_at desc, started_at desc, id desc
       limit ?`,
    )
    .all(input.sessionID, recentRequestLimit) as unknown as SessionUsageRequestRow[];

  // 速度只取"最近一次可计时的真实生成"，不能直接拿最近一条 completed 行：
  //  - 会话标题、提交信息、目标校验这类辅助请求**不带流式计时**（time_to_first_token_ms 恒为空），
  //    实测库里相当一部分会话的最近一条 completed 行就是它们，取到就等于速度整行消失；
  //  - 首 token 时间按请求缺失（实测某模型 1137/4177 条没有，且是完整的工具调用生成，
  //    first_token_at 也为空、只有总耗时），这类行同样算不出生成速度；
  //  - 不用 output ÷ 总耗时兜底：两种口径实测差 3.5 倍（78.0 vs 270.7 t/s），
  //    混进同一行数字等于静默换口径。
  // 实测每个有生成的会话都至少有一条可计时生成，因此这条查询能保证速度行不整行消失。
  const latestTimedGenerationRow = db
    .prepare(
      `select
         model_id as modelId,
         output_tokens as outputTokens,
         duration_ms as durationMs,
         time_to_first_token_ms as timeToFirstTokenMs,
         completed_at as completedAt
       from model_usage
       where session_id = ? and status = 'completed'
         and query_source in (${GENERATION_QUERY_SOURCES.map(() => "?").join(", ")})
         and time_to_first_token_ms is not null
         and duration_ms is not null and duration_ms > time_to_first_token_ms
         and output_tokens > 0
       order by completed_at desc, started_at desc, id desc
       limit 1`,
    )
    .get(input.sessionID, ...GENERATION_QUERY_SOURCES) as
    | {
        modelId: string | null;
        outputTokens: number;
        durationMs: number;
        timeToFirstTokenMs: number;
        completedAt: number | null;
      }
    | undefined;

  const latestTimedGeneration: SessionUsageTimedGeneration | null = latestTimedGenerationRow
    ? {
        modelId: latestTimedGenerationRow.modelId,
        outputTokens: integer(latestTimedGenerationRow.outputTokens),
        durationMs: integer(latestTimedGenerationRow.durationMs),
        timeToFirstTokenMs: integer(latestTimedGenerationRow.timeToFirstTokenMs),
        completedAt: latestTimedGenerationRow.completedAt ?? null,
      }
    : null;

  // 与 queryAppUsage 的 tools 分块保持同一语义：统计的是"已调度的工具调用"，
  // 不按 status 过滤，所以会话级与全应用级的工具计数可以直接对账。
  const tools = db
    .prepare(
      `select
         tool_name as toolName,
         count(*) as callCount,
         coalesce(sum(case when status = 'error' then 1 else 0 end), 0) as errorCount,
         avg(duration_ms) as avgDurationMs
       from tool_usage
       where session_id = ?
       group by tool_name
       order by callCount desc`,
    )
    .all(input.sessionID) as unknown as SessionUsageToolRow[];

  let toolCallCount = 0;
  let toolErrorCount = 0;
  for (const row of tools) {
    toolCallCount += integer(row.callCount);
    toolErrorCount += integer(row.errorCount);
  }

  // 子代理归属必须用 task_type：实测库里"选择侧边会话"（selection_side_chat）同样带 parent_id
  // 且消耗可观，只按 parent_id 关联会把它算成子代理。也不能只认 `sess_subagent_` id 前缀——
  // 该前缀与 task_type 的集合并不相等。
  //
  // 子会话有三种类型，都要收进来：普通子代理（`subagent_child`）、动态工作流的子代理
  // （`workflow_child`，见 script-workflow-child-runtime）、以及嵌套工作流里的子代理
  // （`nested_workflow_child`）。只认第一种时，工作流的子代理会从两个集合里一起消失——
  // 它们不是父会话自己的请求（不进"会话合计"），也匹配不上这一行（不进"子代理合计"），
  // 于是侧栏两行相加不再等于这个会话真正花掉的量。
  const childRows = db
    .prepare(
      `select
         s.id as sessionId,
         s.title as title,
         coalesce(sum(m.computed_total_tokens), 0) as totalTokens,
         coalesce(sum(m.input_tokens), 0) as inputTokens,
         coalesce(sum(m.output_tokens), 0) as outputTokens,
         count(*) as requestCount
       from session s
       join model_usage m on m.session_id = s.id
       where s.parent_id = ?
         and s.task_type in ('subagent_child', 'workflow_child', 'nested_workflow_child')
         and m.status = 'completed'
       group by s.id
       order by totalTokens desc`,
    )
    .all(input.sessionID) as Array<{
    sessionId: SessionId;
    title: string | null;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
  }>;

  const children: SessionUsageSubagentRow[] = [];
  let subagentTotalTokens = 0;
  for (const row of childRows) {
    const totalTokens = integer(row.totalTokens);
    subagentTotalTokens += totalTokens;
    children.push({
      sessionId: row.sessionId,
      title: row.title ?? null,
      totalTokens,
      inputTokens: integer(row.inputTokens),
      outputTokens: integer(row.outputTokens),
      requestCount: integer(row.requestCount),
    });
  }

  return {
    sessionID: input.sessionID,
    billed,
    latestTimedGeneration,
    models,
    recentRequests: recentRequests.map((row) => ({
      ...row,
      totalTokens: integer(row.totalTokens),
      inputTokens: integer(row.inputTokens),
      outputTokens: integer(row.outputTokens),
    })),
    tools: tools.map((row) => ({
      toolName: row.toolName,
      callCount: integer(row.callCount),
      errorCount: integer(row.errorCount),
      avgDurationMs: row.avgDurationMs ?? null,
    })),
    toolCallCount,
    toolErrorCount,
    subagents: { children, totalTokens: subagentTotalTokens },
    retentionDays: USAGE_RETENTION_DAYS,
  };
}
