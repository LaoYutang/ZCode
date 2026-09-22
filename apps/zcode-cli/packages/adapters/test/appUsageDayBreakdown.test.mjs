// 全局用量「按日聚合」的单测，覆盖设置 → 用量今日分块的取数口径。
//
// 跑在 dist 产物上：先 `tsc`（或 `pnpm build`）再 `node --test test/*.test.mjs`。
// 表结构来自真实 SQLITE_MIGRATIONS，不手写 DDL——手写 DDL 会和线上 schema 悄悄漂移，
// 而这条查询的全部风险恰好都在列名与状态枚举上。
//
// 这里断言的是 `queryAppUsage` 的 `days` 分块，因为 usage-stats-builder 的 `today`
// 直接取其中 endDayIndex 那一行：只要按日的 token 拆分或三类表的合并有一处漏填，
// 设置页的今日卡就会显示 0 或 undefined，而不是报错。
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { SQLITE_MIGRATIONS } from "../dist/storage/session-store/migrations.js";
import { queryAppUsage } from "../dist/storage/session-store/repositories/usage.js";

const DAY_MS = 86_400_000;
// 用一个非零偏移（UTC+8）证明归桶确实按调用方时区，而不是 UTC 日界。
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function createDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`create table if not exists schema_migration (
    id text primary key, checksum text not null, app_version text, time_applied integer not null
  )`);
  for (const migration of SQLITE_MIGRATIONS) db.exec(migration.sql);
  return db;
}

function insertSession(db, id) {
  db.prepare(
    `insert into session (
       id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
       time_created, time_updated, task_type
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, "proj", "ws", null, id, "/tmp/ws", "/tmp/ws", id, "1", 1, 1, "interactive");
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

function insertTurnUsage(db, row) {
  db.prepare(
    `insert into turn_usage (
       session_id, turn_id, status, started_at, duration_ms, computed_total_tokens
     ) values (?, ?, ?, ?, ?, ?)`,
  ).run(row.sessionId, row.turnId, row.status ?? "completed", row.startedAt, row.durationMs ?? 0, 0);
}

function insertToolUsage(db, row) {
  db.prepare(
    `insert into tool_usage (id, session_id, tool_call_id, tool_name, status, started_at, duration_ms)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.sessionId, row.id, row.toolName, row.status, row.startedAt, row.durationMs ?? null);
}

/** 某个本地日的起点（unix ms）。dayIndex 是「本地午夜当作 UTC」的日序号。 */
function localDayStart(dayIndex) {
  return dayIndex * DAY_MS - TZ_OFFSET_MS;
}

function dayIndexOf(timestampMs) {
  return Math.floor((timestampMs + TZ_OFFSET_MS) / DAY_MS);
}

test("按日聚合带出 token 拆分，与区间合计逐项对账（单一本地日窗口）", async () => {
  const db = createDb();
  insertSession(db, "s1");

  const day = 20_000;
  const base = localDayStart(day) + 60_000;
  insertModelUsage(db, {
    id: "r1",
    sessionId: "s1",
    status: "completed",
    startedAt: base,
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: 3,
    cacheCreationTokens: 5,
    cacheReadTokens: 60,
    computedTotalTokens: 110,
  });
  insertModelUsage(db, {
    id: "r2",
    sessionId: "s1",
    status: "completed",
    startedAt: base + 1_000,
    inputTokens: 200,
    outputTokens: 20,
    cacheReadTokens: 120,
    computedTotalTokens: 220,
  });
  // 在途请求也计入：`queryAppUsage` 只按时间窗过滤，不按 status 过滤（`modelErrorCount`
  // 统计 error 行、而不是把它们排除）。这是设置页既有口径，今日分块必须与之一致——
  // 若在这里加 status='completed'，同一个窗口的"今日"就会与"合计"和热力图当日格子对不上。
  insertModelUsage(db, {
    id: "r3",
    sessionId: "s1",
    status: "running",
    startedAt: base + 2_000,
    inputTokens: 500,
    computedTotalTokens: 888,
  });

  const result = await queryAppUsage(db, {
    since: localDayStart(day),
    until: localDayStart(day + 1) - 1,
    tzOffsetMs: TZ_OFFSET_MS,
  });

  assert.equal(result.days.length, 1);
  const [row] = result.days;
  assert.equal(row.dayIndex, day);
  // 单日窗口下按日聚合必须与区间合计逐项相等，否则"今日"和"合计"会在同一屏互相打脸。
  assert.equal(row.totalTokens, result.totals.totalTokens);
  assert.equal(row.inputTokens, result.totals.inputTokens);
  assert.equal(row.outputTokens, result.totals.outputTokens);
  assert.equal(row.reasoningTokens, result.totals.reasoningTokens);
  assert.equal(row.cacheCreationTokens, result.totals.cacheCreationTokens);
  assert.equal(row.cacheReadTokens, result.totals.cacheReadTokens);
  assert.equal(row.modelRequestCount, result.totals.modelRequestCount);
  assert.deepEqual(
    {
      totalTokens: row.totalTokens,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      modelRequestCount: row.modelRequestCount,
    },
    {
      totalTokens: 1218,
      inputTokens: 800,
      outputTokens: 30,
      reasoningTokens: 3,
      cacheCreationTokens: 5,
      cacheReadTokens: 180,
      modelRequestCount: 3,
    },
  );
});

