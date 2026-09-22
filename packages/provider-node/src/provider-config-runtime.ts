import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "./zcode-builtin-provider-config-source.js";
import {
  EndpointScopedZCodeBuiltinSource,
  type EndpointScopedZCodeBuiltinSourceOptions,
  type ZCodeBuiltinRefreshResult,
} from "./endpoint-scoped-zcode-builtin-source.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly zcodeBuiltinFilePath: string;
  readonly zcodeBuiltinActiveFilePath?: string;
  /** Endpoint 只影响缓存路径；内置配置来源始终是打包文件，无远端下发。 */
  readonly zcodeBuiltinEnvironment?: Omit<
    EndpointScopedZCodeBuiltinSourceOptions,
    "bundledFilePath"
  >;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    zcodeBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/** 组装一个 Node.js 进程内共享的 ZCode Built-in/Personal Config 运行边界。 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #zcodeBuiltinSource:
    | NodeZCodeBuiltinProviderConfigSource
    | EndpointScopedZCodeBuiltinSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<void> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#zcodeBuiltinSource = options.zcodeBuiltinEnvironment
      ? new EndpointScopedZCodeBuiltinSource({
          bundledFilePath: options.zcodeBuiltinFilePath,
          ...options.zcodeBuiltinEnvironment,
        })
      : new NodeZCodeBuiltinProviderConfigSource({
          bundledFilePath: options.zcodeBuiltinFilePath,
          activeFilePath: options.zcodeBuiltinActiveFilePath,
          watch: options.watch,
        });
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#zcodeBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      zcodeBuiltinSource: this.#zcodeBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveZCodeBuiltinActiveFilePath(): Promise<string> {
    return this.#zcodeBuiltinSource instanceof NodeZCodeBuiltinProviderConfigSource
      ? Promise.resolve(this.#zcodeBuiltinSource.activeFilePath)
      : this.#zcodeBuiltinSource.resolveActiveFilePath();
  }

  get personalRepository(): import("@zcode/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** Environment 同一周期检查中恢复未对齐依赖，不被下载 TTL 或失败挡住。 */
  onDidCheckZCodeBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // Managed Worker 无下载配置也无恢复 owner，不建立周期任务。
      if (
        this.#zcodeBuiltinSource instanceof EndpointScopedZCodeBuiltinSource ||
        this.#checkListeners.size > 0
      ) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  refreshZCodeBuiltin(): Promise<ZCodeBuiltinRefreshResult> {
    if (this.#disposed) return Promise.resolve("disposed");
    if (this.#zcodeBuiltinSource instanceof EndpointScopedZCodeBuiltinSource) {
      return this.#zcodeBuiltinSource.refresh();
    }
    // 无 Endpoint 作用域的 Source 也没有远端来源。
    return Promise.resolve("skipped");
  }

  #checkBackground(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    // 内置配置没有远端来源，无需刷新；这里只驱动已登记的检查监听器。
    const check = Promise.allSettled([
      ...[...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ])
      .then(() => undefined)
      .finally(() => {
        if (this.#checkInFlight === check) this.#checkInFlight = null;
      });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#zcodeBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
