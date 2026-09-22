import {
  BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES,
  type BuiltinZCodeSlashCommandHelpEntry,
} from "@zcode/shared";

/** 共享词表即 CLI 的命令面：这里不再做名字过滤（/login、/logout 已从词表删除）。 */
export const SLASH_COMMAND_HELP_ENTRIES: readonly BuiltinZCodeSlashCommandHelpEntry[] =
  BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES;

export type SlashCommandHelpEntry = BuiltinZCodeSlashCommandHelpEntry;
