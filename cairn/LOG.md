# Project Cairn 日志

本文件按倒序记录实质性进展——最新条目在本行下方顶部。每条保持简短——只写摘要与指针；结论沉淀到 `cairn/<topic>.md`。

## 2026-08-21 · 无演示数据模式（--no-demo）+ Windows 包 v3

- 用户指出 B2-14/A1-07/C3-02/D1-11 不在原始 xlsx 中——确认为演示种子，选择清除。核实：真实数据 = xlsx 表头 CREATE HUJ/BGU 实验室（R02-08/I02-11/E04-12/I03-09，479 容器）；导入自建 "Legacy import" 站点，不依赖种子实验室。
- 实现：`prisma/seed.ts` 支持 `--no-demo`（或 SEED_DEMO=0）——只建参照数据（H/P 语句、相容性矩阵、权限类别，导入按 code 查权限类别所以必须保留）+ 6 个文档化账号（无实验室成员关系）；跳过演示站点/实验室/位置/物质/容器/项目/SDS。`build-package.sh` 加 `--no-demo` 透传（经 SEED_DEMO env，避开 pnpm `--` 透传坑）。
- 验证（scratch 库）：no-demo seed + 真实导入后=仅 4 真实实验室 479 容器、6 账号、208 物质全部来自 xlsx、审计链 479 事件 OK。
- 运维要点：无成员关系时除 Admin/EHS 外无人能操作容器——装好后先在 Admin → Users 给真实实验室指派管理员/成员；Import fixup 指派保管人时会自动创建成员关系。
- v3 包已构建交付：恢复彩排确认 479 容器/6 账号，85MB zip（sha256 前缀 3f4c8969）拆 3 卷交付；合并脚本与说明的校验值同步更新。

## 2026-08-21 · Windows 离线包 v2 重打包并交付

- 应用户要求重打 Windows 包，纳入 M9 之后的全部修复：三套外观、dispose 流程（登记册+状态显示+transfer 守卫）、Adjust 对话框简化、Import fixup 越权崩溃修复与错误边界。
- 构建门全绿：479 容器导入、审计链 510 事件校验、恢复彩排（507 容器/9 用户）、服务与 worker 冒烟。85MB zip（sha256 前缀 76bd548e）仍按附件上限拆 3 卷 + join-package.bat 交付。
- 构建命令与流水线不变（`pnpm package:win -- --xlsx …`，缓存的 Node/zonky 运行时直接复用）。

## 2026-08-21 · Import fixup "Set" 崩溃修复（server-side exception）

- 用户报错：Fix 列指派 custodian 点 Set 弹 "Application error: a server-side exception…Digest"。复现根因：resolve_import_fixup 对 Lab Manager 是 OWN（仅限所管实验室），但工作清单页展示全部实验室的待修行；点到别人实验室的行时 action 抛裸 Error → 生产环境白屏。
- 修复三层：① 工作清单按权限过滤——OWN 角色只看/只数自己管的实验室，Admin/EHS 仍看全部；② action 越权时改为 redirect 回页面带 `?error=scope` 显示黄条提示，不再抛异常；③ 新增 `src/app/(app)/error.tsx` 错误边界，今后任何未捕获服务端错误显示应用内友好卡片（含 digest 参考号 + Try again），不再是吓人的裸错误页。
- 验证：Playwright 双账号走查——li.wei 只见 B2-14 行且 Set 成功；admin 仍见 479 行全量；typecheck+build+56 测试通过。
- 提示用户：Windows 包早于此修复，需重打包。

## 2026-08-21 · Adjust quantity 对话框去掉 Purpose 与 Project 字段

- 用户要求：Adjust quantity 不再填 Purpose 和 Project/cost centre。对话框现只剩 数量 + 前后对比条 + 确认；witness 机制（管制品/大于20%更正）不变。
- 审计链仍要求非空 reason：server action 层按模式写默认值（Quantity deducted / Quantity added / Count correction）；schema 中 reason/projectCode 改 optional（check-out 流程有独立表单，未改动）。
- 连带清理：RowAdjust 及两处调用页不再传/查 projects。验证：typecheck+build+56 测试通过；Playwright 实际走一次 deduct→recorded→reverse 闭环。
- 改动：`src/components/adjust-dialog.tsx`、`row-adjust.tsx`、`src/app/(app)/inventory/{page,actions}.tsx|ts`、`chemicals/[substanceId]/page.tsx`。

## 2026-08-21 · Dispose 流程修复：已处置登记册 + 状态显示

- 用户反馈两问题：① 没有集中查看所有 disposed 容器的地方；② check-out 确认 dispose 后页面仍显示 "My custody"。
- 修复：Inventory 新增 "Disposed" 筛选片作为登记册视图（默认视图隐藏已处置，选中后只列 DISPOSED，行内显示处置日期与原因，来自 DISPOSE 交易记录）；check-out 面板改为操作成功后 `router.refresh()`，非可操作状态显示状态徽标（替代 custody 徽标）并用说明文案屏蔽 deduct/transfer/dispose 表单。
- 自查补洞：`transferCustody` 原缺状态守卫，现拒绝非 ACTIVE/EMPTY 容器（域层冒烟已验证 "Cannot transfer a disposed container"）；disposed 行不再误标 low stock。
- 验证：typecheck + 56 测试通过；Playwright 截图目检两页。改动：`src/server/queries.ts`、`src/server/inventory.ts`、`src/app/(app)/inventory/page.tsx`、`src/app/(app)/check-out/panel.tsx`。
- 注意：Windows 离线包早于本修复，需要时重跑 `pnpm package:win` 重新打包。

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
