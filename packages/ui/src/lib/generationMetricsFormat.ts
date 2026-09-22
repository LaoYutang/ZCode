import { calculateOutputTps } from "@zcode/shared";
import type { V4ConversationUsageDetailResult } from "@zcode/shared/zcode-protocol-v4";

type TimedGeneration = V4ConversationUsageDetailResult["latestTimedGeneration"];

/**
 * 完成态生成速度（t/s）：输出 ÷（总耗时 − 首 token 等待）。
 *
 * 输入来自后端的 `latestTimedGeneration`——那里已经保证是真实生成、且两项计时齐全，
 * 所以这里不会因为"最近一条请求是标题生成"之类的原因算不出值。
 * 注意口径：这是**完成态**速率（一次请求的总输出 ÷ 生成段耗时），不是流式过程中的瞬时速率。
 */
export function resolveGenerationTps(generation: TimedGeneration): number | null {
  if (!generation) return null;
  return calculateOutputTps(
    generation.outputTokens,
    generation.durationMs - generation.timeToFirstTokenMs,
  );
}

/** 速度文本（含单位）；无法计算时返回 null，由调用方决定隐藏还是占位。 */
export function formatGenerationTps(locale: string, tps: number | null): string | null {
  if (tps === null) return null;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(tps)} t/s`;
}

/** 首字延迟：不足 1s 用 ms，其余用 s（ms/s 是技术单位，不随语言本地化）。 */
export function formatFirstTokenLatency(locale: string, ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ms)}ms`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000)}s`;
}
