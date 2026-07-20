# Feature 0002：英语学习网站部署

状态：已部署  
目标域名：`https://learn.iceriver.cc`  
目标服务器：现有阿里云服务器 `8.210.175.90`

---

## 1. 结论

英语学习网站继续使用 `mote` 当前的阿里云服务器和 Nginx，但使用完全独立的域名和目录：

```text
www.iceriver.cc
→ /var/www/iceriver.cc
→ 继续运行 mote，不做改动

learn.iceriver.cc
→ /var/www/learn.iceriver.cc
→ 部署英语学习 PWA
```

第一版构建产物只有约 1 MB，不需要复制 `mote` 的复杂增量部署脚本。采用最简单的流程：

```text
本地构建
→ 检查 dist
→ 上传 dist 中的全部文件
→ 打开线上地址验证
```

---

## 2. 为什么使用独立子域名

不把英语网站部署到 `www.iceriver.cc/learn/`，原因如下：

1. 不会影响现有 `mote` 首页。
2. 两个项目的部署脚本不会互相删除文件。
3. 英语网站的 Service Worker 可以直接使用根作用域 `/`。
4. Nginx 缓存规则可以独立配置。
5. OPFS、IndexedDB 和 Service Worker 都绑定网站 Origin；`learn.iceriver.cc` 可以作为长期稳定的独立 Origin。

域名上线后不应随意改为另一个域名。浏览器不会自动把 `learn.iceriver.cc` 中的本地课程迁移到新域名。

---

## 3. 当前状态

已确认：

- `iceriver.cc` 和 `www.iceriver.cc` 都指向 `8.210.175.90`。
- 线上服务器使用 `nginx/1.24.0 (Ubuntu)`。
- `https://www.iceriver.cc/` 当前正常返回 `mote` 首页。
- `learn.iceriver.cc` 当前还没有 DNS 记录。
- 英语网站已经可以通过 `pnpm build` 生成静态 PWA 到 `dist/`。

已于 2026-07-21 完成：

- `learn.iceriver.cc` DNS 解析。
- 独立服务器目录和 Nginx 站点。
- Let's Encrypt HTTPS 证书和自动续期。
- HTTP 自动跳转 HTTPS。
- 首次生产构建和上传。

---

## 4. DNS 配置

在当前域名的 DNS 控制台增加：

```text
记录类型：A
主机记录：learn
记录值：8.210.175.90
TTL：默认值即可
```

配置完成后验证：

```powershell
Resolve-DnsName learn.iceriver.cc
```

预期结果包含：

```text
8.210.175.90
```

---

## 5. 服务器目录

创建独立目录：

```bash
mkdir -p /var/www/learn.iceriver.cc
```

目录只保存 Vite 的 `dist` 内容：

```text
/var/www/learn.iceriver.cc/
├── index.html
├── manifest.webmanifest
├── registerSW.js
├── sw.js
├── workbox-*.js
├── icon.svg
├── assets/
└── samples/
    ├── no-brainer.mp3
    └── no-brainer.json
```

不要上传源码、`node_modules`、文档或 `.git`。

---

## 6. Nginx 配置

新增独立配置文件：

```text
/etc/nginx/sites-available/learn.iceriver.cc
```

首次申请 HTTPS 前使用：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name learn.iceriver.cc;

    root /var/www/learn.iceriver.cc;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用配置：

```bash
ln -s /etc/nginx/sites-available/learn.iceriver.cc \
      /etc/nginx/sites-enabled/learn.iceriver.cc

nginx -t
systemctl reload nginx
```

`nginx -t` 未通过时不得 reload。

---

## 7. HTTPS

PWA、Service Worker 和 OPFS 在 iPhone 上需要 HTTPS。DNS 生效且 HTTP 可以访问后，使用服务器现有的 Certbot 申请证书：

```bash
certbot --nginx -d learn.iceriver.cc
```

Certbot 应自动完成：

- TLS 证书配置。
- HTTP 跳转 HTTPS。
- 证书自动续期。

完成后验证：

```text
https://learn.iceriver.cc
```

不要为测试跳过证书错误。iPhone PWA 必须使用可信 HTTPS。

---

## 8. 正式 Nginx 缓存规则

HTTPS 配置完成后，在 Certbot 生成的 HTTPS `server` 中保留 SPA 回退，并增加：

```nginx
root /var/www/learn.iceriver.cc;
index index.html;

location / {
    try_files $uri $uri/ /index.html;
}

# 入口和 Service Worker 每次都检查更新
location = /index.html {
    add_header Cache-Control "no-cache";
}

location = /sw.js {
    add_header Cache-Control "no-cache";
}

location = /registerSW.js {
    add_header Cache-Control "no-cache";
}

location = /manifest.webmanifest {
    add_header Cache-Control "no-cache";
}

# Vite 生成的带 hash 文件可以长期缓存
location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}

# 示例音频不由 Service Worker 预缓存
location /samples/ {
    add_header Cache-Control "public, max-age=86400";
    try_files $uri =404;
}
```

