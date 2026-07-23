# AGENTS.md

## 项目

本仓库是一个本地优先的英语听力训练 PWA，目标平台为 iPhone Safari、iOS 主屏幕 Web App 和现代桌面浏览器。

当前技术栈为 React、TypeScript、Vite、Zod、IndexedDB、OPFS 和 `vite-plugin-pwa`。

## 规则来源

需求发生冲突时，按以下优先级处理：

1. 当前代码和经过验证的实际行为
2. `docs/features/` 中编号较新的相关设计
3. 编号较旧的 Feature 设计
4. `docs/misc/英语听力训练 PWA 设计文档.md`

特别说明：

- Feature 0007 只在播放器界面和循环次数选项方面覆盖 Feature 0006；循环行为仍以 Feature 0006 为准。
- Feature 0005 是历史设计，不是当前使用的远程播客制作流程。
- `docs/misc` 中的总体设计是早期产品构想，其中的 Preact、路由、Repository 分层、词表、难句和备份等方案不是当前要求。

除非用户明确要求，否则不要实现路线图中的功能。

## 实现原则

- 保持应用简单、直接。主要文件是 `src/App.tsx`、`src/db.ts` 和 `src/app.css`。
- 没有实际需要时，不引入路由、全局状态管理、UI 框架、依赖注入或 Repository/Service 分层。
- 浏览器 API 或现有技术栈能够满足需求时，不增加新依赖。
- 使用 TypeScript strict 模式，避免使用 `any`，所有外部 JSON 必须通过 Zod 校验。
- 只有逻辑需要独立测试、存在重复或已经难以维护时才拆分文件。
- 保留工作区中与当前任务无关的改动，不得为了方便而撤销或重写用户的修改。

## 播放器约束

- 使用 `HTMLAudioElement` 播放音频。禁止使用 `decodeAudioData()` 解码完整 MP3，也不要将完整音频载入 `AudioBuffer`。
- 更换 Object URL 时及时释放，并清理动画帧和计时器。
- 使用二分查找定位当前字幕，避免每次时间更新都重新渲染完整字幕列表。
- 前台和后台的循环结束检测必须共用同一处理路径和切换锁，确保每次句尾只计数一次。
- 有限循环完成后进入下一句；最后一句完成后暂停。
- 手动切句或跳转后，重置循环目标和当前次数。
- 持久化循环次数和翻译显示偏好，但不持久化正在进行的循环会话。
- 页面导航不得卸载或重建当前播放会话的 `HTMLAudioElement`；返回听力库后通过底部迷你播放器继续控制当前材料。
- 使用 `last-played` 保存最后播放材料的 ID；冷启动只恢复材料、进度和倍速，必须保持暂停并等待用户主动播放。
- 无真实逐词时间戳时，按句内时间和字母权重估算当前词；只完整高亮单词。动画帧只能更新当前句的词状态，不得导致完整字幕列表逐帧重渲染。

## 存储与离线

- 课程信息、字幕和进度保存在现有的 IndexedDB `app-data` store 中。
- 音频优先保存到 OPFS，不支持时回退为 IndexedDB Blob。
- 存储键必须按课程 ID 隔离：`course:<id>`、`audio:<id>` 和 `progress:<id>`。
- 对仍在内置目录中的材料，“删除下载”只删除课程缓存和音频，必须保留 `progress:<id>` 与 `last-played`。
- 保持对已下载旧课程和无翻译课程的兼容。
- Service Worker 预缓存应用外壳、`content/catalog.json` 和 `content/collections/*.json`，不预缓存完整 Lesson JSON 或课程 MP3。
- 新正式音频位于 `audio/**/*.mp3` 并被 Git 忽略；迁移期间旧 `public/**/*.mp3` 也继续忽略，不得添加或提交这些文件。

## 界面规则

- 移动端优先，并验证窄屏布局。可交互控件应尽量不小于 44 CSS 像素。
- 适配 `env(safe-area-inset-bottom)`，确保最后几条字幕不会被固定播放器遮挡。
- 英文字幕始终可用；中文译文使用 `zh-Hans`，属于可选内容，缺失时不能影响播放。
- 保持键盘可操作性，并为菜单和开关保留正确的 ARIA 状态。

## 课程内容

- 当前产品只支持内置课程，不提供用户自定义 MP3 或字幕 JSON 导入入口；除非用户明确提出新 Feature，否则不要恢复导入界面。
- 音频链接可用不代表拥有再发布权。添加公开课程前必须检查来源、署名和授权状态。
- 大型音频和本地制作中间文件不得进入 Git。
- 制作期材料按 Lesson 位于被忽略的 `content-work/<lesson-id>/`，跨 Lesson 的迁移和报告位于 `content-work/_shared/`；正式结构化内容从仓库根 `content/` 开始，不使用 `public/content`。
- 分块翻译应使用 `scripts/translation-workflow.mjs`，不要直接重写大型课程 JSON。

## 部署

- 除非用户明确要求生产部署，否则不得运行 `pnpm deploy`、`pnpm deploy:light` 或 `pnpm deploy:audio`。
- 日常代码、样式、PWA 和课程 JSON 使用 `pnpm deploy`；它等同于 `pnpm deploy:light`，全量上传非 MP3 文件。
- 新增或修改课程 MP3 时使用 `pnpm deploy:audio`。该命令根据 SHA-256 清单只上传变化的 MP3，不删除远端音频。
- 新课程同时包含 MP3 和 JSON 时，先部署音频，再执行轻量部署，避免 JSON 先引用尚未上线的音频。
- 两类部署都只能写入 `/var/www/learn.iceriver.cc`，不得访问、修改或清理 `/var/www/iceriver.cc`。
- 不得把日常部署改回完整上传含 MP3 的 `dist`；不得把服务器密码、SSH 私钥或音频清单中的敏感信息写入 Git。

## 验证

每次修改代码后运行：

```bash
pnpm build
git diff --check
```

项目目前没有自动测试命令。修改播放器、存储、PWA 或响应式界面时，应进行与风险相称的浏览器验证。高风险的音频和离线改动必须在真实 iPhone 的 Safari 和主屏幕 Web App 中验证。
