/**
 * token 数的单位统一成 K/M/B（千/百万/十亿），**不随语言**在「万/亿」与 K/M 之间切换。
 *
 * 依据：用量数字同时出现在状态面板、明细页与设置→用量里，必须能横向比较；中文 locale 下
 * 的「万/亿」会让同一个数在两处读起来不是一个量级。K/M/B 与 t/s、ms 一样属于技术单位。
 * 数值本身仍按 locale 格式化（小数分隔符等），只有单位后缀固定。
 */
const COMPACT_TOKEN_UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
] as const;

function formatWithUnit(
  locale: string,
  value: number,
  divisor: number,
  suffix: string,
  maximumFractionDigits: number,
): string {
  const scaled = value / divisor;
  // 关掉千分位：缩放过后的数值只在进位边界才会到四位数（如 999999 → "1000K"），
  // 此时 "1,000K" 反而是噪音。
  return `${new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
    useGrouping: false,
  }).format(scaled)}${suffix}`;
}

export function formatCompactTokenNumber(
  locale: string,
  value: number,
  options: { maximumFractionDigits?: number } = {},
): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const maximumFractionDigits = options.maximumFractionDigits ?? 1;
  const absValue = Math.abs(value);
  for (const unit of COMPACT_TOKEN_UNITS) {
    if (absValue >= unit.threshold) {
      return formatWithUnit(locale, value, unit.threshold, unit.suffix, maximumFractionDigits);
    }
  }
  return new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

/**
 * 上下文容量固定用 K（千）：同一对「已用 / 上限」不允许出现两种单位。
 *
 * 代价是 1M 窗口会显示成 `1000K`——这是刻意的：要么成对统一，要么回到按量级切档。
 * 上限/已用都走这里，模型目录里的容量 badge 走的是 `formatModelContextWindowLabel`。
 */
export function formatTokenThousands(
  locale: string,
  value: number,
  options: { maximumFractionDigits?: number } = {},
): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const maximumFractionDigits = options.maximumFractionDigits ?? 1;
  // 不足 1000 就不挂单位：`0K` / `0.9K` 比 `0` / `850` 更难读。
  if (Math.abs(value) < 1_000) {
    return new Intl.NumberFormat(locale || undefined, {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
      useGrouping: false,
    }).format(value);
  }
  return formatWithUnit(locale, value, 1_000, "K", maximumFractionDigits);
}

export function formatModelContextWindowLabel(contextWindow: number, _locale = "en-US"): string {
  // 模型列表的容量 badge 是"能装多少"的规格，仍是 K/M/B 档（1M 窗口继续读作 1M），
  // 不属于"当前占用"的上下文读数。
  return formatCompactTokenNumber("en-US", contextWindow);
}