Nginx 静态文件服务默认支持 MP3 Range 请求，不需要增加音频代理或后端服务。

---

## 9. 最简部署流程

### 9.1 本地构建

```powershell
pnpm build
```

如果普通 PowerShell 中找不到 `pnpm`，可以使用 Codex 内置版本：

```powershell
& 'C:\Users\river\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' build
```

构建成功后检查：

```powershell
Get-ChildItem -Recurse dist
```

### 9.2 首次上传

服务器目录为空时，使用 Windows 自带的 OpenSSH `scp`：

```powershell
scp -r dist/* root@8.210.175.90:/var/www/learn.iceriver.cc/
```

### 9.3 后续上传

MVP 阶段继续使用同一条命令。当前总文件很小，全量上传比维护增量部署代码更简单。

上传时遵循：

1. 先确保本地构建成功。
2. 上传新的 `assets`、Workbox 和示例文件。
3. 最后覆盖 `index.html` 和 `sw.js`。
4. MVP 阶段暂不自动删除旧的 hash 文件。

保留旧 hash 文件只会占用很少空间，却能避免用户更新过程中请求到已经删除的旧资源。

当构建产物明显变大，或者旧文件需要定期清理时，再从 `mote` 复制并简化 SFTP 增量部署脚本。

---

## 10. 建议的项目命令

后续实施部署时，可以增加：

```json
{
  "scripts": {
    "deploy": "pnpm build && powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1"
  }
}
```

`scripts/deploy.ps1` 只做三件事：

1. 确认 `dist/index.html` 存在。
2. 将 `dist` 上传到 `/var/www/learn.iceriver.cc`。
3. 请求 `https://learn.iceriver.cc/` 并确认返回 200。

第一版不要实现远程目录递归扫描、MD5 比较、自动删除和多环境配置。

---

## 11. 部署后验证

### 桌面浏览器

1. 打开 `https://learn.iceriver.cc`。
2. 点击“加载 1 分钟示例”。
3. 播放、跳转和循环字幕。
4. 刷新页面，确认课程和进度仍然存在。
5. 在开发者工具中切换为 Offline 后刷新。

### iPhone

1. 使用 Safari 打开 `https://learn.iceriver.cc`。
2. 加载示例并播放。
3. 分享 → 添加到主屏幕。
4. 从主屏幕重新打开。
5. 开启飞行模式。
6. 再次启动并播放已保存音频。
7. 检查关闭应用后播放位置是否恢复。

### HTTP 检查

```powershell
curl.exe -I https://learn.iceriver.cc/
curl.exe -I https://learn.iceriver.cc/sw.js
curl.exe -I https://learn.iceriver.cc/assets/实际文件名.js
```

预期：

- 所有请求返回 `200`。
- `/` 和 `/sw.js` 为 `no-cache`。
- `/assets/*` 为一年长期缓存并包含 `immutable`。
- HTTP 自动跳转 HTTPS。

---

## 12. 安全边界

- 英语站只能写入 `/var/www/learn.iceriver.cc`。
- 部署脚本不得访问或清理 `/var/www/iceriver.cc`。
- SSH 密钥继续保存在用户的 `.ssh` 目录，不写入项目。
- 不在 `package.json`、脚本或 Git 中保存服务器密码。
- 部署前必须成功执行本地构建。
- 第一版不开放服务器端上传接口，所有课程仍由用户在浏览器中导入。

---

## 13. 暂不实现

- GitHub Actions 自动部署。
- Docker。
- 独立 Node.js 后端。
- 数据库和用户系统。
- OSS 或 CDN。
- 测试、预发布和生产多环境。
- 自动回滚和多版本发布。
- 服务器保存用户课程或 MP3。

这些能力对当前个人使用的静态 PWA 没有必要。

---

## 14. 验收标准

1. `learn.iceriver.cc` 指向 `8.210.175.90`。
2. `www.iceriver.cc` 的 `mote` 首页不受影响。
3. 英语站只部署到 `/var/www/learn.iceriver.cc`。
4. HTTPS 证书有效，HTTP 自动跳转 HTTPS。
5. 桌面浏览器可以加载并播放示例课程。
6. iPhone Safari 可以加载和播放示例课程。
7. 可以添加到 iPhone 主屏幕。
8. 飞行模式下可以重新打开并播放已保存课程。
9. 新版本部署后，页面和 Service Worker 能正确更新。
10. 项目中没有服务器密码或私钥。
