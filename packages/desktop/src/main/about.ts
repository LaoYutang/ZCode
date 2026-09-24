import { existsSync, readFileSync } from "node:fs";
import { arch, hostname, platform, release, type, version as osVersion } from "node:os";
import { join } from "node:path";
import {
  type AboutDialogPayload,
  ZCODE_BUILD_TIME,
  ZCODE_COMMIT,
  ZCODE_ENV,
  ZCODE_VERSION,
} from "@zcode/shared";

interface DesktopBuildMetadata {
  appVersion?: string;
  buildCommitId?: string;
  buildTime?: string;
  electronBuilderVersion?: string;
}

interface AboutSnapshot {
  appVersion: string;
  buildCommitId: string;
  buildTime: string;
  environment: string;
  electronVersion: string;
  electronBuilderVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  v8Version: string;
  osType: string;
  osPlatform: string;
  osRelease: string;
  osVersion: string;
  osArch: string;
  hostname: string;
}

interface AboutSnapshotOptions {
  appVersion?: string;
  buildMetadata?: DesktopBuildMetadata | null;
  environment?: string;
  runtimeVersions?: Pick<NodeJS.ProcessVersions, "electron" | "chrome" | "node" | "v8">;
  osInfo?: {
    type: string;
    platform: string;
    release: string;
    version: string;
    arch: string;
    hostname: string;
  };
}

function normalizeValue(value: string | undefined | null): string {
  if (typeof value !== "string") {
    return "unknown";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function normalizePackageVersion(version: string | undefined): string {
  const normalized = normalizeValue(version);
  return normalized === "unknown" ? normalized : normalized.replace(/^[^\d]*/, "") || normalized;
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function resolveBuildMetadataPath(): string {
  return join(import.meta.dirname, "../metadata/build-meta.json");
}

export function readBuildMetadata(
  filePath = resolveBuildMetadataPath(),
): DesktopBuildMetadata | null {
  // 之前 About 直接读取编译时注入的常量，commit/time 只能代表 tsup 那一刻。
  // 问题原因：构建和打包是分步执行的，安装包里的 about 需要的是“最终产物”的统一元数据，而不是某个编译子步骤的快照。
  // 这里优先读打包前生成的 build-meta.json；只有缺文件时才回退到编译时常量。
  return readJsonFile<DesktopBuildMetadata>(filePath);
}

function resolveElectronBuilderVersion(buildMetadata: DesktopBuildMetadata | null): string {
  if (buildMetadata?.electronBuilderVersion) {
    return normalizeValue(buildMetadata.electronBuilderVersion);
  }

  const packageJson = readJsonFile<{ devDependencies?: Record<string, string> }>(
    join(import.meta.dirname, "../../package.json"),
  );
  return normalizePackageVersion(packageJson?.devDependencies?.["electron-builder"]);
}

export function createAboutSnapshot(options: AboutSnapshotOptions = {}): AboutSnapshot {
  const buildMetadata = options.buildMetadata ?? null;
  const runtimeVersions = options.runtimeVersions ?? process.versions;
  const osInfo = options.osInfo ?? {
    type: type(),
    platform: platform(),
    release: release(),
    version: osVersion(),
    arch: arch(),
    hostname: hostname(),
  };

  return {
    appVersion: normalizeValue(options.appVersion ?? buildMetadata?.appVersion ?? ZCODE_VERSION),
    buildCommitId: normalizeValue(buildMetadata?.buildCommitId ?? ZCODE_COMMIT),
    buildTime: normalizeValue(buildMetadata?.buildTime ?? ZCODE_BUILD_TIME),
    environment: normalizeValue(options.environment ?? ZCODE_ENV),
    electronVersion: normalizeValue(runtimeVersions.electron),
    electronBuilderVersion: resolveElectronBuilderVersion(buildMetadata),
    chromiumVersion: normalizeValue(runtimeVersions.chrome),
    nodeVersion: normalizeValue(runtimeVersions.node),
    v8Version: normalizeValue(runtimeVersions.v8),
    osType: normalizeValue(osInfo.type),
    osPlatform: normalizeValue(osInfo.platform),
    osRelease: normalizeValue(osInfo.release),
    osVersion: normalizeValue(osInfo.version),
    osArch: normalizeValue(osInfo.arch),
    hostname: normalizeValue(osInfo.hostname),
  };
}

export function formatAboutDetail(snapshot: AboutSnapshot): string {
  return [
    `Version: ${snapshot.appVersion}`,
    `Commit: ${snapshot.buildCommitId}`,
    `Build Time: ${snapshot.buildTime}`,
    `Environment: ${snapshot.environment}`,
    "",
    `Electron: ${snapshot.electronVersion}`,
    `Electron Builder: ${snapshot.electronBuilderVersion}`,
    `Chromium: ${snapshot.chromiumVersion}`,
    `Node.js: ${snapshot.nodeVersion}`,
    `V8: ${snapshot.v8Version}`,
    "",
    `OS Type: ${snapshot.osType}`,
    `OS Platform: ${snapshot.osPlatform}`,
    `OS Release: ${snapshot.osRelease}`,
    `OS Version: ${snapshot.osVersion}`,
    `OS Arch: ${snapshot.osArch}`,
    `Hostname: ${snapshot.hostname}`,
  ].join("\n");
}

/**
 * 构造「关于」对话框的展示事实，由 renderer 的内置 modal 渲染。
 *
 * 之前这里是 `showAboutDialog`：main 进程新建一个 `transparent: true` 的 frameless
 * BrowserWindow 加载 data URL。Windows 上那是 layered 窗口，它的创建与销毁会让主窗口的
 * Acrylic 合成表面失效——主窗口底色是 `#00000000`，backdrop 一失效整窗就变全透明，
 * 用户会看到 ZCode 后面的窗口。改为只产出数据、由 renderer 渲染内置 modal 后，
 * 这条路径不再创建任何原生窗口。
 *
 * 版本取值优先级与 `createAboutSnapshot` 一致：调用方传入的 `app.getVersion()` →
 * build-meta.json → 编译时常量 `ZCODE_VERSION`。
 */
export function createAboutDialogPayload(
  options: AboutSnapshotOptions = {},
): AboutDialogPayload {
  const snapshot = createAboutSnapshot(options);
  return {
    appVersion: snapshot.appVersion,
    isOptimizedForAppleSilicon: snapshot.osPlatform === "darwin" && snapshot.osArch === "arm64",
  };
}
