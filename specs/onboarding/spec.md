# 首次引导（Occupation Onboarding）v2

本仓来自上游 v3.14.3（`328c1a0`）的 onboarding v2 移植。上游那一版同时引入账号维度
（userId 认领、按身份回填）；本仓账号体系已删除，因此**只移植与身份无关的两条规则**：
「关闭过就不再打扰」与「本机已有任务就不再引导」。userId 在本仓恒为 `null`。

## 背景与目标

v1 只记「作答」：用户关掉引导（Esc / 关闭按钮）等同于什么都没发生，下次启动又被引导拦一次。
v2 增加**决策记账**，并让「老用户」不再被打扰：

- 关掉 → 记 `dismissed`，之后 `shouldOnboard()` 为 false；
- 本机已有任务（tasks-index 非空）→ 记 `existing_local_user`，之后同样为 false。

## 数据形状（唯一所有者：本地记录文件）

`~/.zcode/v2/onboarding-record.json`（随 `dataBaseDir`），由
`packages/services/src/onboarding/onboardingRecordService.ts` 独占读写，UI 只经
`IOnboardingRecordService` 调用：

```jsonc
{
  "version": 2,
  "deviceMid": "<设备锚点>",
  "entries": [
    /* 完成引导的作答，每 userId 至多一条 */
  ],
  "decisions": [
    /* 未完成/不追问的决策，每 userId 至多一条 */
  ],
}
```

- `decisions[].status`：`dismissed`（用户关闭，`reason: user_closed`）或
  `existing_local_user`（`reason: existing_local_task`）。
- `entries` 与 `decisions` 互斥：写入作答时清掉同一 userId 的决策（作答是更强的信号）。
- **v1 文件不迁移**：读取时按 v1 解析并补 `decisions: []`（升为 v2 视图），下次业务写入
  自然落成 v2。文件损坏（手改/写坏）等价于"从未记录"，按缺失处理并重建。

## 规则

1. **触发判定** `shouldOnboard(deviceMid)`：
   1. 文件里存在该 userId 的作答或决策 → `false`；
   2. 否则若本机已有任务（`hasExistingLocalTask()`，装配处接 tasks-index）→ 落一条
      `existing_local_user` 决策并返回 `false`；
   3. 否则 `true`（应当引导）。
2. **关闭记账** `dismissOnboarding(deviceMid)`：已有作答时是空操作（作答优先）；
   否则写入/覆盖该 userId 的 `dismissed` 决策。**失败不阻塞 UI**：调用方只记 warn。
3. **作答写入** `appendRecord(deviceMid, entry)`：覆盖同一 userId 的旧条目（不打追加），
   并清掉该 userId 的决策。
4. **deviceMid 以文件内已有值为权威**：传入值不同只记 warn 并沿用旧值（v1 既有规则，不变）。
5. **UI 关闭路径统一**：Esc、关闭按钮、`onClose` 都走 `closeOnboarding`，其中写入关闭决策。

## 本仓差异（与上游的偏离）

- `CreateOnboardingRecordServiceOptions.loadUserId` / `hasExistingLocalTask` 在本仓**可选**：
  无注入时 userId 为 `null`、`hasExistingLocalTask()` 视为 `false`（退化到 v1 判定），
  保证只构造 `createOnboardingRecordService()` 的旧装配点仍可用。
- 不移植 `claimAnonymousRecord` 的账号语义之外的行为变更——本仓该方法在 userId 为 null 时
  直接返回（既有行为），但补上"已有作答/决策即幂等返回"的守卫。
- `useOnboardingTrigger` 保留本仓的超时兜底（RPC 缺失时 3 秒退回 settings 判定）。

## 验收

- 全新设备（无记录、无任务）：`shouldOnboard()` 为 true，引导出现。
- 关闭引导后：文件里出现 `dismissed` 决策；再次 `shouldOnboard()` 为 false，引导不再出现。
- 有旧记录（无 decisions、无任务）：仍按 entries 判定；关闭后写入 decisions，文件 version 变 2。
- 已有本地任务、从未作答：`shouldOnboard()` 为 false 且落 `existing_local_user` 决策（不写 entries）。
- 写入作答后再关闭：`decisions` 不出现该 userId 的条目（作答优先，关闭是空操作）。
- 记录文件损坏：按缺失处理，引导照常触发，下次写入重建文件。
