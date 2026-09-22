#!/usr/bin/env node
// 发布资产收集：决定哪些构建产物进 GitHub Release、以什么名字、校验和怎么写。
//
// 只使用 Node 内置模块：publish job 不执行 pnpm install，脚本必须能被直接执行。
// 行为契约见 specs/build/desktop-release-pipeline.md。

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// electron-builder 的排障输出（生效的文件匹配规则转储）。每个平台各一份、basename 相同，
// 既不是客户端需要的资产，又会让整批上传因重名失败 —— 因此固定排除。
export const EXCLUDED_RELEASE_FILE_NAMES = Object.freeze(["builder-debug.yml"]);

export const DEFAULT_SHA256SUMS_FILE_NAME = "SHA256SUMS.txt";

function toPosixPath(path) {
  return path.split(sep).join("/");
}

export async function listFilesRecursive(rootDir) {
  const files = [];

  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // 目录不存在与目录为空在发布语境下是同一件事：没有可发布的产物。
      // 调用方会带着路径报错，这里不吞掉其他 IO 错误。
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(toPosixPath(relative(rootDir, absolutePath)));
      }
    }
  };

  await visit(rootDir);
  return files.sort();
}

/**
 * 选出进入 Release 的文件，并断言 basename 唯一。
 *
 * 重名必须在创建 draft 之前失败：`gh release upload` 在单次调用内并发上传，
 * `--clobber` 只处理调用开始前已存在的同名资产，批内重名会让整批上传失败并留下残缺 draft。
 */
export function selectReleaseAssets(
  relativePaths,
  { excludedFileNames = EXCLUDED_RELEASE_FILE_NAMES } = {},
) {
  const excluded = new Set(excludedFileNames);
  const assets = [];
  const skipped = [];

  for (const relativePath of relativePaths) {
    const name = basename(relativePath);
    if (excluded.has(name)) {
      skipped.push(relativePath);
      continue;
    }
    assets.push({ path: relativePath, name });
  }

  const pathsByName = new Map();
  for (const asset of assets) {
    const existing = pathsByName.get(asset.name) ?? [];
    existing.push(asset.path);
    pathsByName.set(asset.name, existing);
  }

  const conflicts = [...pathsByName.entries()].filter(([, paths]) => paths.length > 1);
  if (conflicts.length > 0) {
    const detail = conflicts.map(([name, paths]) => `- ${name}: ${paths.join(", ")}`).join("\n");
    throw new Error(
      `发布资产存在同名文件，无法确定保留哪一个（重名会让 gh release upload 整批失败）:\n${detail}`,
    );
  }

  return { assets, skipped };
}

export function formatSha256Sums(entries) {
  // 与 `sha256sum` 的输出格式一致：两个空格分隔，名字用资产名（不带目录前缀），
  // 这样用户对下载到的文件可以直接 `sha256sum -c SHA256SUMS.txt`。
  return `${entries.map(({ name, sha256 }) => `${sha256}  ${name}`).join("\n")}\n`;
}

async function hashFile(absolutePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * 收集、校验并落盘发布资产清单。
 * 返回的上传列表包含生成的 SHA256SUMS.txt（它本身也要上传，但不参与自己的校验和）。
 */
export async function prepareReleaseAssets({
  assetsDir,
  listFile,
  sha256SumsFileName = DEFAULT_SHA256SUMS_FILE_NAME,
}) {
  const rootDir = resolve(assetsDir);
  const allFiles = await listFilesRecursive(rootDir);
  if (allFiles.length === 0) {
    throw new Error(`没有可发布的产物: ${rootDir}`);
  }

  const { assets, skipped } = selectReleaseAssets(allFiles);
  if (assets.length === 0) {
    throw new Error(`没有可发布的产物（全部被排除）: ${rootDir}`);
  }

  const entries = [];
  for (const asset of assets) {
    entries.push({ name: asset.name, sha256: await hashFile(join(rootDir, asset.path)) });
  }

  const sumsPath = join(rootDir, sha256SumsFileName);
  await writeFile(sumsPath, formatSha256Sums(entries), "utf8");

  const uploadPaths = [
    ...assets.map((asset) => asset.path),
    toPosixPath(relative(rootDir, sumsPath)),
  ];
  if (listFile) {
    await mkdir(resolve(listFile, ".."), { recursive: true });
    // NUL 分隔：资产名或路径含空格时 `mapfile -d ''` / `xargs -0` 不会拆错。
    await writeFile(listFile, `${uploadPaths.join("\0")}\0`, "utf8");
  }

  return { entries, uploadPaths, skipped, sumsPath };
}

function readOption(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(`发布资产收集

用法:
  node packages/desktop/scripts/release-assets.mjs --assets-dir release-assets --list-file upload-files.txt

参数:
  --assets-dir <dir>    构建产物目录（默认 release-assets）
  --list-file <path>    写出 NUL 分隔的上传列表（默认 release-upload-files.txt；传 "" 可跳过）
  --sums-name <name>    SHA256SUMS 文件名（默认 ${DEFAULT_SHA256SUMS_FILE_NAME}）
`);
    return;
  }

  const assetsDir = readOption(argv, "--assets-dir", "release-assets");
  const listFile = readOption(argv, "--list-file", "release-upload-files.txt");
  const sha256SumsFileName = readOption(argv, "--sums-name", DEFAULT_SHA256SUMS_FILE_NAME);

  const { entries, uploadPaths, skipped } = await prepareReleaseAssets({
    assetsDir,
    listFile,
    sha256SumsFileName,
  });

  for (const path of skipped) {
    console.log(`[release-assets] 排除: ${path}`);
  }
  console.log(
    `[release-assets] 上传 ${uploadPaths.length} 个文件（含 ${sha256SumsFileName}），已校验 basename 唯一`,
  );
  console.log(`[release-assets] ${entries.length} 个文件已写入 ${sha256SumsFileName}`);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryHref === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(`[release-assets] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
