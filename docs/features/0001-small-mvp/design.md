# Feature 0001：最小可用听力播放器

状态：设计中  
版本：0.2  
目标平台：桌面浏览器、iPhone Safari、iOS 主屏幕 Web App

---

## 1. 目标

第一个 MVP 只验证一条完整链路：

```text
选择一个 MP3 和字幕 JSON
→ 在浏览器中播放
→ 根据播放时间显示当前句
→ 点击、切换和循环句子
→ 刷新后恢复课程和播放位置
→ 断网后仍可打开和播放
```

这个版本是技术原型，不是完整产品。优先写容易理解、容易调试的直接代码，不为尚未出现的需求设计分层和扩展点。

---

## 2. 实现原则

1. 能在一个文件清楚实现的功能，就留在一个文件中。
2. 不使用 Controller、Repository、Service、Provider 等抽象层。
3. 不为 OPFS 和 IndexedDB 设计统一存储接口。
4. 不引入全局状态管理、路由、依赖注入或 UI 框架。
5. 只有代码明显过长、重复，或者需要独立单元测试时才拆文件。
6. 先在真实 iPhone 上证明方案可用，再考虑正式架构。
7. MVP 可以重构，但不能因为未来需求增加当前复杂度。

---

## 3. 功能范围

### 3.1 必须实现

- 选择一个 MP3 文件。
- 选择一个字幕 JSON 文件。
- 校验字幕 JSON 的基本格式和时间戳。
- 保存一门课程到浏览器本地。
- 刷新后自动恢复这门课程。
- 播放和暂停。
- 拖动播放进度。
- 前进和后退 5 秒。
- 上一句和下一句。
- 点击字幕跳转到该句。
- 显示并高亮当前句。
- 循环当前句。
- 播放速度：`0.75×`、`0.9×`、`1.0×`、`1.25×`、`1.5×`。
- 保存和恢复播放位置。
- 离线打开应用并播放已保存的音频。
- 删除当前课程，以便重新测试导入。
- 显示简单、可理解的错误信息。

### 3.2 不实现

- 多课程管理。
- 词表、单词高亮和 Token 化。
- 难句收藏和复习。
- 章节。
- ZIP 课程包。
- 数据导入导出和完整备份。
- 用户账号、云同步和后端服务。
- 在线课程下载。
- TTS、ASR 和 AI 功能。
- 后台下载、录音和发音评分。
- 虚拟字幕列表。
- 学习统计。

本版本本地最多保存一门课程。导入另一门课程前必须先删除当前课程。

---

## 4. 技术选择

```text
React
TypeScript
Vite
idb
zod
vite-plugin-pwa
```

说明：

- React 只负责界面和页面状态。
- `idb` 简化 IndexedDB 调用。
- Zod 只负责校验用户导入的 JSON。
- `vite-plugin-pwa` 只缓存应用本身，不缓存 MP3。
- 不使用 React Router，因为只有一个页面。
- 不使用 Redux、Context、Signals 或其他状态管理工具。
- 不使用组件库，界面使用普通 CSS。

---

## 5. 最简代码结构

初始实现只创建以下文件：

```text
src/
├── main.tsx
├── App.tsx
├── db.ts
└── app.css
```

### `main.tsx`

只创建 React 根节点并渲染 `App`。

### `App.tsx`

直接包含：

- 数据类型。
- Zod Schema。
- 导入界面。
- 播放器界面。
- `<audio>` 元素及其事件。
- 当前句查找函数。
- 播放、跳转、调速和循环逻辑。
- Object URL 创建和释放。
- 页面状态和错误提示。

这是 MVP 的主要文件。不要为了让文件看起来短而提前拆成十几个文件。

### `db.ts`

只包含浏览器持久化所需的几个函数：

```ts
saveCourse(course): Promise<void>
loadCourse(): Promise<SavedCourse | undefined>
saveProgress(progress): Promise<void>
loadProgress(): Promise<SavedProgress | undefined>
deleteCourse(): Promise<void>
```

这里可以同时包含 IndexedDB 和 OPFS 的直接调用，不创建类、接口或 repository。

### `app.css`

只包含移动端布局、按钮尺寸、底部播放控制区和当前字幕样式。

只有出现以下情况之一时才允许新增源码文件：

- 一个纯函数需要独立测试。
- 某段代码在两个地方重复使用。
- `App.tsx` 已经难以定位和修改具体功能。
- 浏览器 API 的清理逻辑容易遗漏，需要单独封装。

---

## 6. 页面状态

整个应用只有两个状态：

