# Feature 0016：VoxCPM2 中文 AI 配音与中英交叉播放

## 状态

设计完成，待实施。

## 1. 结论

本 Feature 使用本机 WSL2 中的 VoxCPM2，为 Lesson 生成中性、明确标注的简体中文 AI 配音，并把配音作为
`zh-ai` AudioRendition 接入现有 Lesson v2 内容模型。

首批制作范围固定为新概念英语第四册第 40–48 课：

| 范围 | Lesson 数 | Segment 数 | 英文原声总时长 | 现有简中译文 |
| --- | ---: | ---: | ---: | ---: |
| Lesson 40–48 | 9 | 288 | 2535.63 秒 | 288 / 288 |

播放器在现有逐句循环基础上增加中英交叉播放。首版以 PlaybackPattern 表达播放步骤，并提供：

- 仅英文；
- 英文 1 遍、中文 1 遍；
- 英文 3 遍、中文 1 遍；
- 使用现有 `1–10` 英文循环次数形成“英文 N 遍、中文 1 遍”的自定义模式。

生产工具必须支持断点续做、输入摘要校验、逐 Segment 原子输出、稳定音色、可复现参数、完整成品校验和
dry-run。不得因为某个 Segment 失败而静默生成不完整 Lesson。

## 2. 背景

Feature 0015 已把内容迁移为 Lesson v2：

- 英文原文和简中译文共享稳定 Segment ID；
- 每个 AudioRendition 拥有自己的 AudioSource 和 Cue 时间轴；
- `en` 表示英文原声；
- `zh-ai` 表示简体中文 AI 配音；
- 正式 JSON 位于 `content/lessons/`；
- 正式音频位于被 Git 忽略的 `audio/lessons/`；
- 制作中间文件位于被 Git 忽略的 `content-work/<lesson-id>/`。

当前运行时仍只装配 `defaultRenditionId`，播放器也只控制一个英文 `HTMLAudioElement`。因此仅生成中文 MP3
还不能实现“英文三遍、中文一遍”；本 Feature 必须同时完成生产管线、数据校验、运行时加载和播放器状态机。

长期术语和产品约束以
[`听力材料术语与音频内容约定`](../../general/听力材料术语与音频内容约定.md)
为准。

## 3. 目标

### 3.1 本地部署

- 在 WSL2 Ubuntu 22.04 中建立独立 VoxCPM2 Python 3.10 虚拟环境；
- 使用 RTX 5090 CUDA 推理；
- 模型、Python 环境和下载缓存不进入仓库；
- Windows 项目通过 `wsl.exe` 调用生成工具；
- 把经过实测的安装、验证、更新、卸载和故障处理写入 `docs/general/`。

### 3.2 稳定生产

- 从 Lesson v2 JSON 读取 `translation.speechText ?? translation.text`；
- 使用统一的中性 AI 声音，不模仿原教材朗读者或其他真人；
- 每个 Segment 独立生成并保留 WAV 中间件；
- 所有 Segment 使用同一个稳定 voice anchor；
- 支持失败重试和从已完成 Segment 恢复；
- 拼接为一个 48kHz 单声道 Lesson WAV，再编码为 MP3；
- 按实际采样数生成 `zh-ai` Cue，不使用 ASR 反推时间轴；
- 写入 MP3 字节数、SHA-256、时长和完整生成元数据；
- 翻译、`speechText`、revision 或生成配置变化时，旧产物必须判定为过期。

### 3.3 播放体验

- 用户可以保持现有“仅英文”行为；
- 有 `zh-ai` 的 Lesson 可以选择中英交叉播放；
- 每个 Segment 按 PlaybackPattern 完整播放后再进入下一 Segment；
- 有限模式完成最后一个 Segment 后暂停；
- 手动切句、拖动、切换模式或切换循环次数时重置当前模式会话；
- 页面导航不卸载当前播放会话；
- 前台和后台结束检测共用同一完成处理路径和切换锁；
- 中文配音在界面明确标注为 AI 生成且不是官方中文版本。

## 4. 非目标

- 不恢复用户自定义 MP3 或字幕导入；
- 不提供在线 TTS API 或多租户服务；
- 不部署 Nano-vLLM、vLLM-Omni 或 llama.cpp-omni；
- 不训练或微调 VoxCPM2；
- 不克隆教材朗读者、名人或其他未经许可的真人声音；
- 不在本 Feature 中制作新概念英语第四册第 1–39 课；
- 不执行生产部署；
- 不把模型、WAV 中间件或 MP3 加入 Git。

