# Feature 0015：Lesson 内容模型与听力库迁移

## 状态

实施中。v2 内容、Library、运行时、离线兼容与工具链已完成本地迁移和自动验证；旧发布文件保留，等待清理授权与真实 iPhone 验收。

## 1. 结论

本 Feature 将现有全部内置听力内容从版本 1 的单文件 `course + segments` 格式迁移到以 `Library → Collection → Lesson` 为核心的版本 2 内容模型，并同步调整内容生成器、运行时加载、离线存储兼容、听力库界面和部署脚本。

本期完成：

1. 把当前 278 个公开内置播放项全部迁移为 Lesson。
2. 把 Lesson、Transcript、Translation 和 AudioRendition 组织为单个 `<lesson-id>.json` 中职责明确的区块。
3. 把可提交 Git 的 JSON 和不提交 Git 的 MP3 分到独立目录。
4. 保持现有 Lesson ID、进度、最后播放记录和已下载旧内容可用。
5. 把听力库改为 Collection 驱动的两级浏览结构。
6. 让当前播放器通过统一适配层继续使用默认英文原声。
7. 为未来 OSS 基础地址和英文原声、简体中文配音保留扩展点。

本期不接入 OSS，不制作中文 AI 配音，不实现中英文交叉播放，不部署生产环境。

术语和长期约定见：

- [`docs/general/听力材料术语与音频内容约定.md`](../../general/听力材料术语与音频内容约定.md)

## 2. 背景

当前产品已经在代码目录中使用 `Lesson` 和 `lessonCollections`，但运行时内容仍是历史 `Course` 模型：

```json
{
  "version": 1,
  "course": {
    "id": "nce-3-001",
    "title": "Lesson 1: A Puma at Large",
    "audioFilename": "01－A Puma at large.mp3",
    "duration": 213.5,
    "language": "en"
  },
  "segments": [
    {
      "id": "segment-0001",
      "start": 0,
      "end": 4.2,
      "text": "Pumas are large, cat-like animals...",
      "translations": {
        "zh-Hans": "美洲狮是一种体形似猫的大型动物……"
      }
    }
  ]
}
```

该格式把以下职责合并在一个文件中：

- Lesson 元数据；
- 音频文件名；
- 英文 Transcript；
- 原声音频时间轴；
- 简体中文 Translation；
- 可选说话人。

这对单一英文 MP3 足够简单，但会阻碍：

- Podcast、歌曲、有声书等不同来源的统一表达；
- Collection、Course、Series 等内容组织；
- 音频和 JSON 独立部署；
- 同一 Lesson 的英文原声和中文 AI 配音；
- 简中译文和配音的 source digest 过期检测；
- 未来迁移 OSS 或 CDN；
- 自然的听力库界面。

本 Feature 只迁移已经公开内置的现有内容。Lenny’s Podcast 等授权状态未确认的本地制作项目不进入公开目录，后续确认权利后再按版本 2 格式导出。

## 3. 当前内容基线

以下数据由 2026-07-23 的工作区实际文件验证得到，不采用旧 Feature 文档中的历史数量。

### 3.1 文件数量

| 内容 | JSON | MP3 | Segment | `zh-Hans` |
| --- | ---: | ---: | ---: | ---: |
| 新概念英语第一册 | 72 | 72 | 1500 | 1500 |
| 新概念英语第二册 | 96 | 96 | 1430 | 1430 |
| 新概念英语第三册 | 60 | 60 | 1570 | 1570 |
| 新概念英语第四册 | 48 | 48 | 1088 | 1088 |
| Context engineering with Dex Horthy | 1 | 1 | 329 | 329 |
| Lex Fridman Podcast #475 | 1 | 1 | 867 | 867 |
| 合计 | 278 | 278 | 6784 | 6784 |

### 3.2 说话人数据

- Lex #475 的 867 个 Segment 都有现有 `speaker`。
- Context engineering 的 329 个 Segment 没有 `speaker`。
- 新概念现有数据不依赖说话人字段。

迁移不得凭空推断缺失的说话人。只迁移已有明确数据。

### 3.3 当前目录

```text
public/
├── 新概念/
│   ├── 新概念1-美音/
│   ├── 新概念2-美音/
│   ├── 新概念3-美音/
│   └── 新概念4-美音/
└── samples/
    ├── context-engineering-with-dex-horthy.json
    ├── context-engineering-with-dex-horthy.mp3
    ├── lex-475-demis-hassabis-2.json
    └── lex_ai_demis_hassabis_2.mp3
```

每个旧 JSON 和 MP3 基本同目录放置。MP3 已被 `.gitignore` 忽略，JSON 被 Git 跟踪。

### 3.4 当前运行时

- `src/App.tsx` 内定义版本 1 Zod Schema。
- `src/db.ts` 使用 `Course` 和 `Segment`。
- `src/lessons.ts` 由 `scripts/generate-new-concept-lessons.mjs` 生成。
- 目录项直接保存 `audioUrl` 和 `transcriptUrl`。
- 打开材料时先下载单个 JSON，再把它转换成 `Course`。
- 下载后把完整 Course 元数据存到 IndexedDB。
- 音频优先存入 OPFS，回退到 IndexedDB Blob。

### 3.5 当前存储键

```text
course:<id>
audio:<id>
progress:<id>
last-played
```

这些键已经存在于用户设备中。本 Feature 不批量改写键名。

## 4. 目标

### 4.1 内容模型

建立以下运行时领域结构：

