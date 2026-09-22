const SUPPORTED_DESKTOP_PLATFORM_OSES = ["darwin", "linux", "win32"];
const SUPPORTED_DESKTOP_PLATFORM_KEYS = SUPPORTED_DESKTOP_PLATFORM_OSES.flatMap((os) => [
  `${os}-x64`,
  `${os}-arm64`,
]);

function assertSupportedTargetPlatformKey(targetPlatformKey) {
  if (!SUPPORTED_DESKTOP_PLATFORM_KEYS.includes(targetPlatformKey)) {
    throw new Error(`不支持的桌面目标平台: ${targetPlatformKey}`);
  }
}

function assertSupportedTargetPlatformKeyPattern(targetPlatformKeyPattern) {
  const [os, ...archParts] = String(targetPlatformKeyPattern).split("-");
  if (!SUPPORTED_DESKTOP_PLATFORM_OSES.includes(os) || archParts.join("-") !== "${arch}") {
    throw new Error(
      `不支持的桌面目标平台 key 模式: ${targetPlatformKeyPattern}（期望形如 win32-\${arch}）`,
    );
  }
}

/**
 * node-pty 目录裁剪：排除全部 prebuilds（含安装机现场编译物与非目标平台包），再**重新包含**
 * 本次 pack target 的 prebuild。
 *
 * 这里用 `${arch}` 宏而不是具体 key，是因为一次 electron-builder 调用会同时产出多支架构：
 * electron-builder 会按 target 单独展开宏（`app-builder-lib/out/fileMatcher.js`），而模式匹配是
 * 后匹配者胜（`app-builder-lib/out/util/filter.js` 的 `minimatchAll`），所以重包含成立。
 * 漏保留本架构 prebuild 会被 `findDesktopNativePackageViolations` 兜底拦住。
 */
export function createDesktopNativePackagePrunePatterns(targetPlatformKeyPattern) {
  assertSupportedTargetPlatformKeyPattern(targetPlatformKeyPattern);

  return [
    // PDF 预览已经由 Vite 打进 renderer，pdfjs-dist 的 Canvas optional dependency
    // 只服务 Node 渲染；pnpm 跨平台安装的 8 套 Canvas native 不应带进桌面安装包。
    "!node_modules/@napi-rs/canvas/**",
    "!node_modules/@napi-rs/canvas-*/**",
    // Linux prebuild 会在 beforePack 复制进 node-pty；源平台包本身不属于桌面运行时。
    "!node_modules/@lydell/node-pty-*/**",
    // 桌面运行时统一使用目标 prebuild，禁止把安装机现场编译物或 ABI bin 缓存带进跨平台包。
    "!node_modules/node-pty/build/**",
    "!node_modules/node-pty/bin/**",
    "!node_modules/node-pty/prebuilds/**",
    `node_modules/node-pty/prebuilds/${targetPlatformKeyPattern}/**`,
  ];
}

function normalizeAsarPath(path) {
  const normalized = path.trim().replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function parseAsarListWithPackState(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(pack|unpack)\s*:\s*(.+)$/.exec(line);
      if (!match) {
        throw new Error(`无法解析 asar pack state: ${line}`);
      }
      return { packState: match[1], path: normalizeAsarPath(match[2]) };
    });
}

function isNativeRuntimeFile(path, targetPlatformKey) {
  if (/\.(?:node|dll|dylib|exe)$/i.test(path)) return true;
  return path === `/node_modules/node-pty/prebuilds/${targetPlatformKey}/spawn-helper`;
}

export function findDesktopNativePackageViolations(entries, targetPlatformKey) {
  assertSupportedTargetPlatformKey(targetPlatformKey);
  const violations = [];

  for (const entry of entries) {
    const { packState, path } = entry;

    if (
      path === "/node_modules/@napi-rs/canvas" ||
      path.startsWith("/node_modules/@napi-rs/canvas/") ||
      path.startsWith("/node_modules/@napi-rs/canvas-")
    ) {
      violations.push(`不应打包 renderer 无需的 Canvas native: ${path}`);
      continue;
    }

    if (path.startsWith("/node_modules/@lydell/node-pty-")) {
      violations.push(`不应打包仅用于准备 prebuild 的平台源包: ${path}`);
      continue;
    }

    if (
      path.startsWith("/node_modules/node-pty/build/") ||
      path.startsWith("/node_modules/node-pty/bin/")
    ) {
      violations.push(`不应打包安装机生成的 node-pty 产物: ${path}`);
      continue;
    }

    const nodePtyPrebuildMatch = /^\/node_modules\/node-pty\/prebuilds\/([^/]+)/.exec(path);
    if (nodePtyPrebuildMatch && nodePtyPrebuildMatch[1] !== targetPlatformKey) {
      violations.push(`node-pty 包含非目标平台 prebuild: ${path}`);
      continue;
    }

    if (isNativeRuntimeFile(path, targetPlatformKey) && packState !== "unpack") {
      violations.push(`native 文件仍作为 packed payload 留在 app.asar: ${path}`);
    }
  }

  return violations;
}
