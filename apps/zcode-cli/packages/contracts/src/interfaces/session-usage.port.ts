// ============================================================
// 用量契约：model_usage / turn_usage / tool_usage 的写入记录与查询结果
// ============================================================
// 从 session-store.port.ts 拆出，理由与 dwf-journal-introspection.ts 同一条：那份契约已到
// oxlint 的 max-lines 上限。公开面不变——主端口文件原地再导出这里的每一个名字，
// `@zcode/contracts` 的导入路径逐字不动。
//
// 口径提示（三套查询各自成立，不要互相校验）：`queryAppUsage` 按时间窗不过滤 status；
// `queryTaskUsage` 是 input 前缀只计一次的增量口径；`querySessionUsageDetail` 是只算
// completed 的计费口径。细节论证在 adapters 的 usage-*-query.ts。

import type { MessageId, SessionId, ToolCallId, TraceId, TurnId } from "./shared.js";
import type { ModelId, ModelProviderId, ModelToolSideEffectScope } from "../model/index.js";
import type { SessionTaskType } from "./session-record.port.js";

export type UsageQuerySource =
  | "main_turn"
  | "compact"
  | "session_title"
  | "goal_completion_verification"
  | "subagent"
  | "workflow_child"
  | "unknown";

export type UsageStatus = "running" | "completed" | "error" | "cancelled";

export interface ModelUsageRecord {
  id: string;
  logicalRequestId: string;
  attemptIndex?: number;
  sessionID: SessionId;
  turnID?: TurnId;
  traceID?: TraceId;
  spanID?: string;
  assistantMessageID?: MessageId;
  parentUserMessageID?: MessageId;
  querySource: UsageQuerySource | string;
  providerId: ModelProviderId | string;
  modelId: ModelId | string;
  reasoningLevel?: string;
  agent?: string;
  mode?: string;
  taskType?: SessionTaskType;
  status: UsageStatus;
  startedAt: number;
  firstTokenAt?: number;
  completedAt?: number;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  finishReason?: string;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  providerTotalTokens?: number;
  computedTotalTokens?: number;
  retryCount?: number;
  retryable?: boolean;
  cancelledByUser?: boolean;
  contextExceeded?: boolean;
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
  rawUsage?: unknown;
  providerMetadata?: unknown;
}

export interface TurnUsageRecord {
  sessionID: SessionId;
  turnID: TurnId;
  traceID?: TraceId;
  userMessageID?: MessageId;
  status: UsageStatus;
  startedAt: number;
  firstModelStartAt?: number;
  firstTokenAt?: number;
  completedAt?: number;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  modelRequestCount?: number;
  modelRetryCount?: number;
  toolCallCount?: number;
  toolErrorCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  computedTotalTokens?: number;
  retryable?: boolean;
  cancelledByUser?: boolean;
  contextExceeded?: boolean;
  errorType?: string;
  errorCode?: string;
}