```text
没有课程 → 显示导入界面
已有课程 → 显示播放器界面
```

不使用路由。

### 6.1 导入界面

```text
┌──────────────────────────┐
│ 英语听力训练             │
│                          │
│ [选择 MP3]               │
│ [选择字幕 JSON]          │
│ [导入]                   │
│                          │
│ 错误或导入状态           │
└──────────────────────────┘
```

用户选择文件时不立即写入存储。点击“导入”并通过校验后才保存。

### 6.2 播放器界面

```text
┌──────────────────────────┐
│ 课程标题                 │
│ 00:42 / 05:30            │
│ ─────────●────────────   │
│                          │
│ 当前字幕                 │
│                          │
│ 完整字幕列表             │
│ 当前句高亮               │
│                          │
│ [−5s] [上一句] [播放]    │
│ [+5s] [下一句] [循环]    │
│ [速度]                   │
└──────────────────────────┘
```

移动端的主要播放按钮固定在底部，点击区域不小于 `44 × 44` CSS 像素。

---

## 7. 最小数据结构

```ts
interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
}

interface Course {
  id: string;
  title: string;
  audioFilename: string;
  duration: number;
  segments: Segment[];
}

interface SavedProgress {
  currentTime: number;
  playbackRate: number;
}
```

不要加入作者、来源、主题、难度、章节和时间统计等当前界面没有使用的字段。

### 7.1 字幕 JSON

```json
{
  "version": 1,
  "course": {
    "id": "test-course",
    "title": "Test Course",
    "audioFilename": "test.mp3",
    "duration": 305.2
  },
  "segments": [
    {
      "id": "s001",
      "start": 0.2,
      "end": 4.8,
      "text": "This is the first sentence."
    }
  ]
}
```

### 7.2 基本校验

- `version` 必须为 `1`。
- 课程 ID、标题和音频文件名不能为空。
- `duration > 0`。
- 至少有一条字幕。
- segment ID 不重复。
- `start >= 0`。
- `end > start`。
- segments 按开始时间升序排列。
- 字幕不能互相重叠。
- 最后一条字幕不能明显超出实际音频时长。
- JSON 中的文件名必须与所选 MP3 文件名一致。

错误信息指出具体 segment，例如：

```text
字幕 s012 的结束时间必须大于开始时间。
```

---

## 8. 本地存储

### 8.1 简单策略

课程元数据、字幕和播放进度存入 IndexedDB。

MP3 优先存入 OPFS：

```text
audio/current.mp3
```

如果 OPFS 不可用或写入失败，则把 MP3 Blob 直接存入 IndexedDB。

这段判断直接写在 `db.ts` 中：

```ts
if (supportsOpfs()) {
  // 保存到 OPFS
} else {
  // 保存到 IndexedDB
}
```

不创建 `AudioStorage`、`OpfsAudioStorage`、`IndexedDbAudioStorage` 等接口和类。等将来真的出现多种调用方或更复杂的存储策略时再重构。

### 8.2 IndexedDB

为了减少表和关联关系，0001 只使用一个 store：

```text
app-data
```

固定 key：

```text
course
progress
audio-blob
```

`course` 直接包含所有字幕。一个课程、几十到一百条字幕没有必要拆成不同 store。

### 8.3 音频播放

从 OPFS 或 IndexedDB 取得 `File`/`Blob` 后：

```ts
const url = URL.createObjectURL(audioBlob);
audio.src = url;
```

重新加载音频或卸载页面时调用：

```ts
URL.revokeObjectURL(url);
```

不得使用 `decodeAudioData()`，也不要把完整 MP3 转成 `ArrayBuffer`。

### 8.4 导入失败清理

保存过程中出现错误时，执行一次 `deleteCourse()`，清除本次导入可能写入的课程、进度和音频。

MVP 不实现通用事务框架或复杂回滚系统。

---

## 9. 播放与当前句

### 9.1 React 中的状态

`App.tsx` 使用少量 `useState`：

- 当前课程。
- 是否播放。
- 当前句索引。
- 是否循环。
- 播放速度。
- 用于显示的当前时间。
- 导入状态和错误信息。

使用 `useRef` 保存：

- `<audio>` 元素。
- 当前 `requestAnimationFrame` ID。
- 当前 Object URL。
- 循环延迟计时器。

不创建独立播放器 class。

### 9.2 时间更新

普通进度显示使用 `<audio>` 的 `timeupdate` 事件即可。

当前句通过二分查找定位：

```ts
function findSegmentIndex(segments: Segment[], time: number): number
```

