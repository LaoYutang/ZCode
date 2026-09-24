/**
 * 用量仓储的共享部分：保留期与裁剪、可计时生成的 query_source、数值收窄。
 *
 * usage.ts 拆分的产物——原文件顶到 oxlint max-lines 上限（400 行），按"写入面 / 各读取面"
 * 拆到兄弟文件，公开面仍从 usage.ts 导出（`sqlite-session-store.ts` 只做委托）。
 * 本文件只放被多个面共用的东西；单面私有的 SQL 与辅助函数留在各自文件里。
 */

import type { DatabaseSync } from "node:sqlite";

/**
 * 用量事件的保留期：写入时按此裁剪（`pruneUsage`），所以会话用量只是"近 N 天"。
 * 随查询结果一并返回，避免 UI 另行硬编码一个数字。
 */
export const USAGE_RETENTION_DAYS = 30;
export const USAGE_RETENTION_MS = USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * 真实生成请求的 query_source：只有它们带流式计时（首 token 时间）与增量输入基线语义。
 * 会话标题、提交信息、压缩、目标校验等辅助请求不在其中——它们没有首 token 时间，
 * 拿它们当"最近一次请求"会让速度与首字延迟整行消失。
 */
export const GENERATION_QUERY_SOURCES = ["main_turn", "subagent", "workflow_child"] as const;

export async function pruneUsage(
  db: DatabaseSync,
  input: { beforeTime?: number } = {},
): Promise<void> {
  const beforeTime = input.beforeTime ?? Date.now() - USAGE_RETENTION_MS;
  db.exec("begin immediate");
  try {
    db.prepare("delete from model_usage where started_at < ?").run(beforeTime);
    db.prepare("delete from turn_usage where started_at < ?").run(beforeTime);
    db.prepare("delete from tool_usage where started_at < ?").run(beforeTime);
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

export function integer(value: number | null | undefined): number {
  // providerTotalTokens 这类旧记录字段可能是 null；adapters 独立 tsc 需要先完成类型收窄。
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

export function boolean(value: boolean | undefined): number {
  return value ? 1 : 0;
}

export function nullableBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : boolean(value);
}
