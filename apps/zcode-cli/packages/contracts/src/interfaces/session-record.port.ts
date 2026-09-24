// ============================================================
// 会话记录契约：session 行、创建/更新/列举输入、fork 与回退元数据
// ============================================================
// 从 session-store.port.ts 拆出，理由与 dwf-journal-introspection.ts 同一条：那份契约已到
// oxlint 的 max-lines 上限。公开面不变——主端口文件原地再导出这里的每一个名字，
// `@zcode/contracts` 的导入路径逐字不动。

import type { MessageId, PartId, ProjectId, SessionId, TraceId, WorkspaceId } from "./shared.js";
import type { GoalStatus, SessionGoal } from "../tools/target.js";
import type { PermissionRuleset } from "./permission.port.js";
import type { SessionEntryInfo, SessionInputDelivery } from "./session-entry.port.js";
import type { MessageWithParts } from "./session-part.port.js";

export const SESSION_TASK_TYPES = [
  "interactive",
  "fork",
  "selection_side_chat",
  "workflow_parent",
  "workflow_child",
  "subagent_child",
  "nested_workflow_child",
] as const;
export type SessionTaskType = (typeof SESSION_TASK_TYPES)[number];

export const SESSION_TITLE_SOURCES = ["default", "first_input", "generated", "custom"] as const;
export type SessionTitleSource = (typeof SESSION_TITLE_SOURCES)[number];

export interface SessionInfo {
  id: SessionId;
  projectID: ProjectId;
  workspaceID?: WorkspaceId;
  parentID?: SessionId;
  traceID?: TraceId;
  taskType: SessionTaskType;
  slug: string;
  directory: string;
  path?: string;
  title: string;
  titleSource?: SessionTitleSource;
  titleMessageID?: MessageId;
  version: string;
  shareURL?: string;
  summaryAdditions?: number;
  summaryDeletions?: number;
  summaryFiles?: number;
  summaryDiffs?: FileDiff[];
  revert?: SessionRevert;
  permission?: PermissionRuleset;
  time: {
    created: number;
    updated: number;
    titleUpdated?: number;
    compacting?: number;
    archived?: number;
  };
}

export interface CreateSessionInput {
  id: SessionId;
  projectID: ProjectId;
  workspaceID?: WorkspaceId;
  parentID?: SessionId;
  traceID?: TraceId;
  taskType?: SessionTaskType;
  slug: string;
  directory: string;
  path?: string;
  title: string;
  titleSource?: SessionTitleSource;
  titleMessageID?: MessageId;
  version: string;
  shareURL?: string;
  permission?: PermissionRuleset;
  time?: {
    created?: number;
    updated?: number;
  };
}

/** V4 stable fork resolver 固定的目标 product turn segment。 */
export interface StableForkTargetMetadata {
  productTurnId: string;
  transcriptTurnId: string;
  orderedMessageIds: string[];
  boundaryMessageId: string;
}

/** 与 child session 同事务落盘的命令幂等事实。 */
export interface ForkChildSessionMetadata {
  parentSessionId: string;
  sourceCommandId: string;
  forkTarget: StableForkTargetMetadata;
}

export type ForkCommandResult =
  | { type: "forkAssistant"; sessionId: string }
  | { type: "createSelectionSideSession"; sessionId: string }
  | { type: "editUserQuery"; disposition: "fork"; sessionId: string };

/**
 * conversation fork 的唯一原子提交载荷。core 在内存完成 remap；adapter 不参与业务裁决，
 * 只保证 child/copy/goal/entries/input/parent command fact 全有或全无。
 */
export interface ForkCommitBundle {
  child: CreateSessionInput;
  messages: MessageWithParts[];
  entries: SessionEntryInfo[];
  /** 存储复制来源（目标 ID -> 父记录 ID）；只保留旧磁盘快照，不参与模型选择。 */
  copySources?: { messages: Record<string, string>; parts: Record<string, string> };
  goal?: { source: SessionGoal; status: GoalStatus };
  initialInput?: {
    id: string;
    sessionID: SessionId;
    kind: string;
    delivery: SessionInputDelivery;
    payload: { text: string; [key: string]: unknown };
  };
  commandFact: {
    parentSessionId: string;
    sourceCommandId: string;
    ack: {
      commandId: string;
      status: "accepted";
      revisionAtDecision: number;
      result: ForkCommandResult;
    };
    metadata: Record<string, unknown>;
  };
}

export interface UpdateSessionInput {
  id: SessionId;
  directory?: string;
  path?: string | null;
  timeUpdated?: number;
  title?: string;
  titleSource?: SessionTitleSource;
  titleMessageID?: MessageId | null;
  expectedTitleSources?: readonly SessionTitleSource[];
  shareURL?: string | null;
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
    diffs?: FileDiff[];
  } | null;
  revert?: SessionRevert | null;
  permission?: PermissionRuleset | null;
  timeCompacting?: number | null;
  timeArchived?: number | null;
}

export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  oldPath?: string;
  newPath?: string;
}

export interface SessionRevert {
  messageID: MessageId;
  partID?: PartId;
  snapshot?: string;
  diff?: string;
  kind?: "conversation_rewind";
  scope?: "conversation" | "workspace" | "both";
  targetMessageID?: MessageId;
  createdMessageID?: MessageId;
  keptMessageIDs?: MessageId[];
  /**
   * append-only conversation branch 的 cut 游标：本次 rewind 提交前最后一条持久消息。
   * active branch = keptMessageIDs + 该消息之后新追加的消息。旧 createdMessageID 仅用于兼容。
   */
  branchCutAfterMessageID?: MessageId;
  /** 每次 destructive conversation rewind 单调递增，用于隔离旧分支异步结果。 */
  branchGeneration?: number;
}

export interface ListSessionsInput {
  projectID?: ProjectId;
  /** undefined = 不按 identity 过滤；null = 仅本地/legacy 空 identity；字符串 = 精确 workspace identity。 */
  workspaceID?: WorkspaceId | null;
  directory?: string;
  path?: string;
  roots?: boolean;
  taskTypes?: SessionTaskType[];
  includeArchived?: boolean;
  limit?: number;
}

export interface ClaimLegacySessionWorkspaceInput {
  sessionIDs: SessionId[];
  directory: string;
  workspaceID: WorkspaceId;
}

export interface RepairLegacyRemoteSessionWorkspaceInput {
  sessionID: SessionId;
  projectID: ProjectId;
  legacyWorkspaceDirectory: string;
  workspaceID: WorkspaceId;
  workspacePath: string;
}

export interface RepairRemoteSessionPathsInput {
  sessionID: SessionId;
  workspaceID: WorkspaceId;
  expectedDirectory: string;
  expectedPath: string | null;
  directory: string;
  path: string | null;
  timeUpdated: number;
}