```text
Library
└── Collection
    └── Lesson
        ├── Transcript
        │   └── TranscriptSegment
        ├── Translation
        └── AudioRendition
            └── AudioSource
```

### 4.2 内容目录

建立可提交数据和大型媒体分离的目录：

```text
content/
├── collections/
└── lessons/
    └── <content-group>/

audio/
└── lessons/
    └── <content-group>/

content-work/
├── <lesson-id>/
│   ├── sources/
│   ├── interim/
│   ├── translation/
│   ├── migration/
│   ├── reports/
│   ├── exports/
│   └── tmp/
└── _shared/
    └── 跨 Lesson 的迁移和报告
```

### 4.3 兼容

- 278 个现有 Lesson ID 全部保持不变。
- `progress:<id>` 不迁移即可继续使用。
- `last-played` 中的旧 ID 继续匹配新 Library。
- 已下载版本 1 Course 和音频继续离线播放。
- 删除下载仍保留内置 Lesson 的进度和最后播放信息。
- 没有翻译的未来 Lesson 仍可播放。

### 4.4 界面

- 首页展示 Collection，而不是一次展开 278 个 Lesson。
- 打开 Collection 后展示其 Lessons。
- 返回听力库不会卸载当前音频会话。
- Collection 根据 `kind` 显示课程、Podcast、有声书、合集等自然名称。
- Lesson 行展示来源类型、时长、大小和可用语言。

### 4.5 可验证迁移

迁移脚本必须生成前后对照报告，证明：

- Lesson ID 集合相同；
- Segment ID、英文、时间轴和译文相同；
- 标题、时长和语言相同；
- MP3 SHA-256 相同；
- Segment 数量和译文数量相同；
- 已有说话人信息没有丢失。

## 5. 非目标

本 Feature 不实现：

- OSS、CDN 或第三方对象存储；
- 生产部署；
- 中文 AI 配音生成；
- AudioRendition 切换界面；
- “英文三遍、中文一遍”；
- 多音频下载管理；
- 用户自定义 MP3 或字幕导入；
- 恢复历史 ZIP 导入；
- 账号、同步或云端后台；
- 路由库或全局状态管理；
- 逐词真实时间轴；
- 自动补齐缺失说话人；
- 对现有公开内容重新作版权结论。

目标 Schema 只接受 `en` 和 `zh-Hans`，并为这两个音频版本留出结构；本期每个 Lesson 只生成并播放一个 `en` Rendition。

## 6. 关键设计决策

### 6.1 Lesson ID 不变

所有现有 `course.id` 原样成为 `lesson.id`。

例如：

```text
nce1-001-002-excuse-me
context-engineering-with-dex-horthy
lex-475-demis-hassabis-2
```

不得为了目录更整齐而改变现有 ID。Collection ID 可以重新设计，因为它不参与当前学习进度键。

### 6.2 原始音频只是默认 Rendition

每个现有 MP3 迁移为：

```text
AudioRendition ID：en
role：original
language：en
```

播放器通过 `defaultRenditionId` 加载它。英文原声的物理文件后缀固定为 `-en.mp3`；简中 AI 配音固定为 `-zh-ai.mp3`。文件名中的 `zh` 是产品约定的简体中文缩写，JSON 语言字段仍使用标准 `zh-Hans`。

### 6.3 时间轴属于 Rendition

版本 2 把：

```text
Segment 的语义内容
与
某条音频中的开始、结束时间
```

分开保存。

英文原文存入 LessonDocument 的 `segments`，`start` 和 `end` 存入同一文件的 `renditions[].cues`。

这让未来中文配音可以保留相同 Segment ID，但拥有不同时间轴。

### 6.4 Translation 不重复原文和时间轴

每个 Segment 的中文字段只保存：

```text
segmentId → text
```

避免英文校对后出现两份时间轴或两份英文。

### 6.5 运行时继续使用扁平 Segment

每个 Lesson 发布单个 `<lesson-id>.json`，其中的逻辑区块仍保持职责分离。播放器把它组装为当前容易使用的结构：

```ts
interface RuntimeSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  translations?: { "zh-Hans"?: string };
  speaker?: string;
}
```

这样本 Feature 不重写逐句循环、二分查找、字幕渲染和估算逐词进度。

结构化发生在内容边界，播放器继续消费经过适配的 RuntimeLesson。

### 6.6 保留现有 IndexedDB 键

继续使用：

```text
course:<id>
audio:<id>
progress:<id>
```

`course:` 是兼容性技术键，不再代表产品术语。改键会带来不必要的 IndexedDB 和 OPFS 迁移风险。

代码类型和函数可以逐步改为 Lesson，但存储键本 Feature 保持。

### 6.7 Catalog 与 Collection 索引

客户端目录分为两级：

```text
content/catalog.json
content/collections/<collection-id>.json
```

`catalog.json` 只包含首页所需的 Collection 入口、数量和 `documentKey`。每个 Collection JSON 保存自身
的有序 Lesson 摘要，包括标题、时长、字节数、可用语言和完整 Lesson 的 `documentKey`。

Service Worker 预缓存 Catalog 和全部 Collection JSON，因此离线时仍能浏览完整目录。完整 Lesson 数据仍由
`content/lessons/<content-group>/<lesson-id>.json` 提供，音频和完整 Lesson 均按需加载或由用户主动下载。

