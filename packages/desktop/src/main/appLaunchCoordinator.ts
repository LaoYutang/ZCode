interface AppLaunchGateLike {
  consume(): boolean;
}

/**
 * app launch 遥测只上报一次：首个 renderer ready 时消费启动 gate。
 *
 * 原实现在有 pending OAuth 回调时会把这次上报推迟到回调处理完（遥测要带登录身份）；
 * 无账号模式没有登录回调，renderer ready 即代表启动链路完成。
 */
export function createAppLaunchCoordinator(appLaunchGate: AppLaunchGateLike) {
  return {
    onRendererReady(_input: { rendererId: number }): boolean {
      return appLaunchGate.consume();
    },
  };
}
