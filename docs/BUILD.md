# HeyNote 构建与发布指南

本文面向需要维护、调试或打包 HeyNote 的开发者。普通用户建议直接从 GitHub Releases 下载稳定版 `extension.zip`。

> 根据项目 [Custom License](../LICENSE)，源码可用于查看、学习、研究和非商业性本地修改。未经书面许可，不得公开发布或分发修改版源码、衍生代码或构建产物。

## 环境要求

- Node.js `20.19+` 或 `22.12+`
- npm
- Chrome 102+ 或新版 Microsoft Edge

## 安装依赖

```bash
npm ci
```

只有在需要调整依赖版本时才使用 `npm install`，并同步提交 `package-lock.json`。

## 本地预览

```bash
npm run dev
```

访问 `http://127.0.0.1:4173/`。本地预览使用静态示例数据，适合检查瀑布流、详情页、评论、搜索结果卡片和主题外观，不会请求真实小黑盒接口。

## 检查与构建

```bash
npm run typecheck
npm run build
npm run verify:dist
```

- `typecheck`：运行 TypeScript 类型检查。
- `build`：先执行类型检查，再生成扩展产物。
- `verify:dist`：检查 `dist/manifest.json`、Manifest 引用脚本、版本号和关键文件是否连通。

正常生产产物：

```text
dist/
├── background.js
├── domain-claim.js
├── domain-entry.js
├── search-bridge.js
└── manifest.json
```

`dist/` 是生成目录，不应手动修改。

## 项目结构

```text
HeyNote/
├── .github/workflows/          GitHub CI 与 Release 自动化
├── docs/                       构建说明和维护记录
├── public/manifest.json        Chrome Manifest V3 清单
├── scripts/verify-dist.mjs     构建产物连通性检查
├── src/
│   ├── background.ts           后台入口、API 桥、搜索桥标签页和图片操作
│   ├── domain-claim.ts         浏览模式判定与原站回退
│   ├── domain-entry.tsx        Shadow DOM 生产挂载入口
│   ├── search-bridge.ts        原站搜索同步与 DOM 结果解析
│   ├── App.tsx                 信息流、搜索、分区、主题与交互状态
│   ├── components/             详情、播放器和通用 UI 组件
│   └── data/                   小黑盒接口映射与表情解析
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 在浏览器中调试扩展

1. 运行 `npm run build`。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`。
3. 开启开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 选择本项目的 `dist/` 目录。
6. 打开并刷新 `https://www.xiaoheihe.cn/app/bbs/home`。

修改源码后需要重新运行 `npm run build`，在扩展管理页重新加载扩展，再刷新小黑盒页面。

## 手工生成安装包

压缩包根目录必须直接包含 `manifest.json`，不能多套一层 `dist/`。

macOS / Linux:

```bash
(cd dist && zip -r ../extension.zip . -x '*.DS_Store')
```

Windows PowerShell:

```powershell
Compress-Archive -Path dist\* -DestinationPath extension.zip -Force
```

## 发布版本

正式发布前必须同步修改以下版本号：

- `package.json`
- `package-lock.json` 顶层版本和根包版本
- `public/manifest.json`

发布前检查：

```bash
npm ci
npm run build
npm run verify:dist
```

创建与版本号一致的标签，例如发布 `0.7.32`：

```bash
git tag v0.7.32
git push origin main
git push origin v0.7.32
```

推送 `v*` 标签后，Release workflow 会自动安装依赖、构建、验证、打包并发布 `extension.zip`。

## 常见问题

### Vite 提示 Node.js 版本不支持

升级到 Node.js `20.19+` 或 `22.12+`，然后重新运行 `npm ci`。

### 浏览器提示找不到 Manifest

确认加载的是 `dist/` 目录，或确认 `extension.zip` 解压后的根目录直接包含 `manifest.json`。

### 修改后页面没有变化

依次执行生产构建、扩展管理页“重新加载”、小黑盒页面刷新。只刷新网页不会重新载入已更新的扩展脚本。

### GitHub Actions 拒绝发布

检查 `v*` 标签、`package.json`、`package-lock.json` 和 `public/manifest.json` 的版本是否完全一致，并确认仓库 Actions 的 `GITHUB_TOKEN` 具有 `contents: write` 权限。
