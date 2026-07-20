# 英语听力训练 PWA 设计文档

版本：0.1
部署目标：`learn.iceriver.cc`
目标平台：iPhone Safari / iOS 主屏幕 Web App，同时兼容桌面浏览器
主要技术栈：Preact、TypeScript、Vite、IndexedDB、OPFS、Service Worker

---

## 1. 项目背景

本项目是一款个人使用的英语听力训练工具。

核心学习目标是提高对以下英文内容的真实听力理解能力：

* AI 与人工智能行业访谈
* 软件工程与计算机技术 Podcast
* 创业、产品与科技商业访谈
* 宏观经济、投资和思想类内容
* 英文文章、有声文章和作者原声朗读

典型资料来源包括：

* Lex Fridman Podcast
* The Pragmatic Engineer Podcast
* Lenny’s Podcast
* a16z
* Dwarkesh Podcast
* Acquired
* Paul Graham 文章
* Derek Sivers 文章和官方朗读
* Ray Dalio 文章
* Thinking Machines 等 AI 技术文章

用户自行准备或导入音频和字幕，不提供公共内容抓取或公开内容分发服务。

---

## 2. 产品目标

第一版需要完成以下核心闭环：

1. 导入一份完整 MP3。
2. 导入与 MP3 对应的字幕 JSON。
3. 将音频缓存在 iPhone 本地。
4. 在无网络情况下打开应用并播放音频。
5. 按句子跳转、循环和跟读。
6. 根据用户词表高亮未掌握的拼写形式。
7. 点击字幕中的单词，实时更新掌握状态。
8. 保存播放进度、难句和学习记录。
9. 支持词表、课程信息和学习数据的导入导出。

成功标准不是制作一个完整的英语教学平台，而是提供一个稳定、高效、适合个人长期使用的听力训练工具。

---

## 3. 第一版不做的功能

以下功能暂不包含在 MVP 中：

* App Store 原生应用
* 用户注册和多用户系统
* 云端多设备同步
* 在线支付
* 公共课程市场
* 自动抓取任意网站内容
* 在线下载受版权保护的 Podcast
* AI 自动解释全部单词
* AI 对话练习
* 发音评分
* 复杂间隔重复算法
* 完整词形还原
* 自动合并词族
* 实时语音识别
* 后台下载
* 多人协作

这些功能可以在后续版本中逐步增加。

---

## 4. 核心设计原则

### 4.1 完整音频加时间轴

每个课程使用：

```text
一个完整 MP3
+
一个带 start/end 的字幕 JSON
```

不按一分钟切音频，也不按句子拆成大量文件。

音频通过 `HTMLAudioElement` 播放，不将完整音频解码为 `AudioBuffer`。

### 4.2 每个拼写形式独立记录

系统不做 lemma 词形归并。

以下内容分别是独立词条：

```text
train
trains
trained
training
```

用户掌握 `train` 不代表自动掌握 `trained`。

这样能够更准确地反映用户是否能在真实语流中识别某一个具体词形。

### 4.3 本地优先

课程音频、字幕、词表、学习状态应尽量保存在 iPhone 本地。

网络只用于：

* 首次打开应用
* 下载新课程
* 手动导入资料
* 更新应用代码

已经下载的课程必须能够完全离线使用。

### 4.4 字幕逐渐隐藏

产品设计应帮助用户逐渐摆脱字幕，而不是鼓励一直看字幕。

需要支持：

* 隐藏全部字幕
* 显示当前句
* 显示完整字幕
* 先盲听再显示
* 学习后再次隐藏字幕验证

---

## 5. 技术架构

```text
Preact UI
│
├── Audio Player
│   └── HTMLAudioElement
│
├── Application State
│   └── Preact Signals 或轻量状态管理
│
├── IndexedDB
│   ├── lessons
│   ├── transcripts
│   ├── vocabulary
│   ├── progress
│   ├── bookmarks
│   └── settings
│
├── OPFS
│   └── MP3 文件
│
├── Service Worker
│   └── HTML、JS、CSS、图标和应用外壳
│
└── Import / Export
    ├── JSON
    ├── MP3
    └── ZIP，可在后续实现
```

### 5.1 推荐依赖

优先保持依赖简单。

建议：

```text
preact
typescript
vite
@preact/signals
idb
vite-plugin-pwa
zod
```

可选：

```text
fflate
```

