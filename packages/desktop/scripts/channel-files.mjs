import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// 架构别名来自各 target 的实际命名：deb 用 amd64/aarch64，AppImage/rpm 用 x86_64/aarch64，
// nsis/zip/pacman 用 x64/arm64。判定必须覆盖全部别名，否则会把已产出的架构误判成缺失。
export const artifactArchHintsByArch = {
  x64: ["x64", "x86_64", "amd64"],
  arm64: ["arm64", "aarch64"],
};

export const SUPPORTED_TARGET_ARCHES = Object.freeze(["x64", "arm64"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function artifactNameMatchesArch(fileName, archHint) {
  // 部分环境的安装包会在架构后追加后缀（如 mac-arm64_TEST.dmg）。
  // 体积审计必须接受 "_" 作为架构后的分隔符，否则包已生成但审计阶段会误报找不到产物。
  return new RegExp(`-${escapeRegExp(archHint.toLowerCase())}(?:[._-])`, "i").test(fileName);
}

const CHANNEL_FILE_NAMES_BY_OS = {
  mac: ["latest-mac.yml"],
  win: ["latest.yml"],
  linux: ["latest-linux.yml", "latest-linux-arm64.yml"],
};

export function channelFileNamesForOs(os) {
  const names = CHANNEL_FILE_NAMES_BY_OS[os];
  if (!names) throw new Error(`不支持的目标操作系统: ${os}`);
  return [...names];
}

/**
 * 本次构建应当产出的更新描述文件，以及每个文件必须覆盖的架构。
 *
 * Windows / macOS 的文件名不带架构后缀（客户端按平台固定取 `latest.yml` / `latest-mac.yml`），
 * 因此同一个文件必须覆盖该平台的全部架构；Linux 的文件名按架构分开，各覆盖自己的架构。
 */
export function expectedChannelFiles({ os, arches }) {
  if (os === "linux") {
    const fileNameByArch = {
      x64: "latest-linux.yml",
      arm64: "latest-linux-arm64.yml",
    };
    return arches.map((arch) => ({ fileName: fileNameByArch[arch], expectedArches: [arch] }));
  }

  const fileName = CHANNEL_FILE_NAMES_BY_OS[os]?.[0];
  if (!fileName) throw new Error(`不支持的目标操作系统: ${os}`);
  return [{ fileName, expectedArches: [...arches] }];
}

/** 统计一份更新描述文件覆盖了哪些架构。 */
export function collectChannelFileArches(channelFile) {
  const parsed = typeof channelFile === "string" ? parseYaml(channelFile) : channelFile;
  const fileUrls = Array.isArray(parsed?.files)
    ? parsed.files.map((entry) => String(entry?.url ?? "")).filter(Boolean)
    : [];
  // `path` 是 electron-updater 1.x 的兼容字段，只在没有 files[] 时兜底。
  if (fileUrls.length === 0 && parsed?.path) fileUrls.push(String(parsed.path));

  return SUPPORTED_TARGET_ARCHES.filter((arch) =>
    fileUrls.some((fileName) =>
      artifactArchHintsByArch[arch].some((hint) => artifactNameMatchesArch(fileName, hint)),
    ),
  );
}

export function assertChannelFileCoverage({ fileName, content, expectedArches }) {
  const coveredArches = collectChannelFileArches(content);
  const missingArches = expectedArches.filter((arch) => !coveredArches.includes(arch));

  if (missingArches.length > 0) {
    // 漏架构意味着客户端会拿到只描述一支架构（或空 files[]）的更新清单，
    // 表现是“检测不到更新”，排查成本很高，所以在构建阶段直接失败。
    throw new Error(
      `${fileName} 未覆盖本次构建的架构 ${missingArches.join("、")}（已覆盖: ${coveredArches.join("、") || "无"}）`,
    );
  }

  return coveredArches;
}

/**
 * 校验本平台产出的更新描述文件存在且覆盖了本次构建的全部架构。
 * 一次调用只产出一支架构（本地单架构打包）时，只校验那一支。
 */
export function verifyChannelFileCoverage({ os, arches, distDir }) {
  return expectedChannelFiles({ os, arches }).map(({ fileName, expectedArches }) => {
    const filePath = join(distDir, fileName);
    if (!existsSync(filePath)) {
      throw new Error(`缺少更新描述文件: ${filePath}`);
    }

    return {
      fileName,
      expectedArches,
      coveredArches: assertChannelFileCoverage({
        fileName,
        content: readFileSync(filePath, "utf8"),
        expectedArches,
      }),
    };
  });
}
