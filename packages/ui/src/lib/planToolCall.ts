import { getPathLeaf, isAbsoluteFilePath, joinFilePath } from "@/lib/path.js";

interface PlanToolCallSource {
  input?: unknown;
  inputText?: string;
  output?: unknown;
  raw?: unknown;
}

interface PlanToolCallContent {
  markdown?: string;
  planFilePath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}

function resolvePlanFilePath(path: string | undefined, workspacePath: string) {
  if (!path) return undefined;
  return isAbsoluteFilePath(path) ? path : joinFilePath(workspacePath, path);
}

function extractPlanMarkdown(source: unknown, workspacePath: string): PlanToolCallContent {
  if (typeof source === "string" && source.trim().length > 0) {
    return { markdown: source.trim() };
  }
  if (!isRecord(source)) return {};

  const markdown = readStringField(source, ["plan", "text", "content"]);
  const planFilePath = resolvePlanFilePath(
    readStringField(source, ["planFilePath"]),
    workspacePath,
  );
  return markdown ? { markdown, planFilePath } : {};
}

export function extractPlanToolCallContent(
  toolCall: PlanToolCallSource,
  workspacePath: string,
): PlanToolCallContent {
  const inputContent = extractPlanMarkdown(toolCall.input, workspacePath);
  if (inputContent.markdown) return inputContent;

  if (toolCall.inputText?.trim()) {
    try {
      const content = extractPlanMarkdown(JSON.parse(toolCall.inputText), workspacePath);
      if (content.markdown) return content;
    } catch {
      // 流式 inputText 可能暂时不是完整 JSON；继续走 legacy raw fallback。
    }
  }

  const outputContent = extractPlanMarkdown(toolCall.output, workspacePath);
  if (outputContent.markdown) return outputContent;

  if (!isRecord(toolCall.raw)) return {};
  for (const candidate of [toolCall.raw.rawInput, toolCall.raw.rawOutput]) {
    const content = extractPlanMarkdown(candidate, workspacePath);
    if (content.markdown) return content;
  }

  const rawContent = Array.isArray(toolCall.raw.content) ? toolCall.raw.content : [];
  for (const entry of rawContent) {
    if (!isRecord(entry)) continue;
    const nested = isRecord(entry.content) ? entry.content : entry;
    const content = extractPlanMarkdown(nested, workspacePath);
    if (content.markdown) return content;
  }
  return {};
}

const MARKDOWN_H1_PATTERN = /^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/m;
const MARKDOWN_LEADING_DECORATION = /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/;

/** 计划目录标题取首个 H1，否则取首个非空文本行。 */
export function getPlanDirectoryTitle(markdown: string): string | undefined {
  const h1 = MARKDOWN_H1_PATTERN.exec(markdown)?.[1]?.trim();
  if (h1) return h1;
  for (const line of markdown.split(/\r?\n/u)) {
    const title = line.replace(MARKDOWN_LEADING_DECORATION, "").trim();
    if (title) return title;
  }
  return undefined;
}

export function getPlanFileLabel(planFilePath?: string): string | undefined {
  return planFilePath ? getPathLeaf(planFilePath) : undefined;
}

interface PlanSelectionSource {
  sourceKey: string;
  sourceTitle: string;
  path?: string;
}

/**
 * 计划 tab 的选区来源标识。
 *
 * `sourceKey` 只由对话与工具调用决定，不随正文变化：计划正文来自 live 投影，
 * 若把它算进身份，流式期间同一份计划会被拆成多个来源，去重与 pill key 都会漂。
 */
export function resolvePlanSelectionSource(options: {
  parentSessionId: string;
  toolCallId: string;
  markdown: string;
  planFilePath?: string;
  fallbackTitle: string;
}): PlanSelectionSource {
  return {
    sourceKey: `plan:${options.parentSessionId}:${options.toolCallId}`,
    sourceTitle:
      getPlanDirectoryTitle(options.markdown) ??
      getPlanFileLabel(options.planFilePath) ??
      options.fallbackTitle,
    ...(options.planFilePath ? { path: options.planFilePath } : {}),
  };
}