`<content-group>` 只是文件维护和规范存放位置，不表达唯一的 Collection 归属。同一个 Lesson 仍可出现在多个
Collection 的 `lessons` 摘要列表中，物理文件只保存一份，运行时和离线存储仍以 Lesson ID 为身份。

### 6.8 OSS 只保留地址扩展点

本期默认：

```text
audioBaseUrl = /audio/
```

Rendition 保存对象 Key：

```text
lessons/<content-group>/<lesson-id>-en.mp3
```

统一通过一个 URL 解析函数得到：

```text
/audio/lessons/<content-group>/<lesson-id>-en.mp3
```

未来只需让 `audioBaseUrl` 可配置为 OSS 域名，不需要重写 278 个 Lesson JSON。
音频使用与 Lesson JSON 相同的 `<content-group>`，但该目录仍只表示规范存放位置，不改变 Collection 关系。

本期不配置 OSS 凭据，不修改服务器，不上传外部存储。

## 7. 目标目录

### 7.0 Catalog

```text
content/catalog.json
```

Catalog 只发现 Collection，不保存 278 个 Lesson 摘要。

### 7.1 Collection

```text
content/collections/
├── new-concept-english-book-1.json
├── new-concept-english-book-2.json
├── new-concept-english-book-3.json
├── new-concept-english-book-4.json
├── lex-fridman-podcast.json
└── pragmatic-engineer-podcast.json
```

现有迁移产生 6 个 Collection。

### 7.2 Lesson 数据

```text
content/lessons/
├── new-concept-english-1/
│   └── nce1-001-002-excuse-me.json
├── new-concept-english-2/
│   └── nce2-001-a-private-conversation.json
├── new-concept-english-3/
│   └── nce3-001-a-puma-at-large.json
├── new-concept-english-4/
│   └── nce4-001-finding-fossil-man.json
├── lex-fridman-podcast/
│   └── lex-475-demis-hassabis-2.json
└── pragmatic-engineer-podcast/
    └── context-engineering-with-dex-horthy.json
```

278 个 Lesson 共生成 278 个 `<lesson-id>.json`。英文、简中和原声时间轴是文档内的不同区块，不再生成四倍数量的发布 JSON。
目录分组不进入 Lesson ID，也不限制一个 Lesson 被多个 Collection 引用。

### 7.3 音频

```text
audio/lessons/
├── new-concept-english-1/
│   └── nce1-001-002-excuse-me-en.mp3
├── new-concept-english-2/
├── new-concept-english-3/
├── new-concept-english-4/
├── lex-fridman-podcast/
│   └── lex-475-demis-hassabis-2-en.mp3
└── pragmatic-engineer-podcast/
    └── context-engineering-with-dex-horthy-en.mp3
```

`audio/**/*.mp3` 被 Git 忽略；迁移期间旧 `public/**/*.mp3` 也继续忽略。

### 7.4 制作中间文件

制作中间文件不进入上述发布目录，继续使用被忽略的工作区：

```text
.translation-work/
private-courses/
```

本 Feature 不把 rights-unverified 的本地 Lenny 项目移动到 `content`；制作期材料按 Lesson 留在被忽略的
`content-work/<lesson-id>/`，跨 Lesson 的迁移和报告留在 `content-work/_shared/`。

## 8. 版本 2 JSON

### 8.1 `<collection-id>.json`

```json
{
  "schemaVersion": 1,
  "id": "new-concept-english-book-1",
  "kind": "course",
  "title": "新概念英语第一册",
  "subtitle": "First Things First",
  "lessons": [
    {
      "id": "nce1-001-002-excuse-me",
      "kind": "textbook",
      "title": "Lesson 1: Excuse me!",
      "duration": 37.2,
      "byteLength": 734003,
      "availableLanguages": ["en", "zh-Hans"],
      "documentKey": "lessons/new-concept-english-1/nce1-001-002-excuse-me.json"
    }
  ]
}
```

约束：

- Collection ID 唯一；
- `lessons[].id` 不重复；
- 每个 Lesson ID 必须存在；
- 摘要必须与权威 LessonDocument 一致；
- 顺序就是界面顺序；
- 同一 Lesson 允许出现在多个 Collection；
- 当前迁移至少要求每个 Lesson 出现在一个 Collection。

### 8.2 `<lesson-id>.json`

```json
{
  "schemaVersion": 2,
  "lesson": {
    "id": "nce1-001-002-excuse-me",
    "kind": "textbook",
    "title": "Lesson 1: Excuse me!",
    "sourceLanguage": "en",
    "translationLanguage": "zh-Hans",
    "transcriptRevision": 1,
    "defaultRenditionId": "en"
  },
  "source": {
    "type": "textbookLesson",
    "series": "New Concept English",
    "volume": "Book 1"
  },
  "rights": {
    "status": "unverified",
    "notes": "Migrated from legacy published content; migration does not establish redistribution rights."
  },
  "speakers": [],
  "segments": [
    {
      "id": "segment-0001",
      "text": "Excuse me!",
      "translation": {
        "text": "对不起！"
      }
    }
  ],
  "renditions": [
  {
      "id": "en",
      "language": "en",
      "role": "original",
      "audio": {
        "key": "lessons/nce1-001-002-excuse-me-en.mp3",
        "mimeType": "audio/mpeg",
        "byteLength": 1234567,
        "sha256": "..."
      },
      "duration": 102.4,
      "cues": [
        {
          "segmentId": "segment-0001",
          "start": 0,
          "end": 1.8
        }
      ]
    }
  ]
}
```

固定约束：

