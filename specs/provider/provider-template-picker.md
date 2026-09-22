# 添加供应商模板选择页

## 背景

设置 → 模型供应商 的「添加供应商」入口打开 `ProviderTemplatePicker`（`packages/ui/src/settings/model-provider-section/ProviderTemplatePicker.tsx`），列出内置模板卡片，点一张卡即按该模板创建供应商，另有一张「创建自定义供应商」卡片走空模板。

这个页面此前在渲染端把模板硬编码成两类：

- `zhipuIds = ["bigmodel-api", "zai-api", "bigmodel-standard-api", "zai-standard-api"]` 归入「智谱」组；
- 其余模板，加上「创建自定义供应商」卡片，归入「其他」组。

两组各渲染一个 `<h3>` 标题，并带 `data-provider-template-group` 属性。分组是**纯渲染端逻辑**，与配置数据无关：模板本身没有分类字段，`ProviderSettingsTemplateView` 也不下发分类。

内置配置 `config/provider/zcode-builtin.json` 的 `providerConfigRules.templateRules` 当前有 20 个模板，声明顺序为
`zai-api`、`zai-standard-api`、`bigmodel-api`、`bigmodel-standard-api`、`moonshot-kimi`、`minimax`、`deepseek`、
`qwen-alibaba-model-studio-cn`、`qwen-alibaba-model-studio-intl`、`xiaomi-mimo`、`openai`、`anthropic`、`xai`、
`openrouter`、`opencode-go-chat`、`opencode-go-messages`、`opencode-go-responses`、`opencode-zen-responses`、
`opencode-zen-messages`、`opencode-zen-chat`。

本 spec 定义去掉该分类后的行为。这一页只负责「选模板 + 发起创建」，不承载供应商状态，改动的边界仅限渲染结构。

## 规则

### 1. 模板选择页是单一列表，没有分类标题

- 渲染端不再对模板做任何分组：不维护 `templateId` 白名单，不按供应商或厂商归类，不渲染分类标题。
- 页面只有一个网格，按 `providerTemplates` 的**入参顺序**平铺所有模板。「创建自定义供应商」卡片是同一网格里的一张卡，不是独立分组。
- 「创建自定义供应商」卡片排在所有模板卡**之前**：它不依赖任何模板，放在首屏可避免被 20 张模板卡推到滚动区底部。这是本页唯一的固定位置约定，其余顺序完全由入参决定。
- 移除 `data-provider-template-group` 属性；页面标题（`settings.modelProvider.templatePickerTitle`）与返回按钮保持不变。

### 2. 顺序由配置数据决定，渲染端不重排

模板顺序的唯一所有者是内置配置的 `templateRules` 声明顺序，经由 `ProviderTemplateMap.entries()`（`Map` 保序）与 `providerTemplates` 视图透传到渲染端。

- 渲染端不得对 `templates` 做 `sort`、白名单抽取或重排。
- 以后新增内置模板、调整模板顺序，只改 `config/provider/zcode-builtin.json`，渲染端零改动。
- 新增模板会自动出现在列表里，不需要在 UI 里登记 id——这正是要移除白名单的原因。

### 3. 卡片标签与图标不变

- 标签继续用 `resolveProviderTemplateName(template.templateId, template, locale)`：`templateNameMap` 按当前语言取值，缺失回落到 `en-US`，再回落到 `templateId`。
- 图标继续用模板 `config.logo` 经 `ProviderLogo` 渲染，自定义卡片继续用 `PlusIcon`。
- 移除 `settings.modelProvider.templateGroup.zhipu` / `settings.modelProvider.templateGroup.other` 两个 i18n key（中英各一处），不留下无人引用的死键。

## 唯一所有者

| 状态                | 所有者                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| 模板集合与模板顺序  | 内置配置 `config/provider/zcode-builtin.json` 的 `providerConfigRules.templateRules`                      |
| 模板视图投影        | `ProviderConfigResolver` → `ProviderSettingsView.providerTemplates`（`packages/provider/src/facades.ts`） |
| 选择页渲染结构      | `ProviderTemplatePicker`（`packages/ui/src/settings/model-provider-section/ProviderTemplatePicker.tsx`）  |
| 已创建供应商与排序  | 个人 provider 配置文件（见 `specs/provider/account-free-providers.md`）                                   |
| 创建中的 loading 态 | `ModelProviderSection` 的 `creatingProvider`（本页只读取，不自行维护状态）                                |

模板选择页不持有任何供应商状态：它只把 `templateId`（或自定义名称）交给 `onCreateFromTemplate` / `onCreateCustom`。

## 失败语义

| 情况                       | 表现                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 模板创建失败               | 与本次改动前一致：停留在选择页，用详情栏底部横幅给出失败摘要与重试入口，完整 Schema issues 只进 UI 日志（`logger.error`） |
| `providerTemplates` 为空   | 页面只剩「创建自定义供应商」卡片；不报错、不显示空状态文案                                                                |
| 模板缺少 `templateNameMap` | 标签回落为 `templateId`，不显示空白卡片                                                                                   |
| 创建中（`creating`）       | 所有卡片 disabled，避免重复点击                                                                                           |

## 迁移边界

- 这是纯 UI 结构改动：不涉及协议（`packages/shared/src/zcode-protocol`）、不涉及 provider 解析与配置文件格式、不涉及内置配置内容与 revision。
- 已按模板创建的供应商与其 `templateId` 绑定不受影响，模板仍按 `templateId` 查找。
- 无历史数据迁移：分组从未落盘，删除它不产生兼容问题。

## 验收场景

1. 打开设置 → 模型供应商 → 添加供应商：页面无「智谱」「其他」标题，所有模板卡片在同一网格内平铺。
2. 卡片顺序 = 内置配置 `templateRules` 声明顺序，即首张模板是 `Z.ai Coding Plan`（`zai-api`），`Z.ai API`、`BigModel Coding Plan`、`BigModel API` 紧随其后，然后是 `Kimi`、`MiniMax`…；四个原「智谱」模板不再聚在独立分组里，但相对顺序不变。
3. 「创建自定义供应商」卡片位于网格首位，且在所有模板卡之前。
4. 中英文切换：模板标签随语言变化，页面不再出现分组标题；`pnpm typecheck` 与 `pnpm lint` 通过（移除 i18n key 不得留下悬空引用）。
5. 点击任一模板卡片仍按该模板创建供应商并进入详情；创建失败仍停留在本页并显示可重试横幅。