`fflate` 用于后续实现课程包 ZIP 导入导出。

不要在第一版引入大型 UI 框架。

---

## 6. 本地存储

### 6.1 OPFS

优先使用 OPFS 保存 MP3。

文件结构示例：

```text
/audio/
  lesson-001.mp3
  lesson-002.mp3
```

需要进行运行时能力检测：

```ts
const supportsOPFS =
  "storage" in navigator &&
  typeof navigator.storage.getDirectory === "function";
```

如果 OPFS 不可用，使用 IndexedDB Blob 作为后备方案。

### 6.2 IndexedDB

建议数据库名：

```text
english-listening
```

版本：

```text
1
```

Object Stores：

```text
lessons
transcripts
vocabulary
progress
bookmarks
settings
```

### 6.3 持久化存储

应用首次下载课程时尝试调用：

```ts
navigator.storage.persist()
```

并通过：

```ts
navigator.storage.estimate()
```

显示：

* 当前已使用空间
* 可用配额
* 是否已获得持久化存储

应用必须明确提示：

> 清除 Safari 网站数据可能删除所有离线音频和学习数据。

---

## 7. 数据模型

### 7.1 Lesson

```ts
type AudioStorageType = "opfs" | "indexeddb" | "remote";

type ContentType =
  | "podcast"
  | "article_tts"
  | "official_narration"
  | "audiobook"
  | "interview";

interface Lesson {
  id: string;
  title: string;
  author?: string;
  sourceName?: string;
  sourceUrl?: string;

  contentType: ContentType;

  audioFilename: string;
  audioStorageType: AudioStorageType;
  audioSize?: number;
  duration: number;

  transcriptId: string;

  topics: string[];
  difficulty?: 1 | 2 | 3 | 4 | 5;

  downloaded: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 7.2 Transcript

```ts
interface Transcript {
  id: string;
  lessonId: string;
  language: "en";
  chapters: Chapter[];
  segments: TranscriptSegment[];
}
```

### 7.3 Chapter

```ts
interface Chapter {
  id: string;
  title: string;
  start: number;
  end: number;
}
```

### 7.4 TranscriptSegment

```ts
interface TranscriptSegment {
  id: string;
  lessonId: string;
  chapterId?: string;

  start: number;
  end: number;

  text: string;
  speaker?: string;

  words?: TranscriptWord[];

  previousSegmentId?: string;
  nextSegmentId?: string;
}
```

### 7.5 TranscriptWord

第一版不做词形还原。

```ts
interface TranscriptWord {
  text: string;
  normalized: string;
  startChar: number;
  endChar: number;
}
```

示例：

```json
{
  "text": "trained",
  "normalized": "trained",
  "startChar": 16,
  "endChar": 23
}
```

### 7.6 VocabularyEntry

```ts
type WordStatus =
  | "learning"
  | "mastered"
  | "ignored";

type VocabularySource =
  | "imported"
  | "manual"
  | "transcript";

interface VocabularyEntry {
  word: string;
  status: WordStatus;

  source: VocabularySource;

  createdAt: string;
  updatedAt: string;

  note?: string;
}
```

数据库中不存在的单词，默认状态为：

```text
unknown
```

### 7.7 Progress

```ts
interface LessonProgress {
  lessonId: string;

  currentTime: number;
  currentSegmentId?: string;

  completedSegmentIds: string[];
  difficultSegmentIds: string[];

  firstStartedAt: string;
  lastPlayedAt: string;

  totalListeningSeconds: number;
}
```

### 7.8 Bookmark

```ts
interface Bookmark {
  id: string;
  lessonId: string;
  segmentId: string;

  type:
    | "difficult"
    | "favorite"
    | "review";

  note?: string;

  createdAt: string;
}
```

---

## 8. 词语标准化

系统只进行最小标准化，不进行词形还原。

标准化目标：

```text
Models      → models
models,     → models
“models”    → models
MODEL       → model
```

但应尽量保留技术词中的字符：

```text
C++
C#
.NET
GPT-5
Node.js
fine-tuning
don't
model's
```

建议实现为基于 Token 的解析，而不是简单用空格切分。

第一版可采用以下规则：

1. 统一 Unicode 为 NFKC。
2. 转为小写作为查询键。
3. 去除外围普通标点。
4. 保留内部的：

   * `'`
   * `-`
   * `.`
   * `+`
   * `#`
