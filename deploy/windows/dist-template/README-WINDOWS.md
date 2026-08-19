# ChemTrack Windows 离线包 — 使用说明

实验室化学品在线库存管理系统，自包含离线包：内置 Node 运行时与 PostgreSQL 数据库，
**无需安装任何软件、无需联网、无需管理员权限**。

## 一、安装（一次性）

1. 把 zip **解压到一个简短的英文路径**，推荐 `C:\ChemTrack`（避免中文/空格/超长路径）。
   - 若 Windows 提示"已阻止"，先右键 zip → 属性 → 勾选"解除锁定"再解压。
2. 双击 **`install.bat`**。若弹出 SmartScreen，点"更多信息 → 仍要运行"。
3. 等待安装完成（初始化数据库并恢复预置数据，约 1–2 分钟），窗口会打印访问地址与演示账号。

安装完成后桌面会出现 "ChemTrack - Start / Stop" 和网页快捷方式。

## 二、日常使用

| 操作 | 方式 |
|---|---|
| 启动 | 双击 `start.bat`（就绪后自动打开浏览器） |
| 停止 | 双击 `stop.bat` |
| 查看状态 | 双击 `status.bat` |
| 开机自启 | 双击 `autostart-on.bat`（登录后静默启动；`autostart-off.bat` 取消） |

**演示账号**（密码统一为 `chemtrack-demo`，**首次登录后请尽快修改**）：

| 账号 | 角色 |
|---|---|
| admin@lab.internal | Admin（系统管理，不能操作管控化学品） |
| li.wei@lab.internal | Lab Manager（B2-14 实验室） |
| m.tan@lab.internal | Custodian |
| r.iyer@lab.internal | Lab User |
| ehs@lab.internal | EHS Officer |
| viewer@lab.internal | Viewer（只读） |

数据库已预置演示数据 + 从旧系统导入的真实库存（479 个容器）。
待处理的导入修正项在 **Admin → Import fixup**。

## 三、团队服务器模式（局域网访问）

在作为服务器的机器上双击 **`enable-lan.bat`**（防火墙规则需要过一次 UAC 确认），
脚本会打印本机局域网地址，如 `http://192.168.1.20:3000`——同网段同事用浏览器直接访问即可。

- 数据库始终只监听本机（127.0.0.1），对外只暴露网页端口。
- `disable-lan.bat` 恢复为仅本机访问。
- 建议配合 `autostart-on.bat` 让服务器开机即用。

## 四、备份与迁移

**备份 = 停机后复制整个文件夹。**

1. 双击 `stop.bat`；
2. 复制整个 ChemTrack 文件夹（数据都在 `data\` 里：数据库、SDS 文件、日志）；
3. 恢复/迁移：把文件夹放到任何一台 Windows 机器上，直接 `start.bat` 即可运行。

## 五、维护工具

- **校验审计链**：`run-tool.bat verify-audit` —— 应输出 "Audit chain OK"。
- **导入旧系统 xlsx**：
  ```
  run-tool.bat import-legacy --file C:\path\Chemical_by_Permit.xlsx --dry-run
  run-tool.bat import-legacy --file C:\path\Chemical_by_Permit.xlsx
  ```
  先 `--dry-run` 查看报告，确认无误再正式导入（同一文件重复导入会被自动拒绝）。
- **彻底重装**（清空所有数据，需二次确认）：`install.bat --reset`

## 六、常见问题

| 现象 | 处理 |
|---|---|
| 双击 .bat 一闪而过 | 用 `status.bat` 看状态；日志在 `data\logs\`（app.err.log / pg.log / worker.err.log） |
| 端口被占用 | 安装器会自动改用 3000–3009 / 5433–5442 中的空闲端口，实际端口见 `config\chemtrack.env` |
| 提示缺少 VCRUNTIME140.dll | 安装微软 VC++ 运行库：https://aka.ms/vs/17/release/vc_redist.x64.exe |
| 首次启动较慢 | Windows Defender 会扫描大量文件，属正常现象，仅首次 |
| 忘记端口/地址 | 打开 `config\chemtrack.env` 查看 `PORT`；或看桌面 "ChemTrack" 网页快捷方式 |
| 手机/其他电脑访问不了 | 确认已运行 `enable-lan.bat` 且在同一网段；公用(Public)网络配置下防火墙规则不生效，请把网络设为"专用" |

## 七、首次部署验收清单

1. `install.bat` 正常完成并打印地址与账号；
2. `start.bat` 后浏览器打开，用 `li.wei@lab.internal / chemtrack-demo` 登录，Inventory 可见导入的旧数据；
3. 做一次入库和一次减量 → Admin → Audit trail → "Verify integrity" 显示绿色；
4. `run-tool.bat verify-audit` 输出 "Audit chain OK"；
5. Safety → SDS library 上传一个 PDF → 文件出现在 `data\files\sds\`；
6. `stop.bat` 后 `start.bat`，数据完好；
7. （服务器模式）`enable-lan.bat` 后，同网段另一设备可打开系统；
8. 把整个文件夹复制到另一位置运行 `start.bat`，可正常启动（验证备份可用）。

---
版本与组件信息见 `VERSION.txt`。问题反馈时请附上 `data\logs\` 下的相关日志。
