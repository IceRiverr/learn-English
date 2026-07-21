# Feature 0003：课程列表与本地下载

## 1. 结论

建议实现。

这个需求能明显改善第二课的使用体验，改动范围也可控制在现有的
`App.tsx` 和 `db.ts` 内，不需要路由、状态管理库、后端或新的代码分层。

第二课约 90 MB。用户点击课程时先在线播放，只有点击右侧“下载”按钮时
才保存到浏览器，避免试听一次就占用大量本地空间和流量。

## 2. MVP 页面

首页把“加载 1 分钟示例”替换为固定课程列表：

```text
课程

No Brainer                         1 分钟    [下载]
Context engineering with Dex Horthy 92 分钟 [下载]
```

- 点击课程行：打开播放器。
- 点击“下载”：下载音频和字幕，但不进入播放器。
- 已下载的课程显示“已下载”。
- 再次打开网站时，先检查本地数据并恢复“已下载”状态。
- 在线课程使用服务器上的音频地址播放；已下载课程优先使用本地音频。
- 播放器保留一个“返回课程”按钮。
- 现有手动导入入口暂时保留在课程列表下方。

## 3. 固定课程目录

课程数量很少，直接在 `App.tsx` 中写一个数组，不增加配置文件或接口：

```ts
const lessons = [
  {
    id: "voa-no-brainer",
    title: "VOA English in a Minute: No Brainer",
    durationLabel: "1 分钟",
    audioUrl: "/samples/no-brainer.mp3",
    transcriptUrl: "/samples/no-brainer.json"
  },
  {
    id: "context-engineering-with-dex-horthy",
    title: "Context engineering with Dex Horthy",
    durationLabel: "92 分钟",
    sizeLabel: "90 MB",
    audioUrl: "/samples/context-engineering-with-dex-horthy.mp3",
    transcriptUrl: "/samples/context-engineering-with-dex-horthy.json"
  }
];
```

以后新增课程时，只增加一项，不做后台管理和动态课程接口。

## 4. 最小数据调整

继续使用现有的一个 IndexedDB object store，只把固定键改为带课程 ID 的键：

```text
course:<courseId>       课程信息和字幕
audio:<courseId>        IndexedDB 备用音频
progress:<courseId>     每课播放进度
```

支持 OPFS 的浏览器继续把音频存入 OPFS，文件名从 `current.mp3` 改为
`<courseId>.mp3`。不新建数据库表，也不升级数据库版本。

需要把 `db.ts` 的方法改为按课程 ID 操作：

```ts
saveCourse(course, audio)
loadCourse(courseId)
loadAudio(courseId)
loadProgress(courseId)
saveProgress(courseId, progress)
deleteCourse(courseId)
```

首页只检查固定目录里的两个 ID，不实现搜索、索引或课程仓库类。

## 5. 加载流程

点击课程时：

1. 检查该课程是否有完整的本地课程信息和音频。
2. 如果存在，读取本地音频并播放。
3. 如果不存在，只请求字幕 JSON，音频直接使用服务器 URL 在线播放。
4. 读取该课程自己的播放进度。

点击下载时：

1. 按钮显示“下载中…”，并阻止课程行的点击事件。
2. 下载音频和字幕。
3. 使用现有校验逻辑验证文件名、时长和时间轴。
4. 保存到 OPFS；不支持 OPFS 时保存到 IndexedDB。
5. 成功后按钮显示“已下载”。

MVP 不显示下载百分比，也不实现暂停和断点续传。失败时显示错误，按钮恢复为
“下载”。

## 6. 不实现

- React Router 或多页面路由。
- 服务端账号和跨设备同步。
- 动态课程管理后台。
- 自动下载所有课程。
- 下载队列、百分比和断点续传。
- 独立 repository/service/hooks 分层。
- Service Worker 预缓存 90 MB 音频。

## 7. 风险

- 第二课约 90 MB，浏览器可能因为剩余空间不足而拒绝保存；失败时应提示用户。
- 浏览器可能在存储压力下清理网站数据，因此“已下载”必须以实际能读到音频为准，
  不能只检查一个布尔标记。
- 将播客音频发布到公网前，需要由资源所有者确认拥有相应的传播或使用权限；
  本功能设计本身不解决内容授权问题。

## 8. 验收标准

- 首页展示两门课程，不再需要为第二课手动选择两个文件。
- 未下载课程可以联网点击播放。
- 点击“下载”后显示“已下载”，刷新页面后状态仍然正确。
- 断网后，已下载课程仍可播放，未下载课程给出明确提示。
- 两门课程分别保存和恢复播放进度。
- 删除当前课程的本地数据后，首页状态恢复为“下载”。

