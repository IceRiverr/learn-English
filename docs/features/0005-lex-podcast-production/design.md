# Feature 0005：Lex Fridman 播客课程制作流程

状态：历史设计（已由本地 MP3 课程方案取代，不再运行远程页面制作流程）

## 1. 背景与结论

本功能为 Lex Fridman Podcast 建立一套可重复、可校验的课程制作流程。目标不是只手工制作某一期，而是让后续节目可以按同一套步骤完成来源检查、字幕处理、双语翻译、课程校验和上线。

第一个样板课程选择：

- Lex Fridman Podcast #475 — Demis Hassabis 2
- [节目页面](https://lexfridman.com/demis-hassabis-2/)
- [官方字幕](https://lexfridman.com/demis-hassabis-2-transcript/)
- [官方 MP3](https://media.blubrry.com/takeituneasy/content.blubrry.com/takeituneasy/lex_ai_demis_hassabis_2.mp3)
- 发布时间：2025-07-23
- 时长：2:34:56（9296 秒）
- MP3 大小约 106.4 MiB

技术上可以制作：官方页面提供可播放、可下载的 MP3 和带时间戳的英文字幕；MP3 支持 HTTP Range，并允许浏览器跨域读取，因此既能在线播放，也能由现有“下载”按钮保存到浏览器本地，无需把音频提交到仓库。

但“官方可下载”不等同于“允许重新发布全文和翻译”。公开上线完整英文字幕及中文译文前，需要确认使用许可或由维护者明确接受相应风险。制作流程可以先生成本地草稿，但发布步骤必须经过版权状态检查。

## 2. 目标

1. 通过节目 URL 制作一份符合当前课程格式的双语 JSON。
2. 音频始终使用官方远程 URL 在线播放，用户主动点击时才下载到 OPFS。
3. 保留官方英文文本、说话人和时间信息，并将长段落拆成适合逐句学习与循环播放的片段。
4. 复用 Feature 0004 的十分钟分块翻译、术语表、合并和校验流程。
5. 对来源变化、时间轴、漏译、错序和远程音频可用性进行自动校验。
6. 让后续 Lex 节目只需提供来源信息，便可重复执行同一流程。

## 3. 非目标

- 不开发通用播客抓取平台。
- 不新增后端、数据库、路由或运行时状态管理层。
- 不自动部署未经审核的内容。
- 不把 Lex MP3 下载到 `public/`、提交到 Git 或加入 Service Worker 预缓存。
- 不保证任意第三方页面都能使用本流程；本功能只针对 Lex 官方页面与 RSS 的已知结构。
- 首版不提供翻译百分比、断点续传或后台制作 UI；制作流程运行在开发脚本中。

## 4. 样板来源审计

对第 475 期的预研结果如下：

| 项目 | 结果 |
| --- | --- |
| 节目 | Lex Fridman Podcast #475 — Demis Hassabis 2 |
| 音频 | 官方 Blubrry MP3，111,552,619 bytes |
| 在线播放 | 支持 |
| HTTP Range | 支持，范围请求返回 `206` |
| 浏览器下载 | 支持，响应包含跨域许可 |
| 官方字幕 | 371 个带时间戳的段落 |
| 说话人 | Lex Fridman、Demis Hassabis |
| 英文词数 | 约 25,205 |
| 首个时间戳 | 00:00:00 |
| 最后字幕时间戳 | 02:27:13 |
| 音频总时长 | 02:34:56 |

官方字幕段落平均约 68 个英文单词，最长约 315 个单词。直接将官方段落作为播放器的“当前句”会导致循环片段过长，因此必须增加学习片段切分和更细粒度的时间对齐。

## 5. 发布与版权门禁

每门 Lex 课程必须记录版权审核状态：

```ts
type RightsStatus = 'unverified' | 'approved' | 'private-only'
```

- `unverified`：可以在本地生成、翻译、审核，不进入公开课程目录。
- `approved`：已取得许可或确认可以公开使用，允许加入公开课程目录并部署。
- `private-only`：仅供维护者个人学习，不进入公开部署。

课程必须保留节目名称、期号、原始节目链接、字幕链接和音频链接。若无法确认完整字幕及其翻译的再发布权，默认保持 `unverified`。可通过 [Lex Fridman 联系页面](https://lexfridman.com/contact/)进一步确认。

## 6. 数据设计

在兼容当前 `Course`、`Segment` 格式的前提下，为 Lex 课程增加可选来源和说话人元数据：

```json
{
  "id": "lex-475-demis-hassabis-2",
  "title": "Lex Fridman Podcast #475: Demis Hassabis 2",
  "audioFilename": "lex_ai_demis_hassabis_2.mp3",
  "duration": 9296,
  "language": "en",
  "source": {
    "publisher": "Lex Fridman Podcast",
    "episodeNumber": 475,
    "episodeUrl": "https://lexfridman.com/demis-hassabis-2/",
    "transcriptUrl": "https://lexfridman.com/demis-hassabis-2-transcript/",
    "audioUrl": "https://media.blubrry.com/takeituneasy/content.blubrry.com/takeituneasy/lex_ai_demis_hassabis_2.mp3",
    "publishedAt": "2025-07-23",
    "rightsStatus": "unverified"
  },
  "segments": [
    {
      "id": "s0001",
      "speaker": "Lex Fridman",
      "start": 0,
      "end": 12.4,
      "text": "English source text.",
      "translations": {
        "zh-Hans": "中文翻译。"
      },
      "timingQuality": "aligned"
    }
  ]
}
```

新增字段均为可选字段，现有课程不需要迁移：

- `source`：来源、署名和版权审核信息。
- `speaker`：当前学习片段的说话人。
- `timingQuality`：`official`、`aligned` 或 `estimated`，用于说明时间精度。

中文仍使用 Feature 0004 确定的 `translations['zh-Hans']`，不新增 `text_cn` 等平行字段。

## 7. 制作流程

### 7.1 建立来源清单

每期制作开始时记录：

- 期号、标题、发布日期和节目页面；
- 官方字幕页面；
- RSS 中的 MP3 enclosure、文件大小和时长；
- YouTube 视频 ID（如存在）；
- `rightsStatus`。

来源清单是制作输入，不能从非官方转载站点拼接音频或字幕。

### 7.2 来源预检

脚本在产生内容前必须检查：

1. 节目页面、字幕页面和音频均可访问。
2. RSS 期号、标题和 enclosure 与节目页面一致。
3. MP3 `Content-Type` 正确，支持在线播放。
4. MP3 支持 Range；跨域响应允许浏览器主动下载。
5. 字幕选择器能够提取内容，段落数量不为零。
6. 时间戳单调递增，首尾时间在音频时长范围内。

如果网页结构变化、字幕为空或音频链接不一致，脚本应中止并明确报错，不能静默生成残缺课程。

### 7.3 抽取官方字幕

当前 Lex 字幕页的主要结构为：

- `.ts-segment`：字幕段落；
- `.ts-name`：说话人；
- `.ts-timestamp a`：时间戳及秒数参数；
- `.ts-text`：英文正文。

抽取规则：

1. 以官方字幕正文作为英文规范来源。
2. 解码 HTML 实体并规范多余空白，不擅自润色英文。
3. `.ts-name` 为空时继承上一个非空说话人。
4. 保留原始段落 ID、原始时间戳和来源指纹，便于追踪网站更新。
5. 计算字幕页面或规范化英文内容的 SHA-256；后续翻译合并前必须校验指纹。

实现时优先使用结构化 HTML 解析器和选择器。若不增加依赖，则解析器必须只针对上述结构，并用保存的最小 HTML fixture 做回归测试，避免使用无法发现结构变化的宽泛正则。

### 7.4 切分学习片段

官方段落是内容边界，不一定是良好的学习边界。课程片段应满足：

- 通常为 1–3 句；
- 目标时长 8–25 秒；
- 原则上不超过 45 秒；
- 不跨越说话人或官方段落；
- 不破坏缩写、小数、专有名词中的句点；
- 每个片段使用稳定 ID，重新执行脚本时结果可复现。

英文切句后保留与原始段落的映射，便于人工审核和重新对齐。

### 7.5 时间对齐

首选方案：

1. 官方字幕提供规范英文文本和段落起点。
2. 若官方 YouTube 字幕可获取，则只将其用作词级或短句级时间参考。
3. 通过规范化文本和序列对齐，将官方英文句子映射到字幕时间轴。
4. 成功匹配的片段标记为 `timingQuality: 'aligned'`。

降级方案：

- 在相邻官方时间戳之间，按词数和标点比例估算句子起止时间；
- 保证片段不重叠、时间递增且不超出所属官方段落；
- 标记为 `timingQuality: 'estimated'`；
- 在人工审核报告中列出所有 estimated 片段。

不能用音频总时长作为最后一句的结束时间。第 475 期最后一条字幕之后还有节目尾部内容，最后片段应使用字幕、语音或合理上限确定。

### 7.6 中文翻译

复用 `scripts/translation-workflow.mjs`：

1. 先对完整节目生成主题摘要、人物表和全局术语表。
2. 按时间轴每 10 分钟生成一个翻译分块。
3. 每块附带前后若干片段作为上下文，但只允许修改当前块的目标 ID。
4. 翻译写入 `translations['zh-Hans']`。
5. 合并时验证来源 SHA-256、ID 完整性、重复 ID、空译文和越界修改。
6. 对人名、机构名、AI/神经科学/数学术语做全局一致性检查。

第 475 期预计分成 15 个十分钟块。长节目可以并行翻译不同块，但最终合并和全局一致性审核必须串行完成。

### 7.7 内容审核

至少完成以下人工抽查：

- 开头、结尾和每个十分钟边界；
- 说话人切换处；
- 所有 `estimated` 时间片段；
- 超过 30 秒的片段；
- 专有名词密集或翻译不确定的片段；
- 英文与中文语义是否对应；
- 循环本句时是否完整覆盖该句且不会明显截断下一句。

### 7.8 加入课程目录

只有 `rightsStatus: 'approved'` 的课程才能加入公开目录。目录项包含：

- 课程 ID 与标题；
- 生成后的 JSON URL；
- 官方远程 MP3 URL；
- `audioFilename`；
- 时长和约 106 MB 的下载大小提示；
- 来源署名和官方节目链接。

在线播放直接使用远程 URL，不提前下载完整音频。用户点击“下载”后，沿用现有 OPFS 按课程 ID 保存的逻辑。删除时只删除该课程的本地音频、课程和进度数据。

## 8. 建议的开发脚本

首版保持脚本数量最少：

```text
scripts/lex-podcast.mjs
  probe       检查节目、RSS、字幕和音频
  extract     抽取并规范化官方字幕
  segment     切句并生成学习片段
  align       对齐时间轴并输出质量报告
  build       生成未翻译课程 JSON
  validate    校验最终双语课程

scripts/translation-workflow.mjs
  prepare / status / merge / validate
```

中间文件放在本地忽略目录 `.lex-work/<course-id>/`，只将最终获准发布的 JSON 提交到 `public/samples/`。MP3 继续由 `.gitignore` 忽略。

预期命令形态：

```powershell
node scripts/lex-podcast.mjs probe --episode 475
node scripts/lex-podcast.mjs build --episode 475
node scripts/translation-workflow.mjs prepare --course .lex-work/lex-475/course.json
node scripts/translation-workflow.mjs status --workdir .lex-work/lex-475/translations
node scripts/translation-workflow.mjs merge --workdir .lex-work/lex-475/translations
node scripts/lex-podcast.mjs validate --course public/samples/lex-475-demis-hassabis-2.json
```

实际参数以实现时沿用现有翻译脚本接口为准，不为命令外观重复实现一套工作流。

## 9. 自动校验

### 来源校验

- 官方页面与字幕页面可访问；
- RSS 元数据匹配；
- MP3 可播放、支持 Range，并具备下载所需的 CORS；
- 字幕结构、段落数和首尾时间合理；
- 来源指纹与翻译时使用的版本一致。

### JSON 校验

- 课程 ID 和片段 ID 唯一且稳定；
- `0 <= start < end <= duration`；
- 片段按时间排序且无不合理重叠；
- 每个片段有英文、说话人和 `zh-Hans`；
- 没有空翻译、遗漏翻译或未知 ID；
- `timingQuality` 值合法；
- 来源和版权状态字段完整。

### 应用验证

- 课程在列表中显示正确；
- 点击后可以立即在线播放，不触发完整 MP3 下载；
- 下载、刷新后恢复“已下载”、离线播放和删除单课正常；
- 每课进度独立保存；
- 中文开关、当前句循环、息屏后的 Media Session 循环均正常；
- 移动端长标题、说话人和双语字幕不溢出；
- 现有测试、TypeScript 检查和构建通过。

## 10. 失败处理与可恢复性

- 来源检查失败：不生成或覆盖最终课程文件。
- 字幕页面结构变化：保存诊断信息，要求更新解析器和 fixture。
- YouTube 时间信息不可用：允许生成 estimated 草稿，但禁止未经抽查直接上线。
- 某个翻译块失败：只重做该十分钟块，不重跑已完成分块。
- 合并校验失败：保留工作目录和报告，不覆盖最终 JSON。
- 远程 MP3 下载失败：在线课程仍可重试；界面提示下载失败，不写入“已下载”状态。
- 官方来源后来更新：通过来源指纹发现变化，重新抽取并人工比较，不静默覆盖译文。

## 11. 实施阶段

### 阶段 A：样板制作工具

- 实现来源探测、字幕抽取、切句、对齐和校验。
- 为 HTML 抽取、说话人继承、切句和时间单调性增加测试。
- 用第 475 期生成本地未翻译草稿和质量报告。

### 阶段 B：双语内容

- 建立全局术语表。
- 完成 15 个十分钟翻译块。
- 合并、自动校验和人工抽查。

### 阶段 C：应用接入

- 扩展可选来源、说话人和时间质量字段。
- 将获准发布的课程加入固定目录。
- 显示来源署名、说话人和下载大小提示。
- 完成在线、下载、离线、进度和循环播放验证。

### 阶段 D：发布

- 确认 `rightsStatus` 为 `approved`。
- 确认 Git 中没有 MP3 和 `.lex-work` 中间文件。
- 运行完整测试和构建。
- 提交、推送和部署。

## 12. 验收标准

1. 输入 Lex 官方期号或页面后，可以稳定生成课程草稿和来源审计报告。
2. 英文内容可追溯到官方字幕，来源变化能够被指纹检测。
3. 片段适合逐句学习，时间递增，并明确区分 aligned 与 estimated。
4. 每个片段具有一致的说话人、英文和 `zh-Hans` 中文译文。
5. 第 475 期能够在线播放官方 MP3，主动下载后能够离线播放。
6. MP3 不进入 Git、`public/` 或 Service Worker 预缓存。
7. 翻译分块可独立重做，合并时不会漏译、重复或修改错误片段。
8. 未确认版权状态时不会被意外加入公开课程目录或部署。
9. 现有课程、导入、进度、删除、双语开关和循环播放功能不回归。

## 13. 设计取舍

- 选择官方英文字幕作为规范文本，避免把自动字幕错误当成课程正文。
- 选择 YouTube 字幕作为可选时间参考，而不是内容来源，以兼顾文本准确度和逐句时间精度。
- 允许 estimated 降级，但必须显式标记和抽查，避免制造“精确对齐”的假象。
- 音频使用官方远程链接，降低仓库和部署体积，也避免重复托管 106 MB 文件。
- 制作工具保持为少量脚本，不引入后端或新的运行时架构。
- 将版权审核设计成发布门禁，因为技术可行性不能替代内容使用授权。