5. 原文显示始终使用 `text`。
6. 词表查询始终使用 `normalized`。

需要为以下内容增加测试：

```text
don't
we're
model's
fine-tuning
state-of-the-art
GPT-5
C++
C#
.NET
Node.js
OpenAI
LLMs
```

---

## 9. 音频播放器

### 9.1 基础功能

必须支持：

* 播放和暂停
* 前进 5 秒
* 后退 5 秒
* 调整播放进度
* 0.75×、0.8×、0.9×、1.0×、1.1×、1.25×、1.5×
* 上一句
* 下一句
* 播放当前句
* 循环当前句
* 播放上一句加当前句
* 播放当前句加下一句
* 连续播放
* 保存当前位置

### 9.2 句子播放

播放句子时使用：

```ts
audio.currentTime = Math.max(0, segment.start - leadIn);
```

默认：

```text
leadIn：0.15 秒
leadOut：0.2 秒
```

配置允许用户修改：

```text
句首提前：0～0.5 秒
句尾延长：0～0.8 秒
循环间隔：0～1.5 秒
```

### 9.3 循环监控

不要只依赖 `timeupdate`。

前台播放时使用：

```ts
requestAnimationFrame()
```

监控 `audio.currentTime`。

伪代码：

```ts
function monitorLoop() {
  if (
    loopEnabled &&
    activeSegment &&
    audio.currentTime >= activeSegment.end + leadOut
  ) {
    audio.pause();

    window.setTimeout(() => {
      audio.currentTime = Math.max(
        0,
        activeSegment.start - leadIn,
      );

      void audio.play();
    }, loopGapMs);
  }

  requestAnimationFrame(monitorLoop);
}
```

必须避免重复注册多个监控循环。

### 9.4 Object URL 管理

从 OPFS 或 IndexedDB Blob 加载音频时，使用：

```ts
URL.createObjectURL(file)
```

切换课程时必须：

```ts
URL.revokeObjectURL(oldUrl)
```

---

## 10. 字幕界面

### 10.1 显示模式

支持三种模式：

```text
隐藏字幕
仅显示当前句
显示完整字幕
```

默认学习流程建议：

```text
第一次打开课程：隐藏字幕
用户主动操作后：显示当前句
详细学习时：显示完整字幕
```

### 10.2 当前句追踪

根据 `audio.currentTime` 使用二分查找定位当前 segment。

不要每次从头遍历全部字幕。

```ts
function findSegmentByTime(
  segments: TranscriptSegment[],
  time: number,
): TranscriptSegment | undefined
```

### 10.3 高亮规则

```text
unknown   → 强高亮
learning  → 弱高亮或下划线
mastered  → 普通文字
ignored   → 普通文字或降低透明度
```

不建议只依赖颜色，必须同时使用：

* 字体粗细
* 下划线
* 背景形状
* 图标或边框

确保可访问性。

### 10.4 点击单词

点击一个字幕单词后，显示 iPhone 底部 Sheet：

```text
单词原文
标准化键
当前状态
本句全文

播放本句
标记为学习中
标记为已掌握
忽略
删除词表记录
```

修改后：

1. 保存到 IndexedDB。
2. 更新内存中的词表 Map。
3. 当前页面立即重新渲染。
4. 其他课程中的相同拼写形式自动使用新状态。

---

## 11. 课程页面

课程页面建议布局：

```text
顶部导航
标题与作者
章节选择
播放器进度
播放控制
字幕显示切换
当前句
完整字幕列表
学习工具栏
```

移动端优先。

播放器控制区域需要固定在页面底部，方便单手操作。

核心按钮尺寸不得小于 44×44 CSS 像素。

---

## 12. 首页

首页展示：

```text
继续学习
已下载课程
全部课程
难句复习
词表
导入课程
设置
```

课程卡片显示：

```text
标题
作者或来源
时长
内容类型
难度
下载状态
学习进度
最后播放时间
```

---

## 13. 词表页面

词表页面支持：

* 搜索
* 状态筛选
* 按字母排序
* 按更新时间排序
* 批量修改状态
* 删除记录
* 导入
* 导出

筛选条件：

```text
learning
mastered
ignored
```

系统不单独保存所有 unknown 单词。

可增加“当前课程中的未知词”视图，但 unknown 由字幕和词表实时计算。

---

## 14. 课程导入

### 14.1 基础导入方式