## 5. 部署设计

### 5.1 环境位置

```text
/home/river/ai/voxcpm2/
├── .venv/
├── models/
└── voices/
```

项目和产物继续位于 Windows D 盘，通过 WSL 路径访问：

```text
D:\dev\learn-English
= /mnt/d/dev/learn-English
```

虚拟环境不放到 `/mnt/d`，避免大量小文件跨 Windows 文件系统造成安装和导入性能下降。

### 5.2 版本记录

部署文档记录并验证：

- Ubuntu 版本；
- Python 版本；
- `uv` 版本；
- VoxCPM 版本；
- PyTorch 版本；
- PyTorch CUDA runtime 版本；
- GPU 名称；
- 模型 ID。

生成清单同时记录实际版本。升级依赖或模型后，旧 Segment 不自动当作同一批可复用产物。

### 5.3 Windows 调用边界

Node 生产脚本负责：

- Zod 校验 Lesson JSON；
- 构造 manifest；
- 调用 WSL Python worker；
- 汇总结果；
- 更新正式 Lesson JSON；
- 执行最终内容校验。

Python worker 只负责：

- 加载 VoxCPM2；
- 建立或加载 voice anchor；
- 生成 Segment WAV；
- 拼接 WAV；
- 编码或协助编码 MP3；
- 输出机器可读 receipt。

正式 JSON 只能由 Node 脚本原子更新，Python 不直接修改 `content/`。

## 6. 音色设计

### 6.1 中性声音

使用固定 voice profile：

```text
neutral-female-v1
```

目标描述：

```text
成年女性，标准普通话，中性自然，清晰平稳，语速适中，适合语言学习；
不模仿任何真人，不使用夸张播音腔，不带背景音乐。
```

### 6.2 Voice anchor

纯文字音色设计对 288 次独立调用可能产生音色漂移，因此先用固定文本、固定 seed 和固定参数生成一段
AI voice anchor。后续 Segment 全部使用该 anchor 作为 `reference_wav_path`，并继续附带相同控制描述。

anchor 本身属于本地制作资源：

```text
content-work/_shared/voxcpm2/voices/neutral-female-v1.wav
```

对应 receipt 记录：

- anchor 文本；
- seed；
- cfg；
- inference timesteps；
- 模型 ID 和版本；
- WAV SHA-256；
- 创建时间。

任何 anchor 配置变化都形成新的 voice profile ID，不覆盖旧 profile 的语义。

### 6.3 朗读文本

每个 Segment 使用：

```text
segment.translation.speechText ?? segment.translation.text
```

`speechText` 只处理确实影响朗读的问题，例如：

- 英文字母缩写的中文读法；
- 数学符号、年份和单位；
- 括号、破折号或书面标记；
- 不适合直接朗读的专有名词写法。

不得为了让声音更自然而改变原译文含义。需要 `speechText` 时，先更新并审核 Lesson JSON，再重新 prepare。

## 7. 制作工作区

每个 Lesson 的 AI 配音工作区为：

```text
content-work/<lesson-id>/dub/
├── manifest.json
├── segments/
│   ├── s001.wav
│   ├── s001.receipt.json
│   └── ...
├── assembled/
│   ├── <lesson-id>-zh-ai.wav
│   └── <lesson-id>-zh-ai.mp3
├── reports/
│   ├── validation.json
│   └── generation.log
└── tmp/
```

`content-work/` 已被 Git 忽略。正式成品只复制到：

```text
audio/lessons/new-concept-english-4/<lesson-id>-zh-ai.mp3
```

## 8. Manifest 和摘要

### 8.1 Manifest

manifest 至少包含：

```json
{
  "schemaVersion": 1,
  "lessonId": "nce4-040-waves",
  "transcriptRevision": 1,
  "sourceDigest": "<sha256>",
  "voiceProfile": "neutral-female-v1",
  "model": "openbmb/VoxCPM2",
  "generation": {
    "cfgValue": 2,
    "inferenceTimesteps": 10,
    "baseSeed": 20260724,
    "sampleRate": 48000,
    "segmentGapMs": 180
  },
  "segments": [
    {
      "id": "s001",
      "text": "用于中文朗读的文本。",
      "seed": 20260725,
      "output": "segments/s001.wav"
    }
  ]
}
```

