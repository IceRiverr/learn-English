# Feature 0004：中英双语字幕与中文显示开关

状态：实现中（播放器功能和 No Brainer 译文已完成，长课程译文待处理）

## 1. 结论

建议实现，优先级较高。

这个功能直接服务于“听懂英语”这一核心目标。尤其是第二课包含大量工程术语和长句，
只有英文字幕时，学习者经常需要离开播放器查词或翻译；逐句中文能让用户快速确认句意，
继续听下一句或循环当前句。

运行时代码改动较小，可以继续放在现有 `App.tsx`、`db.ts` 和 `app.css` 中。
主要工作量不是播放器代码，而是为两门课程准备准确、自然、逐句对应的中文译文。

不建议在浏览器里调用在线翻译接口。课程译文应提前写入字幕 JSON，这样已下载课程可以
离线显示中文，也不会增加账号、密钥、费用、隐私和网络失败问题。

## 2. 用户体验

播放器默认显示双语字幕：

```text
00:34  Loop Engineering. From the Ralph Wiggum technique...
       循环工程：从 Ralph Wiggum 技巧到 Dex 团队每晚运行的慢循环……
```

在底部控制区增加一个开关：

```text
[中文 开]
```

- 点击后变为“中文 关”，所有中文译文隐藏。
- 再次点击恢复中文。
- 英文始终显示，不提供“关闭英文”的开关。
- 用户选择在不同课程之间共享，并在刷新后保留。
- 当前句聚焦卡片和完整字幕列表使用相同开关。
- 切换语言只改变显示，不影响播放、当前句、循环或播放进度。

不采用两个独立的“中文”和“英文”开关，因为两个开关可能同时关闭，增加无意义状态和
移动端控制区复杂度。当前产品是英语听力播放器，英文应始终作为主要内容。

## 3. 最小数据调整

课程层增加原文语言 `language`，每条字幕增加可选的 `translations` 映射：

```ts
interface Course {
  // 其他现有字段保持不变
  language?: string;
}

interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  translations?: Record<string, string>;
}
```

语言键使用 BCP 47 标签。固定课程的原文语言为 `en`，简体中文使用 `zh-Hans`；不使用
`cn`，因为 `CN` 是地区代码，不是语言代码。数据结构可以容纳其他语言，但本 Feature
只实现简体中文显示，不增加多语言选择器。

字幕 JSON 示例：

```json
{
  "version": 1,
  "course": {
    "id": "voa-no-brainer",
    "title": "VOA English in a Minute: No Brainer",
    "language": "en"
  },
  "segments": [
    {
      "id": "s001",
      "start": 3.4,
      "end": 7.4,
      "text": "Welcome to English in a Minute!",
      "translations": {
        "zh-Hans": "欢迎收看《一分钟英语》！"
      }
    }
  ]
}
```

`course.language` 和 `segment.translations` 在通用 Schema 中保持可选，原因是：

1. 已经保存在 IndexedDB 中的旧课程没有这个字段。
2. 用户手动导入的旧版字幕仍应继续工作。
3. 不是所有自定义课程都必须提供中文。

但项目内置的两门固定课程必须满足：

- `course.language` 为 `en`。
- 每个 segment 都有非空的 `translations["zh-Hans"]`。

可以在构建前或测试中检查固定 JSON，不能依赖页面运行后才发现缺失。

字幕 JSON 的 `version` 暂时保持 `1`。增加可选字段是向后兼容变化，没有必要仅为此升级
数据库或建立新的迁移系统。

## 4. 译文准备原则

两门课程共 342 条字幕，其中长课程有 329 条。可以使用 AI 生成初稿，但提交前应至少做
一次术语和上下文检查。

译文遵循：

- 表达完整句意，不逐词硬译。
- 保留人名、产品名和公司名，例如 Dex Horthy、OpenAI、Cursor、NVIDIA。
- 常见技术词根据上下文翻译，例如 agent、context engineering、spec、PR。
- 同一术语在同一课程中保持一致。
- 不在译文中补充原文没有的教学解释。
- 每条译文只对应同一个 segment，不合并或拆分时间轴。
- 标点使用自然中文标点。

如果某个 segment 本身是被时间轴截断的半句话，译文也应尽量与下一条衔接，不能为了
中文完整而改变字幕时间或 segment 数量。

### 4.1 翻译工作流

使用 `scripts/translation-workflow.mjs`，不要让模型直接改写完整课程 JSON。

先在本地工作目录准备术语表 `glossary.json`，然后生成每 10 分钟一个分片：

```powershell
node scripts/translation-workflow.mjs prepare `
  public/samples/context-engineering-with-dex-horthy.json `
  .translation-work/context-engineering `
  10
```

分片输入包含目标字幕、前后各三条上下文、术语表和允许输出的 ID。每次 Codex 调用只写
对应的 `*.zh-Hans.json`，格式为：

```json
{
  "language": "zh-Hans",
  "translations": {
    "s0001": "中文译文"
  }
}
```

全部分片完成后再合并和验证：

```powershell
node scripts/translation-workflow.mjs merge <课程JSON> <工作目录> zh-Hans en
node scripts/translation-workflow.mjs validate <课程JSON> <工作目录> zh-Hans en
```

`prepare` 会记录仅由课程元数据、英文、ID 和时间轴生成的 SHA-256 指纹。`merge` 和
`validate` 都会重新比较指纹，并拒绝缺少 ID、多余 ID、重复 ID、空译文或源数据变化。
`.translation-work/` 只作为本地可续跑工作目录，不进入 Git；最终只提交课程 JSON、脚本
和设计文档。

## 5. 显示规则

### 5.1 当前句

当前句聚焦卡片中：

```text
当前句 · 4/329

