# GitHub同步助手

一个桌面软件：登录 GitHub → 选择仓库 → 选择分支 → 绑定本地文件夹，之后本地与云端**双向自动同步**——本地文件变动自动提交推送到 GitHub，GitHub 上的变动自动拉取到本地。**每个分支对应一个本地文件夹**。

基于 Electron 构建，使用系统已安装的 `git` 执行同步。

## 功能

- **GitHub 登录**：使用 Personal Access Token 登录，凭据用系统加密（Electron safeStorage）保存在本地，不上传。
- **可视化选择**：登录后自动列出你有权限的全部仓库和分支，点选即可；也支持输入名字**新建分支**。
- **绑定本地文件夹**：
  - 空文件夹 → 自动下载该分支全部内容；
  - 非空文件夹 → 自动初始化并与分支内容合并（同名文件冲突默认以本地为准）；
  - 已是 Git 仓库 → 直接关联。
- **双向自动同步**：
  - 本地方向：监听文件变动（防抖 2.5s）→ 自动 `commit` + `push`；
  - 云端方向：定时（默认 30s）`fetch` → 有新提交自动 `merge` 到本地。
- **冲突处理**：本地与云端改了同一文件时任务进入"冲突"状态，界面上一键选择「以本地为准」或「以云端为准」。
- **多任务**：可同时管理多个"仓库+分支 ⇄ 文件夹"映射，每个独立运行；同一文件夹或同一分支不允许重复绑定。
- **系统托盘常驻**：点关闭按钮不退出，最小化到右下角托盘继续后台同步；右键托盘图标可"显示主界面 / 全部立即同步 / 开机自动启动 / 退出"。
- **其它**：暂停/启用、立即同步、打开文件夹、运行日志、单实例、可调云端检查间隔。

## 演示

下方视频完整展示：登录 → 选仓库/分支/文件夹 → 初始下载 → 本地新建文件自动推送到云端 → 模拟云端提交后自动拉取到本地，全程无报错。

<video src="/opt/cursor/artifacts/github_sync_tool_demo-2.mp4" controls></video>

## 环境要求

- **Windows 10/11**（macOS/Linux 亦可运行）。
- 已安装 **Git**（命令行 `git` 可用）。
- 已安装 **Node.js 18+**（仅开发/源码运行需要；打包成 exe 后终端用户无需安装）。

## 快速开始（源码运行）

```bash
cd github-sync-tool
npm install
npm start
```

## 打包为 Windows 安装包

```bash
npm run dist:win        # 生成 NSIS 安装程序（release/ 目录）
# 或
npm run dist:portable   # 生成免安装版 exe
```

产物在 `release/` 目录，把安装包发给用户双击安装即可，用户机器无需 Node.js（但仍需安装 Git）。

## 使用步骤

1. **创建 Token**：登录页点"没有 Token？"会打开 GitHub 令牌创建页，**勾选 `repo` 权限**，生成后复制。
   （推荐用 Fine-grained token 并授予目标仓库的 Contents 读写权限，或经典 token 勾 `repo`。）
2. **登录**：把 Token 粘贴进输入框，点"登录"。
3. **新建同步**：点"＋ 新建同步" → 选仓库 → 选分支（或输入新分支名）→ 选本地文件夹 → "开始同步"。
4. 之后无需干预：你在文件夹里增删改文件会自动上传；GitHub 上的更新会自动下载。状态栏和日志可随时查看同步情况。

## 工作原理

```
本地文件夹  ⇄  git（系统命令）  ⇄  GitHub 分支
   │                                    │
 chokidar 监听变动               定时 fetch 检测
   │                                    │
 防抖后 add/commit/push          merge 到本地
```

- 认证：推送/拉取时通过 `GIT_ASKPASS` 环境脚本临时提供 Token，**不写入 `.git/config`**，避免明文残留。
- 同步操作串行化（每个任务一条 Promise 链），避免并发 git 操作互相干扰。

## 目录结构

```
github-sync-tool/
├── package.json
├── src/
│   ├── main.js          # 主进程：窗口、IPC、生命周期
│   ├── preload.js       # 安全暴露 API 给渲染层
│   ├── store.js         # 配置与 Token 加密持久化
│   ├── github.js        # GitHub REST API 客户端
│   ├── gitops.js        # git 命令封装 + 免弹窗认证
│   └── syncengine.js    # 双向同步引擎、冲突处理
├── renderer/            # 界面（登录页 / 任务列表 / 新建向导 / 日志）
│   ├── index.html
│   ├── style.css
│   └── app.js
└── test/
    └── mock-github.js   # 本地模拟 GitHub API（端到端测试用）
```

## 说明与限制

- Token 以系统加密方式保存于用户数据目录（`%APPDATA%/github-sync-tool/config.json`）。
- 冲突采用"整体择一"策略（以本地或以云端为准），不做逐行手动合并；需要精细合并时请用专业 Git 工具。
- 首次同步大仓库耗时取决于网络与仓库体积。
