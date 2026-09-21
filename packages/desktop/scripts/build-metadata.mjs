import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const moduleDir = import.meta.dirname;

function findPackageDir(packageName, startDirs) {
  for (const startDir of startDirs) {
    let currentDir = resolve(startDir);

    while (true) {
      const packageJsonPath = resolve(currentDir, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = readJson(packageJsonPath);
          if (packageJson.name === packageName) {
            return currentDir;
          }
        } catch {
          // ignore invalid package.json and continue walking up
        }
      }

      const parentDir = resolve(currentDir, "..");
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  throw new Error(`Unable to find package directory for ${packageName}`);
}

const desktopDir = findPackageDir("@zcode/desktop", [
  moduleDir,
  resolve(moduleDir, ".."),
  process.cwd(),
]);
const workspaceDir = resolve(desktopDir, "../..");
const metadataDir = resolve(desktopDir, "out/metadata");
const metadataPath = resolve(metadataDir, "build-meta.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** 开发态占位版本。必须是合法 semver：electron-builder 会校验 version 字段，非法值直接抛错。 */
export const DEV_APP_VERSION = "0.0.0-dev";
const RELEASE_TAG_ENV = "ZCODE_RELEASE_TAG";
/** 三段数字 + 可选 prerelease 后缀。与 build-windows-browser-import-helper.mjs 的校验保持同一口径。 */
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function normalizeVersion(version) {
  if (typeof version !== "string" || version.length === 0) {
    return "unknown";
  }

  const normalized = version.replace(/^[^\d]*/, "");
  return normalized || version;
}

/**
 * HEAD 正好落在 tag 上时返回该 tag，否则 null。
 * 必须用 --exact-match：否则普通提交会继承最近一个 tag 的版本，把开发构建伪装成发布版本。
 */
function resolveExactTagVersion() {
  try {
    const tag = execSync("git describe --tags --exact-match HEAD", {
      cwd: workspaceDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return tag || null;
  } catch {
    return null;
  }
}

/** 显式覆盖优先，其次是 CI 的 tag 构建，最后才回退到本地 git 探测。 */
export function resolveReleaseTag(env = process.env, readExactTag = resolveExactTagVersion) {
  const explicitTag = env[RELEASE_TAG_ENV]?.trim();
  if (explicitTag) {
    return explicitTag;
  }

  if (env.GITHUB_REF_TYPE?.trim() === "tag") {
    return env.GITHUB_REF_NAME?.trim() || null;
  }

  return readExactTag();
}

/**
 * 应用版本以 git tag 为唯一来源（见 specs/build/app-version-source.md）。
 * 坏 tag 直接失败而不是静默降级：静默出版本会让产物带着错误版本流到客户端，且客户端无法自愈。
 */
export function resolveAppVersion(env = process.env, readExactTag = resolveExactTagVersion) {
  const tag = resolveReleaseTag(env, readExactTag);
  if (!tag) {
    return DEV_APP_VERSION;
  }

  const version = normalizeVersion(tag);
  if (!APP_VERSION_PATTERN.test(version)) {
    throw new Error(
      `Invalid app version from tag "${tag}": expected semver like v3.14.1, got "${version}"`,
    );
  }

  return version;
}

function resolveInstalledPackageVersion(packageName, fallbackVersion) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [desktopDir] });
    return normalizeVersion(readJson(packageJsonPath).version);
  } catch {
    return normalizeVersion(fallbackVersion);
  }
}

function resolveCommitId() {
  try {
    return execSync("git rev-parse --short=8 HEAD", {
      cwd: workspaceDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return process.env.ZCODE_COMMIT ?? "unknown";
  }
}

export function collectBuildMetadata() {
  const desktopPackageJson = readJson(resolve(desktopDir, "package.json"));

  return {
    appVersion: resolveAppVersion(),
    buildCommitId: resolveCommitId(),
    buildTime: new Date().toISOString(),
    electronBuilderVersion: resolveInstalledPackageVersion(
      "electron-builder",
      desktopPackageJson.devDependencies?.["electron-builder"],
    ),
  };
}

export function readBuildMetadata() {
  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    return readJson(metadataPath);
  } catch {
    return null;
  }
}

export function getBuildMetadata() {
  return readBuildMetadata() ?? collectBuildMetadata();
}

export function writeBuildMetadata() {
  // About 之前分别在 tsup、vite 里各算一份 commit 和时间。
  // 问题原因：两次构建是独立进程，时间点天然不一致；后面再打包时，最终安装包里展示的信息也不一定对应同一次产物。
  // 这里先统一落盘成 build-meta.json，再让构建和运行时都复用同一份数据，保证 about 可追溯。
  const metadata = collectBuildMetadata();
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  return metadata;
}

export function getBuildMetadataPath() {
  return metadataPath;
}

const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentFilePath = fileURLToPath(import.meta.url);

if (entryFilePath === currentFilePath) {
  const metadata = writeBuildMetadata();
  process.stdout.write(`[build-meta] wrote ${metadataPath}\n`);
  process.stdout.write(
    `[build-meta] commit=${metadata.buildCommitId} time=${metadata.buildTime}\n`,
  );
}
