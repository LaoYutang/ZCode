import {
  isAutoUpdateEnabledForUpdateSource,
  isExternalUpdateInstallSource,
  ZCODE_UPDATE_SOURCE,
  type UpdateStatePayload,
  type ZCodeUpdateSource,
} from "@zcode/shared";

// 更新入口跟随更新源而不是产品身份：换用自己的 GitHub Release 时同样要显示入口。
export function shouldShowDesktopUpdateEntry(
  source: ZCodeUpdateSource = ZCODE_UPDATE_SOURCE,
): boolean {
  return isAutoUpdateEnabledForUpdateSource(source);
}

/**
 * 更新主按钮是「前往下载」还是「下载并更新」。
 * 只决定文案与选项；真正打开 Release 页面还是进入下载流程由 main 独占裁决。
 */
export function opensReleasePageForUpdate(
  source: ZCodeUpdateSource = ZCODE_UPDATE_SOURCE,
): boolean {
  return isExternalUpdateInstallSource(source);
}

export function getUpdateMenuLabelId(state: UpdateStatePayload | null) {
  switch (state?.kind) {
    case "checking":
      return "desktopMenu.help.checkingForUpdates";
    case "update-available":
      return "desktopMenu.help.updateAvailableVersion";
    case "download-progress":
      return "desktopMenu.help.downloadingUpdateProgress";
    case "update-downloaded":
      return "desktopMenu.help.restartToUpdate";
    case "idle":
    default:
      return "titleBar.menu.help.checkForUpdates";
  }
}

export function getUpdateMenuLabelValues(
  state: UpdateStatePayload | null,
): Record<string, string> | undefined {
  switch (state?.kind) {
    case "update-available":
    case "update-downloaded":
      return { version: state.version };
    case "download-progress":
      return { progress: state.progress };
    default:
      return undefined;
  }
}