- `lesson.sourceLanguage` 必须是 `en`；
- `lesson.translationLanguage` 必须是 `zh-Hans`；
- Segment 的 `text` 是英文，`translation.text` 固定是简体中文；
- `translation` 可以缺失，英文仍可播放；
- Rendition language 只能是 `en` 或 `zh-Hans`；
- Rendition role 只能是 `original` 或 `dub`；
- 当前每个 Rendition 只引用一个 MP3，不设计 HLS、码率变体或其他语言。

迁移时使用旧 `course.revision ?? 1` 作为初始 `transcriptRevision`，不丢失 Lex 等现有 revision。现有中文文本保持原样，不在格式迁移中顺便重译或润色。

Lex 等已有说话人的 Segment 增加稳定 `speakerId`，并在 `speakers` 中定义。迁移脚本只能根据旧 `speaker` 文本建立确定性 ID，不推断 `role`；不能确定时省略 role。

`rights.status` 至少支持：

```ts
type RightsStatus =
  | "unverified"
  | "restricted"
  | "licensed"
  | "public-domain";
```

迁移不得因为内容当前已经在线而自动标记为 `licensed`。

## 9. Zod Schema

所有外部 JSON 必须在运行时和构建脚本中通过同一组 Zod Schema。

建议新增：

```text
src/content.ts
```

职责：

- 导出 Collection 和 LessonDocument Schema；
- 导出推导出的 TypeScript 类型；
- 提供文档内引用校验和 RuntimeLesson 组装函数；
- 提供版本 1 Course 到 RuntimeLesson 的兼容适配；
- 提供音频 Key 到 URL 的安全解析。

避免在 `App.tsx`、生成器和迁移脚本中维护三份稍有不同的 Schema。

Node 脚本无法直接稳定导入浏览器 TypeScript 时，可以把纯 Schema 放在一个环境无关的 `.mjs` 模块，再由 TypeScript 包装；实施时以不增加构建依赖和不产生循环引用为准。

### 9.1 Schema 校验

- `schemaVersion` 精确匹配；
- ID 和枚举合法；
- 语言只接受 `en` 和 `zh-Hans`；
- 文本非空；
- URL Key 不允许绝对磁盘路径；
- 音频 Key 不允许 `..`；
- SHA-256 为 64 位十六进制；
- `byteLength` 和 `duration` 为正数。

### 9.2 文档内引用校验

- `defaultRenditionId` 存在；
- Segment ID 唯一；
- Cue Segment ID 全部存在于 Transcript；
- 同一 Rendition 内 Cue 的 Segment ID 不重复；
- `end > start`；
- Cue 按时间排序；
- Cue 不超过 Rendition duration；
- `speakerId` 存在于同一文档的 `speakers`；
- Collection 引用的 Lesson 全部存在。

### 9.3 当前迁移的加强校验

通用 Schema 允许缺少翻译，但当前 278 个迁移对象必须满足：

- 每个 Segment 都有 `zh-Hans`；
- 每个 Lesson 都有 `en`；
- 每个 Lesson 都有一个有效 MP3 Source；
- 音频文件存在且 SHA 匹配；
- 英文和中文数量均为 6784。

## 10. 迁移脚本

新增：

```text
scripts/migrate-lessons-v2.mjs
```

### 10.1 模式

脚本至少支持：

```text
inventory
dry-run
migrate
verify
```

#### inventory

读取旧目录，输出：

- JSON 和 MP3 数量；
- Lesson ID；
- Segment 数量；
- Translation 数量；
- 音频路径、大小和 SHA；
- 重复或缺失项。

#### dry-run

在内存中构造全部 v2 数据并校验，不写正式目录。

输出计划：

```text
旧 JSON → 新 `<lesson-id>.json`
旧 MP3 → 新 Audio Key
旧分组 → 新 Collection
```

#### migrate

写入临时目标目录：

```text
.lesson-migration-staging-<random>/
```

完成全部校验后，再把明确的目标文件移动到：

```text
content/
audio/
```

不得边读取旧内容边覆盖旧文件。

#### verify

独立重新读取旧 v1 和新 v2，进行语义对照，不复用 migrate 阶段的内存结果。

### 10.2 幂等性

重复执行必须：

- 生成相同 JSON；
- 不产生重复 Collection；
- 不改变 Lesson ID；
- 不改变 Segment ID；
- 不重复复制相同音频；
- 发现目标内容不同则失败，不静默覆盖。

### 10.3 音频处理

音频迁移顺序：

1. 计算旧 MP3 SHA-256。
2. 复制或建立临时硬链接到 staging。
3. 验证目标大小和 SHA。
4. 写入 `<lesson-id>.json` 的 Rendition metadata。
5. 完成全部 Lesson 验证。
6. 再将 staging 内容放入 `audio`。

旧本地 MP3 不在首次迁移时递归删除。新应用和部署脚本切换到 `audio` 后，再单独确认是否清理旧的被忽略副本。

任何清理都必须使用显式、已解析且位于仓库旧 `public` 内容区或新 `audio` 下的路径，不能依赖宽泛通配符。

### 10.4 迁移报告

生成被 Git 跟踪的摘要或控制台报告：

```json
{
  "lessonCount": 278,
  "audioCount": 278,
  "segmentCount": 6784,
  "translationCount": 6784,
  "speakerSegmentCount": 867
}
```

详细绝对路径、下载来源和本地制作信息不得写入被跟踪文件。

## 11. Collection 映射

