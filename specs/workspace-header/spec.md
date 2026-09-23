# 工作区 Header 草稿态动作入口

## 背景

桌面端会话右上角的「在 {editor} 中打开」（`WorkspaceEditorButtonGroup`）此前**只在已有会话出现**，新建会话（草稿态）看不到。

原因是一条按 variant 的裁剪：

- `WorkspaceShellLayout` 用 `variant={activeTaskId === null ? "draft" : "task"}` 区分草稿态与已有会话（`packages/ui/src/app-shell/WorkspaceShellLayout.tsx`）。
- `WorkspaceHeaderActionSection` 只在 `variant === "task"` 时渲染编辑器按钮组，草稿态直接不渲染。

但「打开工作区」并不依赖 task 作用域：草稿态同样持有稳定的 `workspaceAbsPath`、`workspaceIdentity`、`remoteTarget`，`handleOpenEditor` 也只调用 `platform.openInEditor`。它属于**工作区级**动作，不是「task 专属内容」，按 variant 裁剪属于过度裁剪。

本 spec 定义草稿态（新建会话）也展示该入口的行为与边界。

## 规则

### 一、动作入口不再按 variant 裁剪

`WorkspaceHeaderActionSection` 无条件渲染 `WorkspaceEditorButtonGroup`；`variant === "task"` 门槛与其在 `WorkspaceHeaderActionSectionProps` 上的 `variant` 字段一并删除，避免留下一个不影响渲染的死属性。

**标题区继续按 variant 裁剪，本次不动**：草稿态仍不渲染 `WorkspaceHeaderTitleSection`（工作区路径图标、「…」更多菜单、`workspaceActionLoading` 提示），其依据是草稿尚无稳定 task 作用域、上下文入口会与空态主文案抢焦点。也就是说，草稿态与 task 态的差异是「标题区有无」，而不是「动作区有无」。

### 二、状态所有者与数据来源不变

- variant 的唯一所有者仍是 `WorkspaceShellLayout` 依据 `activeTaskId` 派生；本次不新增任何状态，不改 draft/task 的判定。
- 编辑器按钮组的输入沿用既有 props：`workspaceAbsPath`（必填）、`workspaceIdentity` / `remoteTarget`（可选）、`disabledReason`（取自 `workspaceReadOnlyReason`）。
- 可用编辑器列表与选中项仍由 `resolveWorkspaceEditorSelection` 决定（含 ssh/wsl/docker 的能力过滤与 office mode 的「仅文件管理器」过滤），不新增分支。
- 选择结果仍通过 `persistLastSelectedEditorId` 持久化，草稿态与 task 态共用同一份偏好。

### 三、点击语义

草稿态点击与 task 态点击完全一致：调用 `platform.openInEditor(editorId, workspaceAbsPath, { workspaceIdentity, remoteTarget })`。

**副作用边界**：打开工作区**不得**创建 task/session。点击后 `activeTaskId` 仍为 `null`，header 仍是 draft 变体，会话列表不新增条目。

### 四、失败语义：无可用编辑器时整体隐藏

`WorkspaceEditorButtonGroup` 在 `selectedEditor` 为空时 `return null`，草稿态与 task 态行为一致，不渲染禁用占位、不留空白。触发条件沿用既有实现：

- 平台不提供编辑器列表（Web 端 `getInstalledEditors` 固定返回空）；
- 远程工作区被能力过滤后无可用编辑器（SSH/Docker，见 `workspaceEditorSelection`）。

### 五、只读工作区

只读 workspace 的草稿态同样渲染入口，但保持 `disabledReason` 语义：按钮 `disabled`，`title` 展示只读原因，点击不产生动作。

## 验收场景

1. 桌面端新建会话（未发送任何消息）：右上角出现编辑器/资源管理器图标与下拉箭头，点击后用所选软件打开当前工作区路径。
2. 草稿态点击入口后：`activeTaskId` 仍为 `null`，header 仍为 `data-workspace-header-variant="draft"`，会话列表条数不变。
3. 已有会话：入口位置、行为、下拉列表与改动前一致（回归）。
4. 在草稿态下拉里切换编辑器后，进入该会话的 task 态仍使用同一选择（持久化偏好未被草稿覆盖）。
5. 远程（SSH/Docker）草稿态：按既有能力过滤结果渲染或整体隐藏，不出现指向本地路径的错误编辑器。
6. 只读 workspace 的草稿态：入口可见但 disabled，tooltip 为只读原因。
7. Web / 手机远控：草稿态不渲染工作区 header（`activeTaskId === null && !isDesktop`），行为不变。

## 非目标

- 不恢复草稿态的标题区内容（路径图标、「…」菜单）。
- 不新增第二个「打开工作区」入口，不新增组件或并行 helper。
- 不改动编辑器探测（`packages/desktop/src/main/editors.ts`）与 Web 端空实现。

## 验证

仓库当前检出的 `packages/ui` 没有该组件的单测，也没有 E2E 用例目录；本次以类型检查、Lint、格式检查与架构检查为自动化门禁，人工场景按上方第 1～3 条在 `pnpm dev:desktop` 下核对。