export interface ToolUsageRecord {
  id: string;
  sessionID: SessionId;
  turnID?: TurnId;
  traceID?: TraceId;
  toolCallID: ToolCallId | string;
  toolName: string;
  sideEffectScope?: ModelToolSideEffectScope | string;
  readOnly?: boolean;
  destructive?: boolean;
  approvalStatus?: "none" | "requested" | "allowed" | "denied";
  status: UsageStatus;
  startedAt: number;
  firstOutputAt?: number;
  completedAt?: number;
  durationMs?: number;
  timeToFirstOutputMs?: number;
  exitCode?: number;
  outputBytes?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  truncated?: boolean;
  retryCount?: number;
  retryable?: boolean;
  cancelledByUser?: boolean;
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface AppUsageQueryInput {
  /** 含 (since, until] 的下界（unix ms）。 */
  since: number;
  /** 上界（unix ms），通常为 now。 */
  until: number;
  /** 调用端时区相对 UTC 的固定偏移（ms），用于按本地日归桶。 */
  tzOffsetMs: number;
}

export interface AppUsageTotalsRow {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelRequestCount: number;
  modelErrorCount: number;
  avgTimeToFirstTokenMs: number | null;
}

export interface AppUsageTurnTotalsRow {
  totalSessions: number;
  totalTurns: number;
  avgTurnDurationMs: number | null;
  longestSessionMs: number;
}

export interface AppUsageToolTotalsRow {
  toolCallCount: number;
  toolErrorCount: number;
}

export interface AppUsageModelRow {
  modelId: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export interface AppUsageToolRow {
  toolName: string;
  callCount: number;
  errorCount: number;
  avgDurationMs: number | null;
}

export interface AppUsageDayRow {
  dayIndex: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelRequestCount: number;
  turnCount: number;
  toolCallCount: number;
}

export interface AppUsageDayModelRow {
  dayIndex: number;
  modelId: string | null;
  totalTokens: number;
}

export interface AppUsageQueryResult {
  totals: AppUsageTotalsRow;
  turnTotals: AppUsageTurnTotalsRow;
  toolTotals: AppUsageToolTotalsRow;
  models: AppUsageModelRow[];
  tools: AppUsageToolRow[];
  days: AppUsageDayRow[];
  dayModels: AppUsageDayModelRow[];
}

export interface TaskUsageQueryInput {
  sessionID: SessionId;
}

export interface TaskUsageQueryResult {
  sessionID: SessionId;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelRequestCount: number;
  modelErrorCount: number;
  inputBaselineBySource: Record<string, number>;
}

/**
 * 计费口径的会话用量合计：`sum(computed_total_tokens)` 等，只算 `status='completed'`。
 * `inputTokens` 已含 cache read，展示时不得再加一次。
 * 不含失败请求的计数：在 completed 过滤下它恒为 0，留着只会误导。
 */
export interface SessionUsageBilledTotals {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelRequestCount: number;
}

/**
 * 最近一次**可计时**的真实生成（速度与首字延迟的唯一来源）。
 *
 * 只可能是真实生成请求（`main_turn` / `subagent` / `workflow_child`），且首 token 时间与总耗时
 * 都存在、`durationMs > timeToFirstTokenMs`、输出非空。理由是实测得到的：辅助请求（会话标题、
 * 提交信息、目标校验）没有首 token 时间；真实生成里也有按请求缺失首 token 时间的（某模型
 * 1137/4177 条）。这两类都会让"速度/首字延迟"整行消失，所以这里跳过它们、只取最近一条可计时的。
 * 不用 `outputTokens / durationMs` 兜底：两种口径实测差 3.5 倍（78.0 vs 270.7 t/s）。
 */
export interface SessionUsageTimedGeneration {
  modelId: string | null;
  outputTokens: number;
  durationMs: number;
  timeToFirstTokenMs: number;
  completedAt: number | null;
}

export interface SessionUsageModelRow {
  modelId: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export interface SessionUsageRequestRow {
  requestId: string;
  modelId: string | null;
  querySource: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  timeToFirstTokenMs: number | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SessionUsageToolRow {
  toolName: string;
  callCount: number;
  errorCount: number;
  avgDurationMs: number | null;
}

/**
 * 一个子代理会话的用量。归属靠 `session.task_type`：只按 `parent_id` 会把"选择侧边会话"
 * （`selection_side_chat`）等子会话算成子代理。
 *
 * 收进来的类型是三种子会话：`subagent_child`（普通子代理）、`workflow_child`（动态工作流的
 * 子代理）、`nested_workflow_child`（嵌套工作流里的子代理）。工作流子代理的消耗不记在父会话
 * 名下，漏掉它们的类型会让这部分用量在明细里彻底看不见。
 */
export interface SessionUsageSubagentRow {
  sessionId: SessionId;
  title: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export interface SessionUsageDetailQueryInput {
  sessionID: SessionId;
  /** 逐请求明细的返回条数上限（取最近完成的若干条）。 */
  recentRequestLimit?: number;
}

export interface SessionUsageDetailQueryResult {
  sessionID: SessionId;
  /** 本会话（不含子代理会话）的计费口径合计。 */
  billed: SessionUsageBilledTotals;
  latestTimedGeneration: SessionUsageTimedGeneration | null;
  models: SessionUsageModelRow[];
  recentRequests: SessionUsageRequestRow[];
  tools: SessionUsageToolRow[];
  toolCallCount: number;
  toolErrorCount: number;
  /** 子代理用量单独分块，不计入 `billed`；`totalTokens` = 各子项之和。 */
  subagents: {
    children: SessionUsageSubagentRow[];
    totalTokens: number;
  };
  retentionDays: number;
}

export interface UsageStorePort {
  recordModelUsage(input: ModelUsageRecord): Promise<void>;
  upsertTurnUsage(input: TurnUsageRecord): Promise<void>;
  upsertToolUsage(input: ToolUsageRecord): Promise<void>;
  pruneUsage(input?: { beforeTime?: number }): Promise<void>;
  queryAppUsage(input: AppUsageQueryInput): Promise<AppUsageQueryResult>;
  queryTaskUsage(input: TaskUsageQueryInput): Promise<TaskUsageQueryResult>;
  querySessionUsageDetail(
    input: SessionUsageDetailQueryInput,
  ): Promise<SessionUsageDetailQueryResult>;
}