### 11.1 新概念

| 旧 collection | 新 Collection ID | kind |
| --- | --- | --- |
| `nce1` | `new-concept-english-book-1` | `course` |
| `nce2` | `new-concept-english-book-2` | `course` |
| `nce3` | `new-concept-english-book-3` | `course` |
| `nce4` | `new-concept-english-book-4` | `course` |

### 11.2 现有 Podcast

| Lesson | Collection ID | kind |
| --- | --- | --- |
| `lex-475-demis-hassabis-2` | `lex-fridman-podcast` | `podcast` |
| `context-engineering-with-dex-horthy` | `pragmatic-engineer-podcast` | `podcast` |

旧的“其他”分组不迁移为长期 Collection。两个 Podcast 使用真实来源 Series。

## 12. Catalog 生成器

用新的：

```text
scripts/generate-catalog.mjs
```

替换：

```text
scripts/generate-new-concept-lessons.mjs
```

### 12.1 输入

- `content/collections/*.json`
- `content/lessons/**/*.json`
- `<lesson-id>.json` 内的 Segment、Translation 和 Rendition

### 12.2 输出

```text
content/catalog.json
```

Catalog 只包含 Collection 的 `id`、`kind`、标题、Lesson 数量和 `documentKey`。Lesson 摘要保存在
对应的 Collection JSON，不生成 TypeScript 数据文件。

### 12.3 构建时检查

生成器必须在写 `content/catalog.json` 前完成 Collection 和 Lesson 内容校验。随后完整校验再次确认
Catalog 与 Collection 一致。验证失败时不修改已有生成文件。

建议新增 package scripts：

```json
{
  "scripts": {
    "validate:content": "node scripts/validate-content.mjs",
    "generate:catalog": "node scripts/generate-catalog.mjs"
  }
}
```

`pnpm build` 在 TypeScript 构建前生成并校验 Catalog，避免 Collection 已变化但目录仍旧。

普通 Git 环境可能没有 MP3，因此：

- `validate:content` 默认验证 JSON 和 rendition metadata；
- 本地制作验收使用 `validate:content --require-audio`；
- 音频部署必须使用 `--require-audio`。

## 13. 运行时加载

### 13.1 加载流程

打开 Lesson 时：

1. 启动时获取并 Zod 解析 `catalog.json` 和其中引用的 Collection JSON。
2. 使用 Collection 的 Lesson 摘要找到 `documentKey`。
3. 一次获取并 Zod 解析完整 `<lesson-id>.json`。
4. 校验默认 AudioRendition、Segment、Speaker 和 Cue 的文档内引用。
5. 读取默认 AudioSource。
6. 按 Segment ID 把 Cue 组装为 RuntimeSegment。
7. 生成 RuntimeLesson，并复用现有音频、进度和播放器建立流程。

### 13.2 可选简中译文

某个 Segment 的 Translation 缺失时：

- 英文必须仍可播放；
- 中文显示为不可用；
- 不把整个 Lesson 判定为损坏。

英文 Segment 或默认 Rendition 失败时，Lesson 无法播放并显示明确错误。单文件模型不再需要等待或协调三项并行 JSON 请求。

### 13.3 URL 解析

内容文件路径由 Collection Lesson 摘要的 `documentKey` 直接提供；音频使用文档内稳定对象 Key，不从 Lesson JSON
的目录层级推导。

音频 Source Key 统一经过：

```ts
resolveAudioSourceUrl(key)
```

默认基础地址：

```text
/audio/
```

不得在各组件中自行字符串拼接 OSS 或同源地址。

### 13.4 缓存失效

Rendition 已保存 SHA-256。在线音频 URL 可以使用 SHA 前缀作为查询参数：

```text
/audio/lessons/<id>-en.mp3?v=<sha-prefix>
```

替换音频但保留 Lesson ID 时，浏览器不会继续使用旧缓存。

## 14. IndexedDB 和旧下载兼容

### 14.1 RuntimeLesson

`Course` 代码类型逐步改名为 `RuntimeLesson` 或 `SavedLesson`，但播放器需要的字段保持接近当前结构。

### 14.2 旧记录识别

`loadLesson(id)` 读取 `course:<id>` 后：

- 有 v2 标记时按新结构解析；
- 没有 v2 标记、但符合旧 Course 结构时按 v1 解析；
- 两者都不合法时视为无有效下载。

所有持久化外部数据必须经过 Zod，不继续使用未经检查的类型断言。

### 14.3 新下载保存

新下载可以在 `course:<id>` 中保存已组装的 v2 SavedLesson：

```ts
interface SavedLesson {
  schemaVersion: 2;
  id: string;
  title: string;
  sourceLanguage: "en";
  translationLanguage: "zh-Hans";
  defaultRenditionId: string;
  duration: number;
  segments: RuntimeSegment[];
  audioLocation: "opfs" | "indexeddb";
}
```

本期只有一个默认 Rendition，因此继续使用：

```text
audio:<id>
OPFS audio/<sanitized-id>.mp3
```

中英双音轨的存储键留给后续 Feature，不在本期提前增加。

### 14.4 last-played

现有：

```ts
interface LastPlayed {
  courseId: string;
  updatedAt: number;
}
```

为了零风险兼容，本期可以继续保留字段名 `courseId`，只把变量和产品文案改为 Lesson。若改成 `lessonId`，读取器必须同时接受两种字段并在后续写入时自然升级。

推荐本期不改持久化字段，只改代码局部命名。

