# 英语听力训练

一个本地优先的英语精听 PWA，主要面向手机和网页的 Web App。

在线使用：[learn.iceriver.cc](https://learn.iceriver.cc)

## 功能

- 在线播放课程，下载后离线学习
- 中英双语字幕与逐句跳转
- `0.75×`～`1.5×` 倍速播放
- 每句循环 `1`～`10` 次或无限循环
- 自动保存每门课程的播放进度
- 返回听力库后继续播放，并在底部使用迷你播放器控制当前材料
- 再次访问时恢复上次材料和播放位置，等待用户继续收听

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

仓库不跟踪课程 MP3。本地使用固定课程时，请将对应音频放入课程配置指定的 `public/` 目录。当前界面只提供内置课程，
不支持用户自定义导入 MP3 或字幕 JSON。

## 生产部署

日常修改应用代码、样式、PWA 文件或课程 JSON 时，执行轻量部署：

```bash
pnpm deploy
```

该命令会重新构建并全量上传除 MP3 以外的生产文件。轻量构建会检查 `dist`，发现 MP3 时立即停止，避免重复传输课程音频。

新增或修改 `public/**/*.mp3` 后，单独执行音频部署：

```bash
pnpm deploy:audio
```

音频部署使用 SHA-256 比较本地与服务器清单，只上传新增或内容发生变化的 MP3，不删除服务器已有音频。新课程同时包含音频和 JSON 时，
先执行 `pnpm deploy:audio`，再执行 `pnpm deploy`。

两个部署命令都只允许写入 `/var/www/learn.iceriver.cc`，不得访问或清理 `/var/www/iceriver.cc`。生产部署需要可用的 Windows
OpenSSH 和服务器 SSH 密钥。

## 课程文件格式

内置课程由 MP3 和 JSON 组成。`audioFilename` 必须与 MP3 文件名一致，时间单位为秒。

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