第一版支持用户选择：

```text
MP3 文件
+
字幕 JSON 文件
```

流程：

1. 用户选择 MP3。
2. 用户选择 JSON。
3. 校验 JSON 格式。
4. 校验课程 ID。
5. 校验每个 segment：

   * `start >= 0`
   * `end > start`
   * 按时间排序
   * `end <= duration + 容差`
6. 保存 MP3 到 OPFS。
7. 保存课程和字幕到 IndexedDB。
8. 显示导入完成。
9. 提供立即学习按钮。

### 14.2 课程 JSON 格式

建议支持单文件 manifest：

```json
{
  "version": 1,
  "lesson": {
    "id": "pg-startup-growth",
    "title": "Startup = Growth",
    "author": "Paul Graham",
    "sourceName": "Paul Graham",
    "sourceUrl": "https://paulgraham.com/growth.html",
    "contentType": "article_tts",
    "audioFilename": "audio.mp3",
    "duration": 1860.2,
    "topics": [
      "startup",
      "growth"
    ],
    "difficulty": 3
  },
  "chapters": [],
  "segments": [
    {
      "id": "s001",
      "start": 0,
      "end": 5.24,
      "text": "A startup is a company designed to grow fast."
    }
  ]
}
```

### 14.3 未来课程包

第二阶段支持 ZIP：

```text
lesson.zip
├── manifest.json
├── audio.mp3
└── cover.webp
```

第一版可先不实现 ZIP，但数据结构应兼容。

---

## 15. 词表导入导出

### 15.1 TXT 导入

格式：

```text
computer
software
model
trained
training
```

导入后默认：

```text
status = mastered
source = imported
```

### 15.2 CSV 导入

```csv
word,status
computer,mastered
inference,learning
altman,ignored
```

### 15.3 JSON 导入

```json
{
  "version": 1,
  "words": [
    {
      "word": "computer",
      "status": "mastered"
    }
  ]
}
```

### 15.4 导出

需要支持导出全部词表为 JSON 和 CSV。

导出文件名示例：

```text
vocabulary-2026-07-20.json
```

---

## 16. 完整备份

用户必须能够备份：

* 课程元数据
* 字幕
* 词表
* 播放进度
* 难句
* 设置

第一版可以不包含 MP3，只导出学习数据。

后续再增加：

```text
完整备份 ZIP
```

包含全部 MP3。

---

## 17. Service Worker 与离线模式

使用 `vite-plugin-pwa` 或 Workbox。

缓存内容：

* HTML
* JavaScript
* CSS
* 图标
* Manifest
* 应用字体
* 离线错误页

不要通过预缓存把全部课程 MP3 放入 Cache Storage。

MP3 由用户主动导入或下载，并保存到 OPFS。

应用离线启动后：

* 首页可以打开
* 已下载课程可以打开
* 词表可以管理
* 学习进度可以更新
* 未下载课程显示不可用状态

---

## 18. 设置页面

第一版设置：

```text
默认播放速度
句首提前时间
句尾延长时间
循环间隔
默认字幕模式
自动滚动字幕
是否自动播放下一句
是否保持屏幕常亮
存储空间信息
持久化存储状态
导出数据
清除数据
```

“清除数据”必须二次确认。

分别提供：

```text
只清除音频
只清除学习记录
清除全部本地数据
```

---

## 19. 难句复习

用户可以把某个 segment 标记为难句。

难句页面支持：

* 按课程筛选
* 随机播放
* 顺序播放
* 隐藏字幕
* 循环当前句
* 标记已解决
* 删除难句标记

第一版不需要复杂的间隔重复算法。

可以使用简单字段：

```ts
interface DifficultSegmentState {
  lessonId: string;
  segmentId: string;
  reviewCount: number;
  lastReviewedAt?: string;
  resolved: boolean;
}
```

---

## 20. 学习流程

推荐在界面中体现以下步骤：

### 阶段一：盲听

```text
隐藏字幕
播放当前句或短片段
```

### 阶段二：重复听

```text
循环当前句
调整速度
```

### 阶段三：查看字幕

```text
显示当前句
查看未知拼写
更新词表
```

### 阶段四：跟读

```text
播放一句
暂停
用户跟读
再次播放
```

### 阶段五：验证

```text
重新隐藏字幕
再次播放
```

第一版不需要强制引导流程，但界面应支持以上操作。