### 14.5 进度

`progress:<id>` 不变：

```ts
interface SavedProgress {
  currentTime: number;
  playbackRate: number;
}
```

由于 Lesson ID 和默认原声音频不变，旧进度可以直接定位。

## 15. 听力库界面迁移

### 15.1 页面状态

不增加路由库。扩展现有页面状态：

```ts
type AppView =
  | "library"
  | "collection"
  | "player";
```

另存：

```ts
selectedCollectionId?: string;
```

页面切换不能重建共享 `HTMLAudioElement`。

### 15.2 Library 首页

首页显示：

```text
英语精听
选择内容，开始逐句精听。

课程
[新概念第一册] [第二册] [第三册] [第四册]

Podcast
[Lex Fridman Podcast] [The Pragmatic Engineer]
```

迷你播放器继续固定在底部。

### 15.3 Collection 详情

```text
← 返回听力库

Lenny’s Podcast
Podcast

Lesson title
1:10:24 · 英文原声 · 中文译文
```

本期实际公开 Collection 只包含当前 6 个，Lenny 仅作为未来示例，不进入界面。

### 15.4 量词

根据 `Collection.kind`：

| kind | 量词 |
| --- | --- |
| `course` | 课 |
| `podcast` | 集 |
| `album` | 首 |
| `book` | 章 |
| `curated` | 项 |
| `series` | 项 |

不能继续把所有 Collection 统一显示为“篇”。

### 15.5 播放器

本期播放器仍只显示默认英文原声，不增加“音频版本”菜单。

保留：

- 单句/全文；
- 中英双语/仅英文；
- 倍速；
- 循环次数；
- 下载；
- 删除下载。

调整文案：

- “返回首页”改为“返回听力库”或“返回 Collection”；
- “选择一篇”改为“选择内容”；
- 错误信息使用“Lesson”对应的自然中文，不再新增“课程”文案。

### 15.6 返回行为

从播放器返回：

- 如果由 Collection 详情进入，回到该 Collection；
- 如果从恢复迷你播放器进入，可以回到听力库；
- 播放会话持续存在；
- 不暂停音频；
- 不释放当前 Object URL；
- 迷你播放器继续控制当前 Lesson。

## 16. translation-workflow.mjs

当前脚本直接读取并重写 v1 Course JSON。迁移后以 `<lesson-id>.json` 为输入，制作过程继续分块，但发布结果写回同一个 v2 文件。

### 16.1 新接口

建议使用 Lesson JSON 文件作为输入：

```text
prepare <lesson-file> <work-dir> [window-minutes]
merge <lesson-file> <work-dir> [language]
validate <lesson-file> <work-dir> [language]
status <work-dir> [language]
```

### 16.2 source digest

Digest 覆盖：

- Lesson ID；
- Transcript revision；
- Segment ID；
- Speaker ID；
- 英文文本；
- 默认原声 Cue 的 start/end。

只要原文、ID、说话人或时间轴改变，旧翻译任务失效。

### 16.3 merge

`merge` 只更新每个 Segment 的 `translation` 字段，不修改英文、说话人、时间轴或 Rendition。它先在内存中构造并完整校验 LessonDocument，再原子写入：

```text
<lesson-id>.json
```

写入临时文件，完整校验后 rename。

### 16.4 v1 兼容

迁移实施期间保留 v1 输入支持，直到：

1. 278 个内容全部迁移；
2. v2 LessonDocument 和全部简中 Translation 校验通过；
3. 旧 tracked JSON 被移除；
4. 新生产流程文档更新。

完成后可删除 v1 merge 路径，但不必在同一个提交中强行清理全部历史代码。

## 17. Vite 和部署脚本

### 17.1 vite.config.ts

发布允许列表改为：

```text
icon.svg
content
audio
```

移除对以下旧发布目录的依赖：

```text
samples
新概念/新概念1-美音
新概念/新概念2-美音
新概念/新概念3-美音
新概念/新概念4-美音
```

轻量模式复制 `content`，复制 `audio` 目录中的非 MP3 文件，但不得包含 MP3。

### 17.2 deploy-light.ps1

在构建前运行：

```text
validate:content
generate:catalog
```

继续检查 `dist` 中不存在 MP3。

### 17.3 deploy-audio.ps1

音频扫描根目录从：

```text
public/
```

收窄为：

```text
audio/
```

避免迁移期间旧目录中的忽略 MP3 被重复上传。

上传前运行：

```text
validate:content --require-audio
```

远端相对路径继续以 `audio` 部署根为准，具体实现时必须保证最终 URL 与 `resolveAudioSourceUrl()` 一致。

音频部署仍然：

- 只上传变化的 SHA；
- 不删除远端文件；
- 不清理旧路径；
- 不把清单敏感信息写入 Git。

### 17.4 部署顺序

未来用户明确批准生产部署时：

1. 先运行音频部署，把新 `/audio/lessons/...` 路径上传完成。
2. 验证新音频 Range 请求。
3. 再运行轻量部署，发布引用新路径的 JSON 和应用。

本 Feature 的计划和本地实施不包含生产部署。

## 18. 分阶段实施

### 阶段 0：冻结基线

1. 运行旧内容 inventory。
2. 保存 278 个 Lesson 的 ID、标题、时长、Segment、译文和音频 SHA 摘要。
3. 确认工作区已有无关改动，不覆盖 `.gitignore`、`private-courses` 等用户内容。
4. 不修改旧文件。

