/* oxlint-disable eslint(max-lines) */
/**
 * WelcomeScreen —— 「连接你自己的供应商」首次引导
 *
 * 应用没有登录态：这里只提供添加 API Key 供应商这一条可用路径。
 * 用户也可以先跳过，稍后在设置页的「模型供应商」里添加。
 */
import type { ReactNode } from "react";
import { Button } from "./components/ui/button.js";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { AddProviderForm } from "@/settings/model-provider-section/AddProviderForm.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";

interface WelcomeScreenProps {
  onComplete: () => void | Promise<void>;
}

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const { intl } = useZCodeIntl();

  return (
    <main className="relative flex h-full min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6">
      <ThemeHeroVisual className="absolute inset-0" />
      <div className="pointer-events-none absolute left-0 top-0 right-0 z-10 flex h-12 w-full items-center [app-region:drag]" />
      <section className="relative z-10 w-full flex flex-col gap-10 max-w-sm rounded-2xl border border-popover-border bg-background p-8 text-ui-base/relaxed shadow-md sm:p-10">
        <LoginPanelHeader
          title={intl.formatMessage({ id: "login.title" })}
          description={intl.formatMessage({ id: "login.description" })}
        />
        <div className="space-y-6">
          <AddProviderForm onSaved={onComplete} />
          <Button
            type="button"
            variant="link"
            className="h-7 w-full text-ui-base text-foreground-subtle hover:text-foreground"
            onClick={() => void onComplete()}
          >
            {intl.formatMessage({ id: "login.skip" })}
          </Button>
        </div>
      </section>
    </main>
  );
}

function LoginPanelHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <LoginPanelLogo />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-ui-base/relaxed text-foreground-subtle">{description}</p>
      </div>
    </header>
  );
}

function LoginPanelLogo(): ReactNode {
  return (
    // 登录 logo 壳是固定深色底，边框不能跟随浅色主题 token，否则浅色主题下边框过重。
    <div
      className="relative mb-1 flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-lg/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-[rgba(255,255,255,0.1)]"
      aria-label="ZCode"
      role="img"
    >
      <ZCodeAboutLogo className="h-auto w-10" />
    </div>
  );
}
