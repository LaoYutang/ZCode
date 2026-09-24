/**
 * 单会话的增量口径用量：input 侧「前缀只计一次」的累计，供 compact 基线与 task usage 使用。
 *
 * usage.ts 拆分的产物（原文件顶到 oxlint max-lines 上限）。计费口径在 usage-session-query.ts，
 * 两种口径能差数倍，不要在调用方混用。
 */

import type { DatabaseSync } from "node:sqlite";
import type { TaskUsageQueryInput, TaskUsageQueryResult } from "@zcode/contracts";
import { GENERATION_QUERY_SOURCES, integer } from "./usage-shared.js";

export async function queryTaskUsage(
  db: DatabaseSync,
  input: TaskUsageQueryInput,
): Promise<TaskUsageQueryResult> {
  const rows = db
    .prepare(
      `select
         id,
         query_source as querySource,
         status,
         input_tokens as inputTokens,
         output_tokens as outputTokens,
         reasoning_tokens as reasoningTokens,
         cache_creation_input_tokens as cacheCreationTokens,
         cache_read_input_tokens as cacheReadTokens,
         computed_total_tokens as computedTotalTokens,
         provider_total_tokens as providerTotalTokens
       from model_usage
       where session_id = ?
       order by started_at asc, id asc`,
    )
    .all(input.sessionID) as Array<{
    cacheCreationTokens: number;
    cacheReadTokens: number;
    computedTotalTokens: number;
    inputTokens: number;
    outputTokens: number;
    providerTotalTokens: number | null;
    querySource: string;
    reasoningTokens: number;
    status: string;
  }>;

  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let modelErrorCount = 0;
  const inputBaselineBySource: Record<string, number> = {};

  for (const row of rows) {
    const rawTotalTokens = Number(row.providerTotalTokens ?? row.computedTotalTokens ?? 0);
    const inputSideTokens = inputSideTokensFromStoredUsage(row);
    const source = taskUsageInputBaselineSource(row.querySource);
    const incrementalInputTokens =
      source === undefined
        ? inputSideTokens
        : Math.max(0, inputSideTokens - (inputBaselineBySource[source] ?? 0));
    if (source !== undefined) {
      // 压缩会让后续 context input 变小；累计消耗不能因此回扣历史，
      // 但 baseline 必须降到压缩后的值，后续新增轮次才能继续按增量计算。
      inputBaselineBySource[source] = inputSideTokens;
    }

    const nonInputTokens = Math.max(0, rawTotalTokens - inputSideTokens);
    const rowOutputTokens = Number(row.outputTokens ?? 0);
    const rowReasoningTokens = Number(row.reasoningTokens ?? 0);
    totalTokens += incrementalInputTokens + nonInputTokens;
    inputTokens += incrementalInputTokens;
    outputTokens += rowOutputTokens;
    reasoningTokens += rowReasoningTokens;
    if (source === undefined) {
      cacheCreationTokens += Number(row.cacheCreationTokens ?? 0);
      cacheReadTokens += Number(row.cacheReadTokens ?? 0);
    }
    if (row.status === "error") {
      modelErrorCount += 1;
    }
  }

  return {
    sessionID: input.sessionID,
    totalTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheCreationTokens,
    cacheReadTokens,
    modelRequestCount: rows.length,
    modelErrorCount,
    inputBaselineBySource,
  };
}

function inputSideTokensFromStoredUsage(row: {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  computedTotalTokens: number;
  inputTokens: number;
  outputTokens: number;
  providerTotalTokens: number | null;
}): number {
  const input = integer(row.inputTokens);
  const cache = integer(row.cacheCreationTokens) + integer(row.cacheReadTokens);
  if (input <= 0) {
    return cache;
  }
  if (cache <= 0) {
    return input;
  }

  const output = integer(row.outputTokens);
  const total = integer(row.providerTotalTokens ?? row.computedTotalTokens);
  if (total > 0) {
    const totalInputDistance = Math.abs(total - (input + output));
    const noCacheInputDistance = Math.abs(total - (input + cache + output));
    if (noCacheInputDistance < totalInputDistance) {
      return input + cache;
    }
  }

  // AI SDK v6 写入的 inputTokens 已经是 total input；历史表里 cache 字段只是 breakdown。
  // task usage 和 compact 基线不能再把 cache read/write 叠到 inputTokens 上。
  return input;
}

function taskUsageInputBaselineSource(querySource: string): string | undefined {
  return (GENERATION_QUERY_SOURCES as readonly string[]).includes(querySource)
    ? querySource
    : undefined;
}