完成条件：

- 基线报告为 278 / 278 / 6784 / 6784；
- 没有重复 Lesson ID；
- 没有缺失 MP3。

### 阶段 1：定义 v2 Schema

1. 实现 Zod Schema。
2. 实现 LessonDocument 内部引用校验。
3. 实现 RuntimeLesson 组装器。
4. 为 v1 Course 编写兼容 Schema 和适配器。

完成条件：

- 人工构造的 v2 示例可以组装成现有播放器需要的 Segment；
- 非法引用、重复 ID 和越界 Cue 被拒绝；
- v1 两个 Podcast 和新概念示例可通过适配器读取。

### 阶段 2：迁移脚本 dry-run

1. 建立 Collection 映射。
2. 把 Lesson、Transcript、Translation 和 Rendition 构造成单个 v2 文档。
3. 建立说话人 ID 映射。
4. 计算 AudioSource SHA。
5. 生成 dry-run 报告。

完成条件：

- 不写正式目录；
- 新旧语义对照完全一致；
- 重复执行输出一致。

### 阶段 3：生成 v2 内容

1. 写入 staging。
2. 校验全部 staging JSON。
3. 复制并校验音频。
4. 放入 `content` 和 `audio`。
5. 运行独立 verify。

完成条件：

- 278 个 Lesson JSON 完整；
- 278 个原声 Rendition 完整；
- 6784 个英文和中文映射完整；
- 音频 SHA 全部与旧文件一致。

### 阶段 4：Catalog 与 Collection 索引

1. 新增 `generate-catalog.mjs`。
2. Collection JSON 保存有序 Lesson 摘要。
3. 生成小型 `content/catalog.json`。
4. 删除生成式 `src/library.ts`。
5. 把内容校验接入 build。

完成条件：

- 生成结果稳定；
- 生成失败不覆盖旧输出；
- TypeScript strict 通过。

### 阶段 5：运行时 Loader

1. 获取并校验单个 LessonDocument。
2. 校验默认 Rendition 和 Cue 引用。
3. 组装 RuntimeLesson。
4. 复用现有播放路径。
5. 保持英文无 Translation 时可播放。

完成条件：

- 短新概念和两个长 Podcast 都能打开；
- 当前句定位、循环和全文滚动行为不变；
- 外部 JSON 全部经过 Zod。

### 阶段 6：离线兼容

1. 新增 SavedLesson v2。
2. 保留 v1 Course 读取。
3. 保留 `course:`、`audio:`、`progress:` 键。
4. 验证 v1 已下载数据的冷启动恢复。
5. 验证新下载 v2 的删除和恢复。

完成条件：

- 升级后不需要重新下载旧材料；
- 旧进度和最后播放继续生效；
- 删除内置下载仍保留进度。

### 阶段 7：听力库界面

1. 首页显示 Collection。
2. 新增 Collection 详情状态。
3. 使用自然量词和来源类型。
4. 修改“选择内容”“返回听力库”等文案。
5. 保持迷你播放器。

完成条件：

- 320px 窄屏可操作；
- Collection 和 Lesson 控件不小于约 44 CSS 像素；
- 键盘和 ARIA 状态正确；
- 页面切换不重建音频会话。

### 阶段 8：翻译和部署工具

1. 更新 translation workflow。
2. 更新 Vite allowlist。
3. 更新 light deploy。
4. 收窄 audio deploy 扫描根目录。
5. 更新相关文档。

完成条件：

- 构建不引用旧公开目录；
- 轻量产物无 MP3；
- 音频部署 dry-run 只识别 `audio`；
- 不执行真实部署。

### 阶段 9：旧 tracked 数据退场

只有在新旧 verify 完全通过后：

1. 删除 Git 跟踪的旧 v1 JSON。
2. 删除旧生成器对旧目录的依赖。
3. 保留历史 Feature 文档，不重写历史事实。
4. 旧本地 MP3 是否清理由用户另行确认。

完成条件：

- `rg` 不再发现运行时代码引用旧 `/新概念/` 或 `/samples/` URL；
- 新构建完整；
- Git diff 中删除范围与 278 个旧 JSON 精确匹配。

## 19. 浏览器与设备验证

### 19.1 桌面浏览器

至少验证：

- 打开新概念短 Lesson；
- 打开 Lex 长 Podcast；
- 打开没有说话人数据的 Context engineering；
- Collection 首页和详情返回；
- 单句和全文切换；
- 逐句循环 1、3、无限；
- 倍速；
- 中英显示开关；
- 下载和删除下载；
- 刷新恢复；
- 离线打开已下载 Lesson。

### 19.2 旧数据升级

在迁移前版本中先下载至少：

- 一个新概念 Lesson；
- Lex Podcast。

保存进度并关闭应用，然后升级到新版本验证：

- 冷启动恢复；
- 旧 OPFS 音频可读；
- 旧 Course metadata 被适配；
- 不自动播放；
- 迷你播放器标题和当前句正确；
- 删除下载保留进度。

### 19.3 iPhone

由于本 Feature 改动内容加载、离线存储和页面层级，属于高风险离线改动，必须在真实 iPhone 验证：

- Safari；
- 主屏幕 Web App；
- 前后台切换；
- 锁屏后恢复；
- 离线冷启动；
- Collection 与播放器往返；
- 底部安全区；
- 最后字幕不被迷你播放器遮挡。

## 20. 自动和静态验证

每个实施批次至少运行：

