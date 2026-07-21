# 英语听力训练

一个本地优先的英语精听 PWA，主要面向手机和网页的 Web App。

在线使用：[learn.iceriver.cc](https://learn.iceriver.cc)

## 功能

- 在线播放课程，下载后离线学习
- 导入自己的 MP3 和字幕 JSON
- 中英双语字幕与逐句跳转
- `0.75×`～`1.5×` 倍速播放
- 每句循环 `1`～`10` 次或无限循环
- 自动保存每门课程的播放进度

## 本地开发

需要 Node.js 和 pnpm。

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

仓库不跟踪课程 MP3。本地使用固定课程时，请将对应音频放入 `public/samples/`；也可以直接在页面中导入自己的课程。

## 课程格式

导入时需要同时选择 MP3 和 JSON。`audioFilename` 必须与 MP3 文件名一致，时间单位为秒。

```json
{
  "version": 1,
  "course": {
    "id": "my-course",
    "title": "My Course",
    "audioFilename": "my-course.mp3",
    "duration": 60.5,
    "language": "en"
  },
  "segments": [
    {
      "id": "s001",
      "start": 0.2,
      "end": 4.8,
      "text": "This is the first sentence.",
      "translations": {
        "zh-Hans": "这是第一句话。"
      }
    }
  ]
}
```

字幕必须按时间排序、互不重叠，并且不能超出音频时长。中文译文是可选字段。

## 本地数据

课程、字幕和播放进度保存在 IndexedDB，音频优先保存在 OPFS。Service Worker 只缓存应用本身，不预缓存课程音频。

清除浏览器网站数据可能删除已下载课程和学习进度。

## 技术栈

React、TypeScript、Vite、Zod、IndexedDB、OPFS 和 vite-plugin-pwa。

设计文档位于 [`docs/features`](docs/features)。课程来源和署名见 [`public/samples/README.md`](public/samples/README.md)。
