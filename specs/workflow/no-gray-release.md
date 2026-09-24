# 动态工作流不设灰度

## 背景

上游把「动态工作流」放在一条账号驱动的灰度门后：

- 取值来自官方 `GET /api/v1/client/configs` 的 `configs.dynamicWorkflow.mode`，取值域 `disabled` / `onDemand` / `alwaysOn`，服务端缺省 `disabled`（fail-closed）。
- 本地可用环境变量 `ZCODE_DYNAMIC_WORKFLOW_MODE` 覆盖，Desktop main 按构建档位改写：未打包 dev 透传 shell、preview 固定 `alwaysOn`、production 删除继承值。
- 决策点是 Host 侧的 `resolveDynamicWorkflowGate()`（`packages/services/src/zcode-agent/zcodeAgentService.ts`），它读取装配注入的 `resolveDynamicWorkflowClientConfig`。

这条链路的取值提供方在 fork 中不存在：上游由 `packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts` 提供（订阅服务读远端 + 环境变量覆盖），去账号化时该目录整体删除，`packages/services/src/node.ts` 的接线随之消失，而 `resolveDynamicWorkflowGate()` 在 provider 缺席时直接返回 `false`。

后果是一条静默的整段关闭：

```
Host 判定恒 false
  → 不发 workspace/updateDynamicWorkflowPolicy
  → CLI 保持缺省 dynamicWorkflowEnabled = false（zcode-protocol/server.ts 的 fail-closed 缺省）
  → 目录里没有内置 /workflow（zcode-protocol/slash-commands.ts 的过滤）
  → 会话不注册工作流工具簇，内置 dynamic-workflows 技能也不下发
  → 桌面 / Web 上「装了但整体不可见」
```

本仓不接入官方分发链路，也没有任何远端灰度通道可言，因此不再让可用性取决于一个读不到的值。

## 规则

### 1. 可用性由本仓直接裁定，不看远端

Host 装配处（`packages/services/src/node.ts`）注入常量快照：

```ts
resolveDynamicWorkflowClientConfig: async () =>
  createDynamicWorkflowClientConfig("alwaysOn", "override"),
```

`source: "override"` 表达的正是「本地裁定」，`alwaysOn` 沿用上游取值域，避免另造一套布尔语义。

### 2. UI 侧同步为恒启用

`packages/ui/src/hooks/useDynamicWorkflowAvailability.ts` 返回同一份常量快照。该 hook 之前的注释已经写明「无账号形态下 renderer 没有账号无关的灰度读取通道，入口跟随缺省关闭」；现在改为按本仓裁定启用，run 详情页的恢复入口与自动化页的工作流页签随之可见。

### 3. 上游取值域保留为接口，但不参与决策

`packages/shared/src/dynamic-workflow-feature.ts` 的取值域、归一化与 `ZCODE_DYNAMIC_WORKFLOW_MODE_ENV` **保留**：它们是与 CLI/远端共享的类型契约，删除只会增加跟版成本。本仓的两个决策点（Host 与 UI）不再引用远端取值，环境变量也因此不再影响可用性——它仍被 Desktop main 写入 Host 进程环境，属于上游残留，不构成开关。

### 4. headless 的 `--enable-workflow` 不属于灰度

`zcode -p/--target --enable-workflow` 保留原语义：headless 没有脚本确认环节，工作流按本次调用显式开启，缺省关闭。它与「要不要在某处露出这个功能」无关，因此不随本条规则一起放开。

## 验收

- 桌面端 `/` 面板的目录包含 `/workflow`（门开时目录为 `/goal /workflow /compact /init /plan`，门关时为四条）。
- 会话创建时带 `dynamicWorkflowEnabled`，工作流工具簇与 `dynamic-workflows` 技能可用。
- run 详情页的恢复入口与自动化页的工作流页签可见。
- `zcode`（TUI）行为不变：该 flag 缺省本就为「不设门」，TUI 一直是全功能。
