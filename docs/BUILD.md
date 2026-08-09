# HeyNote 构建与发布指南

本文档面向需要检查源码、进行本地研究或维护正式版本的人员。普通用户请直接从 GitHub Releases 下载稳定版 `extension.zip`。

当前版本：`0.8.1`

> [!IMPORTANT]
> 根据本项目的 [Custom License](../LICENSE)，允许用户为查看、学习、研究和非商业性修改而在本地下载、编译及运行源码。未经书面许可，不得公开发布或分发修改后的源码、衍生代码或构建产物；提交和正式发版章节仅适用于 AzumWatson 或已取得书面授权的维护者。

## 环境要求

- Git
- Node.js `20.19+`，或 `22.12+`
- npm
- Chrome 102+ 或新版 Edge

## 安装依赖

仓库包含 `package-lock.json`，首次获取源码后建议使用：

```bash
npm ci
```

需要调整依赖版本时才使用 `npm install`，并同步更新锁文件。未经书面许可，不得公开发布或分发由此产生的修改版。

## 本地视觉样稿

```bash
npm run dev
```

访问 `http://127.0.0.1:4173/`。该页面使用静态示例数据，只用于检查图文、视频、文章和评论布局，不读取小黑盒账号，也不请求真实接口。

## 类型检查

```bash
npm run typecheck
```

## 生产构建

```bash
npm run build
```

`build` 会先执行 TypeScript 检查，再由 Vite 清空并重新生成 `dist/`。正常产物包括：

```text
dist/
├── background.js
├── domain-claim.js
├── domain-entry.js
└── manifest.json
```

`dist/` 是生成目录，不应直接修改。

## 项目结构

```text
HeyNote/
├── .github/workflows/release.yml    稳定版自动构建与发布
├── public/manifest.json             Chrome Manifest V3 清单
├── src/
│   ├── background.ts                后台入口、请求桥与图片操作
│   ├── domain-claim.ts              浏览模式判定与失败回退
│   ├── domain-entry.tsx             Shadow DOM 生产挂载入口
│   ├── App.tsx                      信息流、筛选、主题与交互状态
│   ├── components/                  详情、播放器与通用界面组件
│   ├── data/                        小黑盒接口映射与表情解析
│   └── profile-url.ts               HeyNote 用户主页路由工具
├── vite.config.ts                   扩展多入口构建配置
├── tsconfig.json
└── package.json
```

## 在浏览器中调试

1. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `dist/` 目录。
5. 打开并刷新 `https://www.xiaoheihe.cn/app/bbs/home`。

修改代码后，需要重新运行 `npm run build`，在扩展管理页重新加载扩展，再刷新小黑盒页面。

## 手工生成安装包

压缩包根目录必须直接包含 `manifest.json`，不能在外层多套一层 `dist/`。

macOS / Linux：

```bash
(cd dist && zip -r ../extension.zip . -x '*.DS_Store')
```

Windows PowerShell：

```powershell
Compress-Archive -Path dist\* -DestinationPath extension.zip -Force
```

## 更新并发布版本（仅限作者或获授权维护者）

正式发布前必须同步修改以下三处版本号：

- `package.json`
- `package-lock.json` 顶层及根项目的版本
- `public/manifest.json`

随后运行：

```bash
npm run build
```

确认构建成功后提交代码，并创建与版本号完全一致的标签。例如发布 `0.8.1`：

```bash
git tag v0.8.1
git push origin main
git push origin v0.8.1
```

推送 `v*` 标签后，[Release 工作流](../.github/workflows/release.yml)会自动：

1. 校验标签、`package.json`、锁文件与 Manifest 的版本一致。
2. 安装依赖并运行完整生产构建。
3. 将 `dist/` 内部文件打包为 `extension.zip`。
4. 校验压缩包根目录中的 Manifest 版本。
5. 创建对应的 GitHub 稳定版 Release，并上传 `extension.zip`。

普通代码提交不会创建 Release。

## 常见问题

### Vite 提示 Node.js 版本不支持

升级到 Node.js `20.19+` 或 `22.12+` 后重新运行 `npm ci`。

### 浏览器提示找不到 Manifest

确认加载的是 `dist/` 目录，或确认 `extension.zip` 解压后的根目录直接包含 `manifest.json`。

### 修改后页面没有变化

依次执行生产构建、扩展管理页“重新加载”以及小黑盒页面刷新。只刷新网页不会重新载入已更新的扩展脚本。

### GitHub Actions 拒绝发布

检查 `v*` 标签和三处项目版本是否完全一致，并确认仓库 Actions 的 `GITHUB_TOKEN` 具有 `contents: write` 权限。