English sentence
中文译文
```

中文使用略小字号和较弱层级，但仍需满足移动端可读性。关闭中文后不保留空白占位。

### 5.2 完整字幕

每一行继续保留左侧时间，右侧改为两行内容：

```text
00:34  English sentence
       中文译文
```

中文关闭时，行高恢复到接近现有英文单行布局。点击英文或中文区域都应跳转到同一句。

### 5.3 没有译文的课程

用户手动导入的课程可能没有 `translations["zh-Hans"]`：

- 正常显示英文字幕。
- 控制区显示禁用状态“暂无中文”，而不是空白译文。
- 不显示错误，不阻止播放或导入。

只要至少有一条字幕存在 `translations["zh-Hans"]`，就可以使用中文开关；缺少译文的
个别行只显示英文。其他语言键不会因为中文开关而显示。

## 6. 开关状态

增加一个 React 状态：

```ts
const [showTranslation, setShowTranslation] = useState(true);
```

偏好是全局界面设置，不属于某门课程的播放进度。使用一个简单的 `localStorage` 键保存：

```text
show-translation
```

- 首次使用默认开启。
- 读取或写入 `localStorage` 失败时只使用当前 React 状态，不影响播放器。
- 不增加 IndexedDB key、设置页面或 Context。
- 按钮使用 `aria-pressed` 表达开关状态。

## 7. 已下载旧课程的兼容

这是本功能最容易遗漏的部分。

Feature 0003 会把课程信息和字幕一起保存到 IndexedDB。已经下载过课程的用户，本地音频
仍然可用，但其本地课程没有 `language`，字幕也没有 `translations["zh-Hans"]`。如果播放器
始终优先读取完整的本地课程对象，部署新版后这些用户仍看不到中文。

最小兼容方案：

1. 打开已下载课程时继续优先读取本地音频。
2. 如果本地字幕没有任何译文，在线时尝试请求该课程最新的服务器 JSON。
3. 请求成功后使用新字幕，并只更新 `course:<courseId>`，不重复写入 90 MB 音频。
4. 请求失败时继续使用旧英文字幕和本地音频，保证离线播放不退化。

`db.ts` 可以增加一个直接方法：

```ts
saveCourseMetadata(course)
```

它只覆盖 `course:<courseId>`，不修改 `audio:<courseId>` 或 OPFS 文件。不建立迁移框架、
repository 或课程版本管理系统。

更新后的字幕保存在本地，因此用户在线打开一次后，之后离线也能看到中文。

## 8. 最小实现范围

优先只修改：

```text
src/App.tsx
src/db.ts
src/app.css
public/samples/no-brainer.json
public/samples/context-engineering-with-dex-horthy.json
```

不新增：

- 翻译 API 或后端。
- React Router。
- 状态管理库。
- 独立国际化框架。
- 多语言通用配置系统。
- 字幕编辑器。
- 自动翻译按钮。
- 新的 IndexedDB object store 或数据库版本。

这个功能是课程内容的双语展示，不是完整的应用国际化。按钮、错误信息等现有中文界面
无需改造成可切换语言。

## 9. 风险与取舍

### 9.1 翻译质量

最大风险是译文看似通顺但误解专业语境。代码实现完成不代表内容完成。长课程需要抽查
人名、专有名词、否定句、代词指代和跨 segment 的半句话。

### 9.2 页面高度

显示中文后字幕列表高度接近翻倍。当前 329 条字幕仍可直接渲染，MVP 不需要虚拟列表。
如果真实手机出现明显卡顿，再单独评估窗口化。

### 9.3 学习依赖

中文默认显示能降低理解门槛，但也可能让用户只读中文。因此保留一个随时可见、一次点击
即可关闭的开关。后续若有明确需求，可以增加“进入课程时默认隐藏中文”，本 Feature 不做
更多学习模式。

### 9.4 离线更新

从未在线打开过新版课程的旧下载无法凭空获得新译文。它仍能正常离线播放英文；联网打开
一次后完成字幕更新。这是无需重新下载大音频的最小合理取舍。

## 10. 验证

自动检查重点：

- 固定课程的 `course.language` 为 `en`。
- 固定课程的每个 segment 都有非空 `translations["zh-Hans"]`。
- 增加译文后原有 segment ID、数量、开始时间和结束时间没有变化。
- 旧版无译文 JSON 仍能通过 Schema 校验。
- `translations` 不是对象或 `translations["zh-Hans"]` 不是字符串时给出字幕格式错误。

浏览器验证重点：

1. 两门固定课程的当前句和完整字幕都显示中文。
2. 关闭中文后所有译文消失，英文和时间轴保持正常。
3. 刷新和切换课程后恢复开关偏好。
4. 点击中文所在区域能跳转到对应句。
5. 已下载的旧课程在线打开后获得译文，但不重新下载音频。
6. 更新一次后断网打开，已下载课程仍显示中文。
7. 无译文的手动导入课程正常播放，并显示“暂无中文”。
8. iPhone 宽度下底部控制区不遮挡开关，字幕换行不横向溢出。

## 11. 验收标准

- 两门固定课程的每条字幕都有对应中文译文。
- 中文默认开启，可在播放器中一键关闭或恢复。
- 英文始终显示。
- 当前句卡片和完整字幕列表的显示状态一致。
- 中文显示偏好刷新后保留，并适用于所有课程。
- 切换中文不改变播放位置、速度、循环状态或当前句。
- 老的无译文课程和手动导入课程保持兼容。
- 已下载旧课程不需要重新下载音频即可更新字幕。
- 已更新的下载课程离线时仍有双语字幕。
- 不引入运行时翻译服务、后端、路由、状态管理库或国际化框架。