不要因为 `currentTime` 变化而重新渲染所有字幕。只有当前句索引发生变化时，才更新当前句状态。

### 9.3 单句循环

只有开启循环时才启动 `requestAnimationFrame`。

默认边界：

```text
句首提前 0.15 秒
句尾延长 0.20 秒
循环间隔 0.30 秒
```

循环关闭、课程删除或组件卸载时必须取消：

```ts
cancelAnimationFrame(frameId)
clearTimeout(loopTimer)
```

不为循环逻辑建立状态机。先用清楚的 `useEffect` 和清理函数完成。

### 9.4 进度保存

以下时机保存播放位置：

- 暂停。
- 跳转。
- 页面进入后台。
- 播放期间每 5 秒最多保存一次。

恢复课程后，在音频 `loadedmetadata` 之后设置 `currentTime`。

---

## 10. PWA 与离线

Service Worker 只缓存：

- HTML。
- JavaScript。
- CSS。
- Manifest 和图标。

MP3 不进入 Service Worker Cache Storage，只从 OPFS 或 IndexedDB 读取。

首次成功导入后可以尝试：

```ts
await navigator.storage.persist();
```

调用失败不能阻止使用，只需提醒：

> 清除 Safari 网站数据可能删除本地课程和播放进度。

---

## 11. 最小测试

### 11.1 自动测试

只优先测试容易出错的纯逻辑：

- 合法和非法字幕 JSON。
- 时间戳排序、重叠和越界。
- 当前句二分查找。
- 句首和句尾循环边界。

如果为了测试需要拆文件，可以新增：

```text
src/logic.ts
src/logic.test.ts
```

不要为了测试简单按钮而建立复杂的组件测试体系。

### 11.2 手工测试

1. 加载约 1 分钟的示例 MP3 和 5～10 条字幕。
2. 播放、暂停、拖动和调速。
3. 点击字幕跳转。
4. 使用上一句、下一句和循环。
5. 刷新后恢复课程和位置。
6. 断网后重新打开并播放。
7. 删除课程后重新导入。
8. 在 iPhone Safari 和主屏幕 Web App 中重复以上步骤。

长音频稳定性不属于 0001，在后续需要真实长课程时再验证。

---

## 12. 实施顺序

### 第一步：不保存数据的播放器

- 创建 Vite + React + TypeScript 项目。
- 选择 MP3 并创建临时 Object URL。
- 使用 `<audio>` 播放。
- 载入字幕 JSON。
- 实现当前句、点击跳转和循环。

完成后立即在 iPhone Safari 测试。

### 第二步：保存和恢复

- 添加 `db.ts`。
- 保存课程和进度到 IndexedDB。
- 保存 MP3 到 OPFS，失败时使用 IndexedDB。
- 实现刷新恢复和删除课程。

### 第三步：离线 PWA

- 添加 Manifest 和 Service Worker。
- 添加到 iPhone 主屏幕。
- 断网测试启动和播放。
- 再次验证约 1 分钟示例的离线播放。

三步全部通过后，0001 完成。不要在此过程中加入词表、难句或多课程。

---

## 13. 验收标准

1. 可以导入一组合法的 MP3 和字幕 JSON。
2. 导入错误时显示明确原因，并能重新尝试。
3. 可以播放、暂停、拖动、前后 5 秒和调速。
4. 当前句能随时间正确更新。
5. 点击字幕、上一句和下一句能跳转到正确位置。
6. 当前句可以连续循环至少 10 次。
7. 刷新或关闭应用后能恢复课程和播放位置。
8. 断网后能打开应用并播放已保存的音频。
9. 可以完整删除课程并重新导入。
10. iPhone Safari 和主屏幕 Web App 均通过 1 分钟示例测试。
11. 没有使用 `decodeAudioData()` 解码完整音频。
12. TypeScript 使用 strict 模式。
13. 源码保持少文件，没有为未来功能提前建立分层架构。

---

## 14. 何时重构

只有遇到实际问题时才重构。例如：

- 增加多课程后，才考虑拆分课程和字幕存储。
- 增加第二种页面后，才考虑路由。
- `App.tsx` 中出现多个独立且复杂的界面后，才拆 React 组件。
- 多个功能都要控制播放器后，才考虑独立播放器模块。
- 存储逻辑出现多个调用方和重复分支后，才考虑存储接口。
- 真实字幕达到数千条并出现卡顿后，才加入窗口化列表。

重构由已经发生的复杂度驱动，不由对未来的猜测驱动。