### 8.2 Source digest

摘要覆盖：

- Lesson ID；
- transcript revision；
- Segment ID 和顺序；
- 英文原文；
- `translation.text`；
- `translation.speechText`；
- voice profile；
- 模型 ID；
- cfg、timesteps、seed 和片段间隔；
- worker 生产格式版本。

摘要不匹配时，不得把旧 WAV 混入新成品。

### 8.3 断点续做

每个 Segment 成功后原子写入 WAV 和 receipt。恢复时只有同时满足以下条件才跳过：

- receipt 的 source digest 与当前 manifest 一致；
- Segment ID、朗读文本和 seed 一致；
- WAV 存在；
- WAV 是 48kHz、单声道、非空；
- WAV SHA-256 与 receipt 一致；
- 时长位于允许范围。

否则仅重新生成该 Segment。

## 9. 音频组装

### 9.1 Segment WAV

- 格式：PCM WAV；
- 采样率：48kHz；
- 声道：单声道；
- 禁止归一化到削波；
- 不做会改变语义时间边界的 ASR 对齐；
- 可进行保守的首尾静音裁剪，但必须保留自然起音和收音。

### 9.2 拼接和 Cue

按 Segment 顺序拼接，每段之间加入固定 180ms 静音。Cue 使用拼接前后的精确采样索引计算：

```text
cue.start = 当前累计采样数 / 48000
cue.end = (当前累计采样数 + Segment 采样数) / 48000
```

静音间隔不属于前一个 Cue，也不属于后一个 Cue。

### 9.3 MP3

使用 ffmpeg `libmp3lame` 编码为单声道 MP3。编码完成后必须用 ffprobe 验证：

- 文件可读取；
- 采样率为 48kHz；
- 单声道；
- 时长与组装 WAV 的差异在容许范围内；
- 文件非空；
- SHA-256 和字节数已记录。

## 10. Lesson JSON 扩展

### 10.1 `zh-ai` Rendition

生成完成后增加：

```json
{
  "id": "zh-ai",
  "language": "zh-Hans",
  "role": "dub",
  "audio": {
    "key": "lessons/new-concept-english-4/nce4-040-waves-zh-ai.mp3",
    "mimeType": "audio/mpeg",
    "byteLength": 1234567,
    "sha256": "<sha256>"
  },
  "duration": 123.45,
  "generation": {
    "synthetic": true,
    "engine": "VoxCPM2",
    "model": "openbmb/VoxCPM2",
    "voiceProfile": "neutral-female-v1",
    "basedOnTranscriptRevision": 1,
    "sourceDigest": "<sha256>",
    "generatedAt": "2026-07-24T00:00:00.000Z",
    "cfgValue": 2,
    "inferenceTimesteps": 10,
    "baseSeed": 20260724
  },
  "cues": []
}
```

### 10.2 Schema 约束

- `generation` 对 `zh-ai` 必须存在；
- `generation.synthetic` 必须为 `true`；
- `basedOnTranscriptRevision` 必须等于当前 `lesson.transcriptRevision`；
- `sourceDigest` 必须是 SHA-256；
- 英文 `en` Rendition 不允许携带 AI generation；
- `zh-ai` 必须为每个有译文的 Segment 提供且只提供一个 Cue；
- Cue 顺序必须与 `segments` 顺序一致；
- Cue 不得重叠，且不能超出音频时长。

## 11. PlaybackPattern

### 11.1 数据模型

PlaybackPattern 是运行时偏好，不写进每个 Lesson JSON：

```ts
interface PlaybackPatternStep {
  renditionId: "en" | "zh-ai";
  repeats: number;
  playbackRate: number;
}

interface PlaybackPattern {
  id: string;
  title: string;
  steps: PlaybackPatternStep[];
}
```

预设：

```text
en-only       = EN × 1
en-1-zh-1     = EN × 1 → ZH × 1
en-3-zh-1     = EN × 3 → ZH × 1
en-n-zh-1     = EN × 用户当前有限循环次数 → ZH × 1
```

### 11.2 与现有逐句循环的关系

现有循环次数继续表示英文 Step 的 repeats。用户开启中文 AI 配音后，有限循环会在英文 Step 完成后增加
`ZH × 1`。无限循环保持 `EN × ∞`，不插入永远无法到达的中文 Step，并在界面说明。