```text
pnpm validate:content
pnpm generate:catalog
pnpm build
git diff --check
```

完整音频工作区另外运行：

```text
pnpm validate:content --require-audio
node scripts/migrate-lessons-v2.mjs verify
```

项目目前不增加测试框架。适合写成纯函数的内容合并、ID 对照和 URL 解析可以通过 Node 验证脚本覆盖。

## 21. 验收标准

### 21.1 数据

- [ ] 278 个旧内容全部成为 Lesson。
- [ ] Lesson ID 集合与迁移前完全相同。
- [ ] 278 个原始 MP3 SHA-256 完全相同。
- [ ] 6784 个 Segment ID、英文和时间轴完全相同。
- [ ] 6784 个 `zh-Hans` 译文完全相同。
- [ ] 867 个已有说话人 Segment 不丢失。
- [ ] 迁移没有自动润色、重译或改写内容。
- [ ] 所有外部 JSON 通过 Zod 和文档内部引用校验。

### 21.2 目录

- [ ] 正式 JSON 位于 `content`。
- [ ] 正式 MP3 位于 `audio`。
- [ ] MP3 仍被 Git 忽略。
- [ ] 制作中间文件没有进入 Git。
- [ ] 运行时不再引用旧 `/新概念/` 和 `/samples/` URL。

### 21.3 应用

- [ ] Library 首页以 Collection 组织。
- [ ] 新概念四册、Lex 和 The Pragmatic Engineer 可进入。
- [ ] Collection 详情显示正确 Lessons 和量词。
- [ ] 默认英文原声正常播放。
- [ ] 中英字幕保持现有行为。
- [ ] 循环、倍速、进度和估算逐词高亮没有回归。
- [ ] 返回听力库不重建播放会话。
- [ ] 迷你播放器保持可用。

### 21.4 兼容

- [ ] 已下载 v1 Course 继续离线播放。
- [ ] 新下载保存为可校验的 v2 SavedLesson。
- [ ] `progress:<id>` 继续生效。
- [ ] `last-played` 继续生效。
- [ ] 删除下载保留内置 Lesson 进度。

### 21.5 构建与发布准备

- [ ] `pnpm build` 通过。
- [ ] `git diff --check` 通过。
- [ ] 轻量构建不包含 MP3。
- [ ] 音频部署只扫描 `audio`。
- [ ] 本 Feature 没有执行 deploy、push 或生产部署。

## 22. 风险与控制

### 22.1 大批量内容静默丢失

风险：

- 重构过程中漏 Segment；
- Translation 错位；
- speaker 文本丢失。

控制：

- 前后 ID 和 digest 对照；
- 独立 verify；
- 不使用数组下标关联；
- 不在迁移中修改文本。

### 22.2 旧下载失效

风险：

- 类型改名后只接受 v2；
- 改变存储键；
- OPFS 文件名变化。

控制：

- 保留存储键和 OPFS 文件名；
- v1/v2 双 Schema；
- 真实升级测试。

### 22.3 目录切换导致线上音频 404

风险：

- JSON 先发布，音频路径尚未上传。

控制：

- 本 Feature 不部署；
- 未来先部署音频，再部署轻量内容；
- 部署后检查 Range 请求。

### 22.4 Git 误收大型文件

风险：

- 新 `audio` 不再匹配忽略规则；
- staging 文件进入 Git。

控制：

- 保留旧 `public/**/*.mp3`，并新增 `audio/**/*.mp3`；
- staging 使用被忽略的明确目录；
- 验收检查 `git status` 和文件大小。

### 22.5 把迁移误认为授权

风险：

- 旧公开内容被自动标记为 licensed；
- 本地 Lenny 内容进入公开目录。

控制：

- 默认 rights 为 `unverified`；
- 迁移不改变授权结论；
- private-courses 不进入生成器输入。

### 22.6 一次改动过大

风险：

- 内容、存储、UI 和部署同时切换，问题难定位。

控制：

- 按阶段实施；
- v1 loader 保留到验收完成；
- 新旧内容对照；
- 每阶段单独 build 和 diff 检查；
- 不在同一阶段增加中英音轨切换功能。

## 23. 回滚

本 Feature 未部署生产时，回滚只涉及本地 Git 工作区：

1. 保留旧 v1 内容直到 v2 verify 完成。
2. 在应用切换前保留旧生成器输出作为对照。
3. 不删除旧本地 MP3。
4. 新目录发生问题时停止切换，不修改用户 IndexedDB。

如果未来部署后需要回滚：

1. 回滚应用和 JSON 到上一版本；
2. 旧远端 MP3 路径仍保留，因此旧版可继续播放；
3. 新音频部署不会删除旧音频；
4. IndexedDB 仍能读取 v1 和 v2 SavedLesson；
5. 不执行远端递归清理。

## 24. 建议实施顺序摘要

```text
盘点并冻结旧内容
    ↓
实现 v2 Zod Schema 与 v1 adapter
    ↓
迁移 dry-run
    ↓
生成并 verify 278 个 Lesson
    ↓
生成新 Library catalog
    ↓
切换运行时 Loader
    ↓
验证旧下载兼容
    ↓
迁移听力库界面
    ↓
更新 translation/build/deploy 工具
    ↓
移除 tracked 旧 JSON
    ↓
桌面与真实 iPhone 验收
```

实施结束后，项目将具备清晰的 Lesson 内容边界和本地音频目录，同时不承担本期之外的 OSS、中文配音和中英交叉播放复杂度。
