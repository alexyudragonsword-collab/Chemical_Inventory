# Project Cairn 日志

本文件按倒序记录实质性进展——最新条目在本行下方顶部。每条保持简短——只写摘要与指针；结论沉淀到 `cairn/<topic>.md`。

## 2026-08-20 · M9 三套可切换外观（纯视觉，不动数据）

- 新增外观系统：默认 ChemTrack 之外提供 流光玻璃（环境色渐变+毛玻璃+柔和层级）、Notion（浅灰侧栏+纯平表面+低饱和状态色+紧凑间距）、Neo-Brutalism（黄色侧栏+方角硬边框+偏移硬阴影+机械按压反馈）。
- 机制：外观存 cookie → `html[data-appearance]` → 覆盖 Tailwind v4 CSS 令牌（颜色/圆角/`--spacing`）+ 少量结构规则；切换只改 CSS，业务数据零接触。
- 配套重构：全站 `bg-white` 收敛为 `bg-card` 令牌；侧栏/头部改用 nav-* 语义令牌（浅色/黄色侧栏因此纯靠换令牌实现）。
- 验证：四外观 × Dashboard/Inventory 截图目检、56 测试通过、默认外观零回归。切换器在顶栏 "Look" 下拉。

## 2026-08-19 · M8 Windows 一键安装离线包完成并交付

- 自包含 win64 zip（85MB）：内置 Node 22 运行时 + zonky 便携版 PostgreSQL 16 + 拍平的 standalone 应用 + esbuild 工具 bundle + 预制数据库快照（种子 + 479 条真实旧数据导入）。
- 关键决策：数据库快照法（Windows 端零 Prisma CLI）；EDB 被本环境代理封锁改用 Maven Central zonky（无 psql → 自研 restore-db.cjs 纯 JS 恢复器）；pnpm 符号链接森林打包前必须拍平。
- 踩过的坑（已修复）：pg_dump ≥15 会清空会话 search_path，恢复后同连接语句需重置；node-cron v4 ESM 的 import.meta.url 在 CJS bundle 中为 undefined（esbuild banner+define 修复）；pipefail 下 `sort|head` SIGPIPE。
- Linux 端每次构建自动验证：恢复彩排 + 恢复后审计链校验 + 服务/worker 冒烟 + 清单断言；Windows 真机验收清单在包内 README-WINDOWS.md。
- 源码：`deploy/windows/`；构建命令 `pnpm package:win -- --xlsx <file>`；zip 因附件上限拆 3 卷交付用户。
- 补充交付：《ChemTrack安装使用指南.docx》（中文 Word，docx-js 生成，含 4 张界面截图 / 账号表 / 局域网模式 / 备份 / FAQ / 验收清单），随分卷一起分发给团队；本环境 LibreOffice 无法加载任何文件（渲染验证改用 XSD 校验 + mammoth→HTML→Chromium 截图目检）。

## 2026-08-19 · M1–M7 全量实现完成并推送

- 按批准的开发方案完成 ChemTrack 全部七个里程碑（基础/库存核心/旧数据导入/流转/安全/盘点与管理/报表），7 个提交推送至 `claude/chemical-lab-inventory-system-sp3ynb`。
- 旧系统 xlsx 已真实导入：784 行数据 → 479 个容器；221 个待指派保管人等待 Admin → Import fixup 处理。
- 验证：56 个单元测试通过；审计哈希链 524 事件校验完整；24 页 UI 截图走查并汇总为 PPT 交付用户。
- 关键决策与待确认事项：见 `cairn/ROADMAP.md` 与仓库 `README.md`。

## 2026-08-19 · Project Cairn 初始化

- 初始化 Project Cairn 结构。
- 历史迁移模式：`start_fresh`。
- 详情见 `AGENTS.md` 与 `.cairn/config.yaml`。