关闭逐句循环时：

- 仅英文模式按现有连续播放；
- 中英模式按 `EN × 1 → ZH × 1` 后进入下一 Segment。

这样仍由 PlaybackPattern 描述行为，而不是在结束检测中写死“第三遍后播放中文”。

### 11.3 会话状态

```ts
interface PatternSession {
  segmentId: string;
  stepIndex: number;
  repeatIndex: number;
  renditionId: "en" | "zh-ai";
}
```

切句、seek、Lesson 切换、Pattern 切换和循环次数变化都重建会话。

## 12. 播放器实现

### 12.1 AudioElement

播放器保持两个长期存在的 `HTMLAudioElement`：

- 英文原声 element；
- 中文 AI 配音 element。

任意时刻只允许一个发声。切换 Rendition 时：

1. 通过统一切换锁阻止重复结束事件；
2. 暂停当前 element；
3. 定位目标 element 到相同 Segment 的 Cue 起点；
4. 应用该 Step 的 playback rate；
5. 由用户已经授权的播放会话继续播放。

页面导航不得卸载这两个 element。

### 12.2 结束检测

英文和中文 element 的前台动画帧、后台 `timeupdate`/`ended` 检测统一调用：

```text
completePatternCue(renditionId, segmentId)
```

该函数在同一个锁内完成：

- 当前 Step repeat 计数；
- Step 推进；
- Rendition 切换；
- Segment 推进；
- 最后一段暂停。

每个 Cue 结尾只计数一次。

### 12.3 iOS 降级

iPhone Safari 和主屏幕 Web App 可能限制锁屏状态下跨两个媒体元素自动播放。实施时必须真实设备验证。

若后台跨 element 失败：

- 前台仍支持动态 PlaybackPattern；
- 后台进入中英模式前明确提示；
- 后续 Feature 可为固定 `EN × 3 → ZH × 1` 预生成组合音频；
- 不允许在未验证时宣称锁屏中英交叉可用。

## 13. 下载和离线

用户下载有 `zh-ai` 的 Lesson 时，下载记录必须能够保存两个 Rendition，而不能用第二个 Blob 覆盖英文原声。

在不改变顶层课程隔离原则的前提下：

- IndexedDB 继续使用 `audio:<lesson-id>`；
- 该记录升级为按 Rendition ID 保存的音频集合；
- OPFS 在 Lesson 目录或文件名中区分 `en` 和 `zh-ai`；
- 旧的单 Blob 英文下载继续兼容；
- 删除下载会删除该 Lesson 的全部 Rendition 音频，但保留 `progress:<id>` 和 `last-played`。

冷启动仍只恢复 Lesson、进度和英文倍速，保持暂停；不恢复正在进行的 PatternSession。

## 14. 用户界面

有 `zh-ai` 时显示音频模式入口：

```text
仅英文
英文后播放 AI 中文
```

开启后，循环菜单继续选择英文次数，并显示组合结果，例如：

```text
英文 3 遍 · AI 中文 1 遍
```

播放器和 Lesson 信息显示：

```text
AI 生成中文配音
非教材官方中文版本
```

没有 `zh-ai` 时不显示可用开关，也不能让用户误以为会在线生成。

## 15. 命令设计

计划增加：

```text
pnpm dub:prepare -- <lesson-json...>
pnpm dub:generate -- <lesson-json...>
pnpm dub:assemble -- <lesson-json...>
pnpm dub:validate -- <lesson-json...>
```

批量范围可以显式传入目录和 Lesson 编号。默认命令不得扫描并生成所有课程。

推荐一键入口：

```text
pnpm dub:voxcpm2 -- --collection new-concept-english-4 --from 40 --to 48
```

一键入口内部仍依次执行 prepare、generate、assemble、validate，任何阶段失败立即停止并保留可恢复中间件。

## 16. 校验

### 16.1 自动校验

- 9 个目标 Lesson 全部存在；
- 288 个 Segment 全部有中文朗读文本；
- 288 个 Segment WAV 全部存在且 receipt 匹配；
- 每课 `zh-ai` MP3 存在；
- 每课 `zh-ai` Cue 数等于 Segment 数；
- source digest 与当前内容一致；
- Lesson JSON 通过 Zod；
- MP3 字节数和 SHA-256 与 JSON 一致；
- Collection summary 和 catalog 重新生成；
- `pnpm validate:content -- --require-audio` 通过；
- `pnpm build` 通过；
- `git diff --check` 通过；
- Git 不跟踪 WAV、模型或 MP3。