---

## 21. 性能要求

### 21.1 音频

* 一小时 MP3 可以稳定播放。
* 不将完整 MP3 读入 ArrayBuffer。
* 不使用 `decodeAudioData()` 解码长音频。
* 切换课程时释放旧 Object URL。
* 当前时间更新不得引起整个字幕列表频繁重渲染。

### 21.2 字幕

* 支持至少 5000 个 segment。
* 使用虚拟列表或窗口化渲染优化超长字幕。
* 当前句定位使用二分查找。
* 词表加载后在内存中保存为 `Map<string, VocabularyEntry>`。
* 单词状态查询应接近 O(1)。

### 21.3 IndexedDB

* 所有数据库操作封装到 repository 层。
* UI 组件不得直接调用底层 IndexedDB API。
* 数据库升级必须使用版本迁移。

---

## 22. 推荐目录结构

```text
src/
├── app/
│   ├── App.tsx
│   ├── routes.ts
│   └── providers.tsx
│
├── components/
│   ├── audio/
│   ├── transcript/
│   ├── vocabulary/
│   ├── lesson/
│   └── common/
│
├── pages/
│   ├── HomePage.tsx
│   ├── LessonPage.tsx
│   ├── ImportPage.tsx
│   ├── VocabularyPage.tsx
│   ├── ReviewPage.tsx
│   └── SettingsPage.tsx
│
├── audio/
│   ├── audioPlayer.ts
│   ├── loopController.ts
│   └── audioStorage.ts
│
├── db/
│   ├── database.ts
│   ├── migrations.ts
│   └── repositories/
│       ├── lessonRepository.ts
│       ├── transcriptRepository.ts
│       ├── vocabularyRepository.ts
│       ├── progressRepository.ts
│       └── bookmarkRepository.ts
│
├── storage/
│   ├── opfsStorage.ts
│   ├── indexedDbAudioStorage.ts
│   └── storageManager.ts
│
├── import/
│   ├── lessonImporter.ts
│   ├── vocabularyImporter.ts
│   └── validators.ts
│
├── transcript/
│   ├── tokenizer.ts
│   ├── normalization.ts
│   ├── segmentSearch.ts
│   └── transcriptParser.ts
│
├── export/
│   ├── vocabularyExporter.ts
│   └── backupExporter.ts
│
├── models/
│   ├── lesson.ts
│   ├── transcript.ts
│   ├── vocabulary.ts
│   └── progress.ts
│
├── state/
│   ├── playerState.ts
│   ├── lessonState.ts
│   └── vocabularyState.ts
│
└── utils/
```

---

## 23. 错误处理

必须处理：

* MP3 文件不存在
* MP3 无法播放
* JSON 格式错误
* 字幕时间戳越界
* OPFS 不支持
* 本地空间不足
* 用户取消文件选择
* IndexedDB 写入失败
* Service Worker 更新失败
* 音频 Object URL 失效
* 当前字幕 ID 不存在
* 课程导入重复
* 数据版本不兼容

所有错误应显示用户可理解的信息，不直接显示底层异常堆栈。

开发环境可以将详细异常输出到控制台。

---

## 24. 安全与隐私

* 所有学习数据默认仅存储在本地。
* 不收集用户行为分析。
* 不引入第三方广告或追踪脚本。
* 不在前端代码中保存第三方 API Key。
* 未来接入 AI 服务时，API 请求必须通过私人后端代理。
* 内容库仅供个人使用。
* 不提供公开分享受版权保护音频的功能。

---

## 25. 测试要求

### 25.1 单元测试

重点测试：

* 单词标准化
* 技术词 Token 处理
* 时间轴二分查找
* JSON 校验
* 词表状态判断
* 课程导入冲突
* 播放循环边界计算
* 数据导入导出

### 25.2 集成测试

测试场景：

1. 导入 MP3 和 JSON。
2. 播放课程。
3. 跳转到指定句。
4. 循环当前句。
5. 点击未知词。
6. 标记为 mastered。
7. 页面立即取消高亮。
8. 刷新页面后状态仍然存在。
9. 断网后重新打开课程。
10. 删除课程音频。
11. 导出并重新导入词表。

### 25.3 iPhone 实机测试

必须在真实 iPhone Safari 和添加到主屏幕后的 Web App 中测试：