test("总量取存库的 computed_total_tokens，不由输入/输出/推理重算", async () => {
  const db = createDb();
  insertSession(db, "s1");

  const day = 20_000;
  const base = localDayStart(day) + 60_000;
  // 故意让存库总量与"输入 + 输出 + 推理"不等：真实写入路径（recordModelUsage）把它定为
  // 「输入侧 + 输出」，推理已经含在里面。若查询改成由分项重算，这里会立刻变成 1700 而不是 900。
  insertModelUsage(db, {
    id: "r1",
    sessionId: "s1",
    status: "completed",
    startedAt: base,
    inputTokens: 700,
    outputTokens: 200,
    reasoningTokens: 800,
    computedTotalTokens: 900,
  });

  const result = await queryAppUsage(db, {
    since: localDayStart(day),
    until: localDayStart(day + 1) - 1,
    tzOffsetMs: TZ_OFFSET_MS,
  });

  assert.equal(result.days[0].totalTokens, 900);
  assert.equal(result.totals.totalTokens, 900);
  assert.notEqual(result.days[0].totalTokens, 700 + 200 + 800);
});

test("跨本地日的请求分到各自的 dayIndex，且按调用方时区而非 UTC 归桶", async () => {
  const db = createDb();
  insertSession(db, "s1");

  const day = 20_000;
  const dayStart = localDayStart(day);
  // 本地日 00:30 与 23:30：UTC 下分别是前一天 16:30 与当天 15:30，落在不同的 UTC 日。
  // 归桶若用 UTC，这两条会散开；按调用方时区才落进同一天。
  insertModelUsage(db, {
    id: "early",
    sessionId: "s1",
    status: "completed",
    startedAt: dayStart + 30 * 60_000,
    inputTokens: 10,
    computedTotalTokens: 10,
  });
  insertModelUsage(db, {
    id: "late",
    sessionId: "s1",
    status: "completed",
    startedAt: dayStart + 23 * 60 * 60_000 + 30 * 60_000,
    inputTokens: 20,
    computedTotalTokens: 20,
  });

  const result = await queryAppUsage(db, {
    since: dayStart,
    until: dayStart + DAY_MS - 1,
    tzOffsetMs: TZ_OFFSET_MS,
  });

  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].dayIndex, day);
  assert.equal(result.days[0].totalTokens, 30);
  assert.equal(result.days[0].modelRequestCount, 2);

  // 后一天的窗口里不应再出现这一天的行——今日分块不允许被前一天的数据污染。
  const nextDay = await queryAppUsage(db, {
    since: dayStart + DAY_MS,
    until: dayStart + 2 * DAY_MS - 1,
    tzOffsetMs: TZ_OFFSET_MS,
  });
  assert.equal(nextDay.days.length, 0);
  assert.equal(nextDay.totals.totalTokens, 0);
});

test("turn / tool 计数合并进同一个 dayIndex，缺表的分组也补零而不是 undefined", async () => {
  const db = createDb();
  insertSession(db, "s1");

  const day = 20_000;
  const otherDay = day - 1;
  const dayStart = localDayStart(day);
  insertTurnUsage(db, { sessionId: "s1", turnId: "t1", startedAt: dayStart + 1_000 });
  insertTurnUsage(db, { sessionId: "s1", turnId: "t2", startedAt: dayStart + 2_000, status: "error" });
  insertToolUsage(db, { id: "tool1", sessionId: "s1", toolName: "Read", status: "completed", startedAt: dayStart + 1_000 });
  insertToolUsage(db, { id: "tool2", sessionId: "s1", toolName: "Bash", status: "error", startedAt: dayStart + 2_000 });
  // 另一天只有 tool_usage：该行必须带着零值字段出现，不能让 builder 取到 undefined。
  insertToolUsage(db, {
    id: "tool3",
    sessionId: "s1",
    toolName: "Grep",
    status: "completed",
    startedAt: localDayStart(otherDay) + 5_000,
  });

  const result = await queryAppUsage(db, {
    since: localDayStart(otherDay),
    until: dayStart + DAY_MS - 1,
    tzOffsetMs: TZ_OFFSET_MS,
  });

  const byDay = new Map(result.days.map((row) => [row.dayIndex, row]));
  const today = byDay.get(day);
  assert.equal(today.turnCount, 2);
  assert.equal(today.toolCallCount, 2);
  assert.equal(today.totalTokens, 0);
  assert.equal(today.inputTokens, 0);
  assert.equal(today.modelRequestCount, 0);

  const previous = byDay.get(otherDay);
  assert.equal(previous.toolCallCount, 1);
  assert.equal(previous.turnCount, 0);
  assert.equal(previous.totalTokens, 0);
  assert.equal(previous.modelRequestCount, 0);
  // 计数分组也按同一偏移归桶：tool3 只应落在 otherDay。
  assert.equal(result.toolTotals.toolCallCount, 3);
  assert.equal(result.turnTotals.totalTurns, 2);
  assert.equal(dayIndexOf(localDayStart(otherDay) + 5_000), otherDay);
});
