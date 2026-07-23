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
- 按句内时间和单词字母数量估算播放位置，完整高亮当前英文单词

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

仓库不跟踪 Lesson MP3。本地使用内置内容时，请将音频放入 `audio/lessons/`，结构化内容位于 `content/`。制作期材料按 Lesson 放在被忽略的
`content-work/<lesson-id>/`，跨 Lesson 的迁移与报告放在 `content-work/_shared/`。当前界面只提供内置内容，
不支持用户自定义导入 MP3 或字幕 JSON。

## 生产部署

日常修改应用代码、样式、PWA 文件或课程 JSON 时，执行轻量部署：

```bash
pnpm deploy
```

该命令会重新构建并全量上传除 MP3 以外的生产文件。轻量构建会检查 `dist`，发现 MP3 时立即停止，避免重复传输课程音频。

新增或修改 `audio/**/*.mp3` 后，单独执行音频部署：

```bash
pnpm deploy:audio
```

音频部署使用 SHA-256 比较本地与服务器清单，只上传新增或内容发生变化的 MP3，不删除服务器已有音频。新课程同时包含音频和 JSON 时，
先执行 `pnpm deploy:audio`，再执行 `pnpm deploy`。

两个部署命令都只允许写入 `/var/www/learn.iceriver.cc`，不得访问或清理 `/var/www/iceriver.cc`。生产部署需要可用的 Windows
OpenSSH 和服务器 SSH 密钥。

## Lesson 内容格式

每个 Lesson 使用一个 `content/lessons/<content-group>/<lesson-id>.json`，其中包含元数据、来源与 rights、说话人、英文 Segment、可选简中译文，
以及音频 Rendition 和 Cue。音频独立位于
`audio/lessons/<content-group>/<lesson-id>-en.mp3`。完整约束见
[`Feature 0015`](docs/features/0015-lesson-content-model-migration/design.md)。

## 本地数据

课程、字幕和播放进度保存在 IndexedDB，音频优先保存在 OPFS。Service Worker 预缓存应用外壳、`catalog.json`
和 Collection 索引，但不预缓存完整 Lesson JSON 或课程音频。

清除浏览器网站数据可能删除已下载课程和学习进度。

## 技术栈

React、TypeScript、Vite、Zod、IndexedDB、OPFS 和 vite-plugin-pwa。

设计文档位于 [`docs/features`](docs/features)。每个 Lesson 的来源和 rights 信息保存在对应的
`content/lessons/**/*.json` 中。Lesson 的物理分组只用于维护，Collection 归属仍由 `content/collections/*.json`
中的 `lessons` 摘要列表决定。