* 离线启动
* 音频播放
* 进度跳转
* 一小时 MP3
* OPFS 保存
* 页面切后台后恢复
* 锁屏后恢复
* 添加到主屏幕
* 存储空间不足时的提示
* 长字幕滚动性能

---

## 26. MVP 开发顺序

### 阶段一：基础项目

* 创建 Preact + TypeScript + Vite 项目
* 配置路由
* 配置 PWA
* 创建 IndexedDB
* 创建基础页面

### 阶段二：课程导入

* 导入 MP3
* 导入 JSON
* 校验格式
* OPFS 保存
* 课程列表

### 阶段三：播放器

* 播放和暂停
* 进度条
* 调速
* 上一句、下一句
* 当前句循环
* 播放进度保存

### 阶段四：字幕

* 当前句定位
* 完整字幕显示
* 当前句自动滚动
* 隐藏字幕模式
* 单词 Token 化

### 阶段五：词表

* 导入词表
* unknown 高亮
* 点击单词更新状态
* 词表页面
* JSON/CSV 导出

### 阶段六：离线与稳定性

* Service Worker
* 离线启动
* 存储状态显示
* OPFS 后备方案
* 错误处理
* iPhone 实机优化

### 阶段七：难句与备份

* 难句收藏
* 难句复习
* 学习数据导出
* 设置页面

---

## 27. MVP 验收标准

MVP 完成需要满足：

1. 可以在 iPhone 上安装为主屏幕 Web App。
2. 可以导入一个一小时 MP3。
3. 可以导入带句子时间戳的 JSON。
4. 可以离线打开并播放该 MP3。
5. 可以从任意字幕句跳转到对应时间。
6. 可以循环当前句。
7. 可以调整播放速度。
8. 可以隐藏和显示字幕。
9. 可以导入一个已掌握单词表。
10. 不在词表中的拼写形式会被高亮。
11. 点击单词可以标记为 mastered、learning 或 ignored。
12. 修改词表后字幕立即更新。
13. 刷新和关闭应用后数据不会丢失。
14. 可以保存课程播放位置。
15. 可以收藏和复习难句。
16. 可以导出词表和学习数据。
17. 清除网站缓存后，应用能够明确提示本地数据风险。
18. 长音频播放不会将整个文件解码进内存。
19. 5000 条字幕下仍能流畅滚动和定位。
20. 所有核心流程有清晰错误提示。

---

## 28. Codex 实施要求

请严格按照以下原则开发：

1. 使用 TypeScript strict 模式。
2. 不使用 `any`，除非有明确注释解释原因。
3. 所有外部输入必须通过 Zod 校验。
4. IndexedDB 访问必须封装在 repository 层。
5. 音频存储必须封装为统一接口。
6. OPFS 与 IndexedDB Blob 使用同一个存储抽象。
7. UI 组件不能直接操作 OPFS。
8. 播放器逻辑与界面组件分离。
9. 字幕查找必须使用二分查找。
10. 长字幕列表必须避免完整频繁重渲染。
11. 每完成一个阶段，先补充测试再进入下一阶段。
12. 保持界面移动端优先。
13. 不提前实现非 MVP 功能。
14. 所有核心数据结构必须有导入导出能力。
15. 所有代码应便于未来增加云同步和 AI 功能。

---

## 29. 第一份测试课程

建议使用一个短课程验证系统，不要直接从四小时 Podcast 开始。

测试课程要求：

```text
音频长度：2～10 分钟
格式：MP3
字幕：20～100 个 segment
内容：Derek Sivers 作者原声，或短篇技术文章
```

验证成功后，再使用：

```text
Paul Graham TTS
CoRecursive
Pragmatic Engineer
Acquired Google Part II
```

逐步测试更长资料。

---

## 30. 后续版本方向

### 版本二

* ZIP 课程包
* 云端课程目录
* 用户登录
* 多设备同步
* 自动下载课程
* 课程章节
* 句子录音
* 简单复习计划

### 版本三

* 输入文章 URL
* 服务器提取正文
* AI 清理和切句
* TTS 生成 MP3
* 自动生成时间轴
* 技术词发音词典
* Podcast ASR 和 forced alignment

### 版本四

* 听力掌握与阅读掌握分离
* 新材料盲听测试
* 词频分析
* 自动推荐难度
* 真人与 TTS 配对训练
* 同主题内容推荐
* AI 句子解释
* 口语跟读评分
