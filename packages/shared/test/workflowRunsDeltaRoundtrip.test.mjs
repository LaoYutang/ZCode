// 工作流键级增量的契约测试（随 v3.14.3 从上游摘取）。
//
// `workflowRuns` 从整键重发改成键级增量后，正确性只挂在一条定律上（见
// src/zcode-protocol-v4/workflow-runs-delta.ts 的文件头）：
//   `JSON.stringify(apply(prior, diff(prior, next))) === JSON.stringify(next)` —— **逐字节**。
// 键序是这条定律的一部分，所以比对用 JSON 序列化而不是深相等。
//
// 两个场景：小规模不溢出（同时验证条目级事件的幂等重放），以及宽 fan-out 越过条目上界
// （验证表内受界、表外仍可数、格子的 failed ≤ settled ≤ actors）。
import assert from "node:assert/strict";
import { test } from "node:test";

const { reduceWorkflowRunsState } =
  await import("../src/zcode-protocol-v4/workflow-runs-reducer.ts");
const { diffWorkflowRunsState, applyWorkflowRunUpdated, applyWorkflowRunRemoved } =
  await import("../src/zcode-protocol-v4/workflow-runs-delta.ts");
const { WORKFLOW_RUNS_LIMITS } = await import("../src/zcode-protocol-v4/workflow-runs.ts");

/** 条目级事件：同一条在同一位置连续应用两次，第二次必须判「无变化」。 */
const REPLAYABLE = new Set(["actor-created", "node-queued", "node-dispatched", "node-settled"]);

function applyDeltas(state, deltas) {
  let next = state;
  for (const delta of deltas) {
    if (delta.op === "workflowRun.updated") next = applyWorkflowRunUpdated(next, delta);
    else if (delta.op === "workflowRun.removed") next = applyWorkflowRunRemoved(next, delta);
    else throw new Error(`未知 op: ${delta.op}`);
  }
  return next;
}

/** 一段 run 事件流：fanout 个子代理各自 出生 → 入队 → 派活 → 结算。 */
function buildEvents(runId, fanout) {
  const events = [{ runId, eventType: "run-started", sequence: 1, payload: {} }];
  events.push({
    runId,
    eventType: "phase-entered",
    sequence: 2,
    payload: { phaseName: "collect" },
  });
  for (let i = 0; i < fanout; i += 1) {
    const actor = { siteId: "s10", ordinal: i };
    const instance = { siteId: "s20", ordinal: i };
    events.push({
      runId,
      eventType: "actor-created",
      sequence: 3 + i * 4,
      payload: { actor, name: `agent-${i}`, phaseName: "collect" },
    });
    events.push({
      runId,
      eventType: "node-queued",
      sequence: 4 + i * 4,
      payload: { instance, actor, kind: "ask", phaseName: "collect" },
    });
    events.push({
      runId,
      eventType: "node-dispatched",
      sequence: 5 + i * 4,
      payload: { instance, actor, phaseName: "collect" },
    });
    events.push({
      runId,
      eventType: "node-settled",
      sequence: 6 + i * 4,
      payload: { instance, actor, outcome: "ok", phaseName: "collect" },
    });
  }
  return events;
}

/** 逐事件归约，并对每一次 prior→next 做 diff/apply 往返的逐字节比对。 */
function replayAndDiff(events) {
  let state;
  let steps = 0;
  for (const envelope of events) {
    const prior = state;
    const next = reduceWorkflowRunsState(prior, envelope);
    if (next === null) continue;
    const applied = applyDeltas(prior, diffWorkflowRunsState(prior, next));
    assert.equal(
      JSON.stringify(applied.workflowRuns),
      JSON.stringify(next.workflowRuns),
      `往返必须逐字节一致: ${envelope.eventType}#${envelope.sequence}`,
    );
    assert.equal(applied.revision, next.revision, "revision 必须一致");
    if (REPLAYABLE.has(envelope.eventType)) {
      assert.equal(
        reduceWorkflowRunsState(next, envelope),
        null,
        `紧邻重放不得抬 revision: ${envelope.eventType}#${envelope.sequence}`,
      );
    }
    state = next;
    steps += 1;
  }
  return { state, steps };
}

test("键级增量：小规模 run 的往返逐字节一致，条目级事件幂等", () => {
  const { state, steps } = replayAndDiff(buildEvents("run-a", 24));
  const run = state.runs.find((item) => item.runId === "run-a");
  assert.ok(steps > 24, "应当有实际的归约步数");
  assert.equal(run.actors.length, 24);
  assert.equal(run.nodes.length, 24);
  assert.equal(run.truncated, undefined, "不溢出的 run 不该带 truncated");
});

test("键级增量：宽 fan-out 越界时表内受界、表外可数", () => {
  const fanout = WORKFLOW_RUNS_LIMITS.maxActors + 126;
  const { state } = replayAndDiff(buildEvents("run-b", fanout));
  const run = state.runs.find((item) => item.runId === "run-b");
  assert.ok(run.actors.length <= WORKFLOW_RUNS_LIMITS.maxActors, "actors 不得越界");
  assert.ok(run.nodes.length <= WORKFLOW_RUNS_LIMITS.maxNodes, "nodes 不得越界");
  assert.equal(run.truncated, true, "越界后必须置 truncated");
  const unlisted = run.unlistedByPhase ?? [];
  const unlistedActors = unlisted.reduce((sum, phase) => sum + phase.actors, 0);
  assert.ok(unlistedActors > 0, "被淘汰的子代理必须仍然可数");
  for (const phase of unlisted) {
    // 本格法律：每次改动之后整格夹到 failed ≤ settled ≤ actors。
    const settled = phase.actorsSettled ?? 0;
    const failed = phase.actorsFailed ?? 0;
    assert.ok(failed <= settled, "failed ≤ settled");
    assert.ok(settled <= phase.actors, "settled ≤ actors");
  }
});
