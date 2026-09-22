import process from "node:process";

// 桌面端只发行这两支架构；electron-builder 的 Arch 枚举是 1=x64、3=arm64。
const SUPPORTED_TARGET_ARCHES = Object.freeze(["x64", "arm64"]);
const ELECTRON_BUILDER_ARCH_NAMES = Object.freeze({ 1: "x64", 3: "arm64" });

function normalizeTargetOs(rawOs) {
  const value = (rawOs ?? "").toLowerCase();
  switch (value) {
    case "mac":
    case "macos":
    case "darwin":
    case "osx":
      return "darwin";
    case "win":
    case "windows":
    case "win32":
      return "win32";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported target OS: ${rawOs}`);
  }
}

function normalizeTargetArch(rawArch) {
  const value = (rawArch ?? "").toLowerCase();
  switch (value) {
    case "x64":
    case "amd64":
    case "x86_64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      throw new Error(`Unsupported target arch: ${rawArch}`);
  }
}

export function createTargetPlatform({ os, arch }) {
  const normalizedOs = normalizeTargetOs(os);
  const normalizedArch = normalizeTargetArch(arch);

  return {
    os: normalizedOs,
    arch: normalizedArch,
    key: `${normalizedOs}-${normalizedArch}`,
    npmOs: normalizedOs,
    npmCpu: normalizedArch,
    // 部分 Linux optional native 包声明了 libc=glibc。
    // 跨平台 prepare 时如果只传 --os/--cpu，npm 仍会按宿主机 libc 判定为不匹配，导致补装失败。
    npmLibc: normalizedOs === "linux" ? "glibc" : undefined,
  };
}

/**
 * 解析 `--arch` / `ZCODE_TARGET_ARCHES` 形式的架构集合（`x64,arm64`、`x64 arm64` 或数组）。
 * 一个平台要在同一次 electron-builder 调用里产出多支架构，就必须能一次解析出多个架构。
 */
export function normalizeTargetArchList(rawValue) {
  const items = Array.isArray(rawValue) ? rawValue : String(rawValue ?? "").split(/[,\s]+/);
  const arches = [];

  for (const item of items) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) continue;
    const arch = normalizeTargetArch(trimmed);
    if (!arches.includes(arch)) arches.push(arch);
  }

  if (arches.length === 0) {
    throw new Error(
      `未解析出任何目标架构: ${String(rawValue)}（支持 ${SUPPORTED_TARGET_ARCHES.join("/")}）`,
    );
  }

  return arches;
}

/**
 * 本次构建**显式声明**的架构集合；返回 null 表示没有声明（例如绕过 bundle.mjs 直接调用
 * electron-builder），此时不限制 pack context 的架构，只校验平台。
 */
export function resolveDeclaredTargetArches(env = process.env) {
  const raw = env.ZCODE_TARGET_ARCHES ?? env.ZCODE_TARGET_ARCH;
  if (raw == null || String(raw).trim() === "") return null;
  return normalizeTargetArchList(raw);
}

/**
 * job 级目标平台。OS 取 `ZCODE_TARGET_OS`，架构取 `ZCODE_TARGET_ARCH`（单架构场景，如
 * prepare 脚本的按架构调用）。多架构场景下每个 pack target 的架构由
 * `resolvePackContextTarget()` 从 electron-builder 的 pack context 解析。
 */
export function getTargetPlatform({ arch } = {}) {
  return createTargetPlatform({
    os: process.env.ZCODE_TARGET_OS ?? process.platform,
    arch: arch ?? process.env.ZCODE_TARGET_ARCH ?? process.arch,
  });
}

export function getTargetOs() {
  return normalizeTargetOs(process.env.ZCODE_TARGET_OS ?? process.platform);
}

export function getTargetPlatforms(arches) {
  const os = process.env.ZCODE_TARGET_OS ?? process.platform;
  return arches.map((arch) => createTargetPlatform({ os, arch }));
}

export function resolveElectronBuilderArchName(arch) {
  const archName = ELECTRON_BUILDER_ARCH_NAMES[arch];
  if (!archName) {
    throw new Error(`[electron-builder.config] 不支持的 electron-builder 架构: ${String(arch)}`);
  }
  return archName;
}

/**
 * 把 electron-builder 的 pack context 解析成目标平台。
 *
 * 架构相关配置必须按 pack target 解析：一次调用内会有多个 `context.arch`，
 * 用 env 里声明的单一架构替代会让另一支架构静默套用错误的 prebuild / 打包资源。
 */
export function resolvePackContextTarget({
  electronPlatformName,
  arch,
  expectedOs,
  declaredArches,
}) {
  const target = createTargetPlatform({
    os: electronPlatformName,
    arch: resolveElectronBuilderArchName(arch),
  });

  if (expectedOs != null && target.os !== expectedOs) {
    throw new Error(
      `[electron-builder.config] pack context 平台 ${target.os} 与本次构建的目标平台 ${expectedOs} 不一致`,
    );
  }

  if (declaredArches != null && !declaredArches.includes(target.arch)) {
    throw new Error(
      `[electron-builder.config] pack context 架构 ${target.arch} 不在本次构建声明的架构集合内: ${declaredArches.join(", ")}`,
    );
  }

  return target;
}

export function resolvePlatformKeyForPackagedApp() {
  return `${process.platform}-${process.arch}`;
}
