import { TID_ABOUT_DIALOG, TID_ABOUT_DIALOG_CONFIRM } from "@zcode/shared";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ZCodeStartupLogoBadge } from "@/root/RootStartupLoading.js";
import { useAboutDialogStore } from "@/store/aboutDialogStore.js";

/**
 * 「关于」对话框宿主，与 AlertDialogHost / ConfirmDialogHost 同层挂在 RootShell 上。
 *
 * 之前这里是 main 进程自绘的原生 BrowserWindow（frameless + transparent）。Windows 上那是
 * layered 窗口，它的创建与销毁都会让主窗口的 Acrylic 合成表面失效：主窗口底色是
 * `#00000000`，backdrop 一失效整窗就变全透明，用户会看到 ZCode 后面的窗口。
 * 现在 main 只下发展示事实（`PlatformChannels.ShowAbout`），对话框完全由 renderer 渲染，
 * 这条路径不再创建任何原生窗口，因此不再产生窗口合成事件。
 */
export function AboutDialogHost() {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const payload = useAboutDialogStore((state) => state.payload);
  const openAbout = useAboutDialogStore((state) => state.openAbout);
  const closeAbout = useAboutDialogStore((state) => state.closeAbout);

  // 自绘帮助菜单、原生应用菜单、托盘三条入口都收敛到这一条订阅。
  useEffect(() => platform.onShowAbout((next) => openAbout(next)), [platform, openAbout]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closeAbout();
      }
    },
    [closeAbout],
  );

  return (
    <Dialog open={Boolean(payload)} onOpenChange={handleOpenChange}>
      {/* 与 AlertDialogHost 一致：内容始终挂载，退出动画交给 Radix 的 Presence 处理。 */}
      <DialogContent
        data-testid={TID_ABOUT_DIALOG}
        className="max-w-xs gap-5"
        showCloseButton={false}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <ZCodeStartupLogoBadge animated={false} />
          <DialogHeader className="items-center gap-1">
            <DialogTitle>{intl.formatMessage({ id: "titleBar.menu.help.about" })}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "about.dialog.versionLabel" })} {payload?.appVersion}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 text-ui-caption text-foreground-subtle">
            {payload?.isOptimizedForAppleSilicon ? (
              <p>{intl.formatMessage({ id: "about.dialog.optimizedForAppleSilicon" })}</p>
            ) : null}
            <p>
              {intl.formatMessage(
                { id: "about.dialog.copyright" },
                { year: new Date().getFullYear() },
              )}
            </p>
          </div>
        </div>
        <DialogFooter className="sm:justify-center">
          {/* 自动聚焦确定按钮：保留原原生弹框「回车即关闭」的行为。 */}
          <Button
            type="button"
            autoFocus
            onClick={closeAbout}
            data-testid={TID_ABOUT_DIALOG_CONFIRM}
          >
            {intl.formatMessage({ id: "about.dialog.okButton" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
