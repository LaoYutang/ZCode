// 会话用量明细查询的单测。
//
// 跑在 dist 产物上：先 `tsc`（或 `pnpm build`）再 `node --test test/*.test.mjs`。
// 表结构来自真实 SQLITE_MIGRATIONS，不手写 DDL——手写 DDL 会和线上 schema 悄悄漂移，
// 而这条查询的全部风险恰好都在列名与状态枚举上。
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { SQLITE_MIGRATIONS } from "../dist/storage/session-store/migrations.js";
import { querySessionUsageDetail } from "../dist/storage/session-store/repositories/usage.js";

const PARENT = "sess_parent";
const SUBAGENT = "sess_subagent_child";
const SIDE_CHAT = "sess_selection_side_chat";

function createDb() {
  const db = new DatabaseSync(":memory:");
  // 直接应用真实 SQLITE_MIGRATIONS（表结构与线上同源），而不是手写 DDL。
  // 记账表必须先建：0022 之类的迁移会 join schema_migration 判断前置迁移是否已落。
  db.exec(`create table if not exists schema_migration (
    id text primary key, checksum text not null, app_version text, time_applied integer not null
  )`);
  for (const migration of SQLITE_MIGRATIONS) db.exec(migration.sql);
  return db;
}

function insertSession(db, { id, parentId = null, taskType = "interactive", title = id }) {
  db.prepare(
    `insert into session (
       id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
       time_created, time_updated, task_type
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, "proj", "ws", parentId, id, "/tmp/ws", "/tmp/ws", title, "1", 1, 1, taskType);
}

function insertModelUsage(db, row) {
  db.prepare(
    `insert into model_usage (
       id, logical_request_id, session_id, turn_id, query_source, provider_id, model_id,
       status, started_at, completed_at, duration_ms, time_to_first_token_ms,
       input_tokens, output_tokens, reasoning_tokens,
       cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.id,
    row.sessionId,
    row.turnId ?? "turn_1",
    row.querySource ?? "main_turn",
    "provider",
    row.modelId ?? "m1",
    row.status,
    row.startedAt,
    row.completedAt ?? null,
    row.durationMs ?? null,
    row.timeToFirstTokenMs ?? null,
    row.inputTokens ?? 0,
    row.outputTokens ?? 0,
    row.reasoningTokens ?? 0,
    row.cacheCreationTokens ?? 0,
    row.cacheReadTokens ?? 0,
    row.computedTotalTokens ?? 0,
  );
}

function insertToolUsage(db, row) {
  db.prepare(
    `insert into tool_usage (id, session_id, tool_call_id, tool_name, status, started_at, duration_ms)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.sessionId,
    row.id,
    row.toolName,
    row.status,
    row.startedAt,
    row.durationMs ?? null,
  );
}

function seedDb() {
  const db = createDb();
  insertSession(db, { id: PARENT });
  insertSession(db, {
    id: SUBAGENT,
    parentId: PARENT,
    taskType: "subagent_child",
    title: "调研任务",
  });
  insertSession(db, {
    id: SIDE_CHAT,
    parentId: PARENT,
    taskType: "selection_side_chat",
    title: "侧边问答",
  });

  // 两个模型、三条完成请求。
  insertModelUsage(db, {
    id: "r1",
    sessionId: PARENT,
    modelId: "m1",
    status: "completed",
    startedAt: 1000,
    completedAt: 1100,
    durationMs: 100,
    timeToFirstTokenMs: 20,
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: 3,
    cacheCreationTokens: 5,
    cacheReadTokens: 60,
    computedTotalTokens: 110,
  });
  insertModelUsage(db, {
    id: "r2",
    sessionId: PARENT,
    modelId: "m1",
    status: "completed",
    startedAt: 2000,
    completedAt: 2100,
    durationMs: 80,
    timeToFirstTokenMs: 30,
    inputTokens: 200,
    outputTokens: 20,
    cacheReadTokens: 120,
    computedTotalTokens: 220,
  });
  insertModelUsage(db, {
    id: "r3",
    sessionId: PARENT,
    modelId: "m2",
    status: "completed",
    startedAt: 3000,
    completedAt: 3100,
    durationMs: 60,
    timeToFirstTokenMs: 10,
    inputTokens: 50,
    outputTokens: 5,
    computedTotalTokens: 55,
  });
  // 非 completed 必须被排除：在途请求会在完成前后被重复计入，取消请求不该进合计。
  insertModelUsage(db, {
    id: "r4",
    sessionId: PARENT,
    status: "running",
    startedAt: 4000,
    computedTotalTokens: 888,
  });
  insertModelUsage(db, {
    id: "r5",
    sessionId: PARENT,
    status: "cancelled",
    startedAt: 5000,
    computedTotalTokens: 999,
  });
  // 辅助请求（会话标题）比所有生成都晚完成：它计费、但没有首 token 时间，
  // 因此不能成为速度/首字延迟的来源。
  insertModelUsage(db, {
    id: "r6",
    sessionId: PARENT,
    modelId: "m4",
    querySource: "session_title",
    status: "completed",
    startedAt: 8900,
    completedAt: 9000,
    durationMs: 100,
    inputTokens: 20,
    computedTotalTokens: 20,
  });
  // 真实生成、但缺首 token 时间（实测某模型 1137/4177 条如此，first_token_at 也为空）。
  // 它比 r3 更晚完成，仍不能当来源——否则速度与首字延迟会整行消失。
  insertModelUsage(db, {
    id: "r7",
    sessionId: PARENT,
    modelId: "m3",
    status: "completed",
    startedAt: 9300,
    completedAt: 9500,
    durationMs: 5000,
    inputTokens: 4500,
    outputTokens: 500,
    computedTotalTokens: 5000,
  });

  insertModelUsage(db, {
    id: "sa1",
    sessionId: SUBAGENT,
    querySource: "subagent",
    status: "completed",
    startedAt: 6000,
    completedAt: 6100,
    inputTokens: 300,
    outputTokens: 100,
    computedTotalTokens: 400,
  });
  // 侧边会话也有 parent_id 和用量：它属于"选择侧边会话"，不是子代理。
  insertModelUsage(db, {
    id: "sc1",
    sessionId: SIDE_CHAT,
    status: "completed",
    startedAt: 7000,
    completedAt: 7100,
    inputTokens: 600000,
    outputTokens: 29057,
    computedTotalTokens: 629057,
  });

  insertToolUsage(db, {
    id: "t1",
    sessionId: PARENT,
    toolName: "read",
    status: "completed",
    startedAt: 1200,
    durationMs: 10,
  });
  insertToolUsage(db, {
    id: "t2",
    sessionId: PARENT,
    toolName: "read",
    status: "completed",
    startedAt: 2200,
    durationMs: 30,
  });
  insertToolUsage(db, {
    id: "t3",
    sessionId: PARENT,
    toolName: "bash",
    status: "error",
    startedAt: 3200,
    durationMs: 20,
  });
  // 与 queryAppUsage 的 tools 分块同语义：不按 status 过滤，running 也计入调用次数。
  insertToolUsage(db, {
    id: "t4",
    sessionId: PARENT,
    toolName: "read",
    status: "running",
    startedAt: 4200,
  });
  return db;
}

test("计费口径只累加 completed 请求，且与按模型分组可对账", async () => {
  const db = seedDb();
  const detail = await querySessionUsageDetail(db, { sessionID: PARENT });

  // 含辅助请求（会话标题 r6）与缺首 token 时间的生成（r7）：它们都是真实发生的计费请求，
  // 该进合计；只有"速度/首字延迟的来源"不吃它们。
  assert.deepEqual(detail.billed, {
    totalTokens: 5405,
    inputTokens: 4870,
    outputTokens: 535,
    reasoningTokens: 3,
    cacheCreationTokens: 5,
    cacheReadTokens: 180,
    modelRequestCount: 5,
  });

  const modelsTotal = detail.models.reduce((sum, row) => sum + row.totalTokens, 0);
  const modelsRequests = detail.models.reduce((sum, row) => sum + row.requestCount, 0);
  assert.equal(modelsTotal, detail.billed.totalTokens);
  assert.equal(modelsRequests, detail.billed.modelRequestCount);
  assert.deepEqual(
    detail.models.map((row) => [row.modelId, row.totalTokens]),
    [
      ["m3", 5000],
      ["m1", 330],
      ["m2", 55],
      ["m4", 20],
    ],
  );
});

test("速度与首字延迟的来源只取可计时的真实生成，且逐请求明细按完成时间倒序、受 limit 约束", async () => {
  const db = seedDb();
  const detail = await querySessionUsageDetail(db, { sessionID: PARENT, recentRequestLimit: 2 });

  // r7（更晚，但缺首 token 时间）与 r6（更晚，但是会话标题这类辅助请求）都必须被跳过，
  // 因此来源是 r3。跳过它们正是"速度/首字延迟不整行消失"的前提。
  assert.deepEqual(detail.latestTimedGeneration, {
    modelId: "m2",
    outputTokens: 5,
    durationMs: 60,
    timeToFirstTokenMs: 10,
    completedAt: 3100,
  });
  // 逐请求明细则不受"可计时"限制：它要能对上合计，所以辅助请求与缺计时请求都在列。
  assert.deepEqual(
    detail.recentRequests.map((row) => row.requestId),
    ["r7", "r6"],
  );
});

test("工具调用按名称分组，且总数与分组可对账", async () => {
  const db = seedDb();
  const detail = await querySessionUsageDetail(db, { sessionID: PARENT });

  assert.deepEqual(detail.tools, [
    { toolName: "read", callCount: 3, errorCount: 0, avgDurationMs: 20 },
    { toolName: "bash", callCount: 1, errorCount: 1, avgDurationMs: 20 },
  ]);
  assert.equal(detail.toolCallCount, 4);
  assert.equal(detail.toolErrorCount, 1);
});

test("子代理只认 task_type=subagent_child，带用量的侧边会话不计入", async () => {
  const db = seedDb();
  const detail = await querySessionUsageDetail(db, { sessionID: PARENT });

  assert.deepEqual(
    detail.subagents.children.map((row) => [row.sessionId, row.totalTokens]),
    [[SUBAGENT, 400]],
  );
  assert.equal(detail.subagents.totalTokens, 400);
  // 子代理用量单独成块：不得混进本会话合计（否则同一笔消耗会被算两次）。
  assert.equal(detail.billed.totalTokens, 5405);
});

test("保留期随结果返回，未知会话返回零值而不是别的会话数据", async () => {
  const db = seedDb();
  const detail = await querySessionUsageDetail(db, { sessionID: "sess_missing" });

  assert.equal(detail.retentionDays, 30);
  assert.equal(detail.billed.totalTokens, 0);
  assert.equal(detail.billed.modelRequestCount, 0);
  assert.equal(detail.latestTimedGeneration, null);
  assert.deepEqual(detail.models, []);
  assert.deepEqual(detail.recentRequests, []);
  assert.deepEqual(detail.subagents.children, []);
});
