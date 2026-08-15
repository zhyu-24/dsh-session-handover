# dsh-session-handover

[English](./README.md) · 中文

**dsh** Web GUI 的长会话交接插件：派生一个轻量新会话，不丢失旧会话。

不就地压缩上下文，而是分析当前会话、预测几个「新会话目标」供你勾选，把一份可编辑的 `HANDOVER-*.md` 交接文档写进会话工作区，然后跳到新的空白会话，输入框自动预填开场白（含父会话 id，新会话随时可以回溯）。

## 功能

- **会话头部「派生」按钮** — 一键分析当前会话，预测 3–5 个「新会话目标」候选（永远包含「综合继续」候选）。
- **候选面板** — 勾选一个或多个候选（多选 = 合并成一个目标），或直接输入自定义目标。
- **HANDOVER 交接文档** — 生成到*父*会话的工作区（`HANDOVER-<目标>.md`；同名已存在则自动加 `-YYYY-MM-DD` 日期后缀）。模型重复输出会被去重，写盘后回读校验。
- **同工作区跳转** — 新会话在父会话所在工作区创建（客户端把父会话 cwd 与工作区列表匹配后再连接）。
- **预填开场白** — `父会话：<id>（<标题>）\n按 HANDOVER-<...>.md 继续。…`，显示在输入框上方，并带「填入输入框」手动兜底按钮。
- **`parent_session_peek` agent 工具** — 在派生会话里翻阅父会话的对话记录（可按关键词检索）。
- **手动兜底技能** — 按钮不可用时的 `session-handover` 技能（见下）。

旧会话原样保留，不做任何修改、压缩或删除。

## 安装

```sh
dsh plugin --profile web add git+https://github.com/zhyu-24/dsh-session-handover.git
# 重启 `dsh web` 生效
```

本地开发时改为链接工作副本：

```sh
dsh plugin --profile web add link:/path/to/dsh-session-handover
```

### 可选：手动兜底技能

按钮流程本身开箱即用；`session-handover` 技能是可选的兜底路径（也是按钮流程的行为规范）。把它复制到用户技能根目录：

```sh
mkdir -p ~/.dsh/skills/session-handover
cp skill/SKILL.md ~/.dsh/skills/session-handover/SKILL.md
```

## 工作原理

- **宿主半体**（`src/index.ts` → `lib/index.js`）：仅限 loopback 的 HTTP 路由 `/api/dsh-handover/analyze` 与 `/api/dsh-handover/finalize`，外加 `parent_session_peek` agent 工具。服务经 `ctx.get` 解析并声明 inject 依赖；每个挂载面都通过 disposer 注册，可干净卸载。
- **浏览器半体**（`src/client/index.ts` → `lib/client.js`）：通过 slot 服务注册头部按钮（`conversation.session.header.actions`）、浮层面板（`shell.overlay`）与预填组件（`conversation.composer.dock` / `conversation.input.dock`）。经 loopback 路由用原生 `fetch` 与宿主半体通信。
- **Bundle 补丁**（`cordis.patch.yml`）：通过 `dsh.bundle.patch` 清单字段把插件行插入 profile roster。

## 开发

```sh
pnpm install
pnpm build   # tsdown → lib/index.js（宿主）+ lib/client.js（浏览器）
```

重新构建后需重启 `dsh web` —— 插件 bundle 在启动时加载（无 HMR）。

## 许可证

[MIT](./LICENSE)