### 16.2 内容抽检

每课至少抽检：

- 第一段；
- 中间一段；
- 最后一段；
- 包含数字、缩写或专有名词的片段；
- 是否漏字、重复、幻觉或错误停顿；
- 课内和跨课音色是否一致；
- Cue 点击和句尾切换是否准确。

### 16.3 浏览器验证

- 桌面浏览器：EN × 1 → ZH × 1；
- 桌面浏览器：EN × 3 → ZH × 1；
- 手动切句和拖动后从新 Segment 重新开始；
- 最后一段完成后暂停；
- 快速切换模式不会双重计数或双声播放；
- 下载后离线播放两个 Rendition；
- 页面返回听力库后迷你播放器继续控制；
- iPhone Safari 前台；
- iPhone Safari 锁屏；
- iOS 主屏幕 Web App 前台；
- iOS 主屏幕 Web App 锁屏。

## 17. 实施顺序

1. 完成并验证 WSL2 VoxCPM2 部署；
2. 扩展 Lesson Schema 的 `generation`；
3. 实现 manifest prepare 和摘要；
4. 实现 Python 生成 worker 和 voice anchor；
5. 实现 assemble、MP3 编码、receipt 和 validate；
6. 只制作 Lesson 40 作为试产样本并人工试听；
7. 样本通过后批量制作 Lesson 41–48；
8. 更新 9 个 Lesson JSON 和 Collection summary；
9. 扩展运行时加载多个 Rendition；
10. 实现 PlaybackPattern 状态机；
11. 升级下载和离线存储；
12. 完成桌面和真实 iPhone 验证。

## 18. 风险与控制

### 18.1 音色漂移

控制：固定 AI voice anchor、voice profile、模型版本和生成参数；跨 Lesson 抽检。

### 18.2 个别片段幻觉或漏读

控制：逐 Segment receipt、时长异常报告、文本抽检和可单段重生成，不接受静默缺失。

### 18.3 译文适合阅读但不适合朗读

控制：使用可审核的 `speechText`，不在 Python worker 中隐藏改写。

### 18.4 输入变化后误用旧音频

控制：source digest 覆盖原文、译文、speechText、revision、voice 和生成配置。

### 18.5 MP3 时间轴偏移

控制：Cue 从 PCM 采样数生成；用 ffprobe 校验成品时长；浏览器点击 Cue 抽检。

### 18.6 iOS 后台跨音频失败

控制：真实设备验证；必要时明确限制为前台，后续再设计预生成组合 MP3。

### 18.7 授权

当前目标可用于本地制作和技术验证。公开部署前仍需确认翻译、改编和配音再发布权；
`rights.status` 为 `unverified` 时不得把本 Feature 自动等同于允许公开上线。

## 19. 验收标准

- [ ] WSL2 VoxCPM2 环境可从 Windows 一条命令调用；
- [ ] RTX 5090 CUDA 推理验证通过；
- [ ] 本地部署文档完整且以实测版本为准；
- [ ] 生产工具支持 prepare、generate、assemble、validate 和断点续做；
- [ ] voice anchor 和所有生成参数有 receipt；
- [ ] 第 40–48 课共 288 个 Segment 均生成中文 WAV；
- [ ] 9 个 `zh-ai` MP3 均通过格式、时长、SHA 和完整性校验；
- [ ] 9 个 Lesson JSON 均包含有效 `zh-ai` Rendition；
- [ ] 可播放“英文 1 遍、中文 1 遍”；
- [ ] 可播放“英文 3 遍、中文 1 遍”；
- [ ] 可使用 `1–10` 次英文循环组成自定义中英模式；
- [ ] 前后台结束检测共用处理路径和切换锁；
- [ ] 手动切句、seek 和模式变化正确重置会话；
- [ ] 双 Rendition 下载、离线和旧英文下载兼容；
- [ ] 桌面浏览器验证通过；
- [ ] iPhone Safari 和主屏幕 Web App 的实际能力已验证并记录；
- [ ] `pnpm build` 与 `git diff --check` 通过；
- [ ] 未执行生产部署，模型、WAV 和 MP3 未进入 Git。
