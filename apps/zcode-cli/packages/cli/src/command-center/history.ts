import type { TuiPromptInput } from "@zcode/tui";
import type { CommandCenterDeps } from "./types.js";

/**
 * 把已识别的 slash 命令写入输入历史。
 *
 * 过去这里额外跳过「/login …-api-key <key>」以免明文密钥进历史；账号登录入口
 * 已随账号能力移除，命令面里不再有携带密钥的 slash 命令。
 */
export async function recordSlashCommandInHistory(
  deps: CommandCenterDeps,
  input: TuiPromptInput,
): Promise<void> {
  if (!deps.recordInputHistory) return;
  try {
    await deps.recordInputHistory(input, "slash_command");
  } catch {
    // Input history is recall UX; command execution must not depend on it.
  }
}
