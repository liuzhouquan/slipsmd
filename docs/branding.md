# SlipsMD 命名与兼容

用户于 2026-11-27 确认显示名使用 **SlipsMD**，仓库、目录与命令统一使用 **slipsmd**，不设置中文别名。名称来自 slips of paper：先把想法记在小纸条上，再整理与连接。中文界面和中文输入需求保留。

命名前已检查网页搜索、GitHub 仓库名及 npm，未发现完全同名的 Markdown 编辑器项目；这是当日检索结果，不代表全球唯一或域名可注册。

## 标识对应

| 位置 | 标识 |
| --- | --- |
| 品牌、窗口显示名 | SlipsMD |
| 仓库、项目目录、npm 包名、可执行文件 | slipsmd |
| 应用 ID / Windows AppUserModelID | io.slipsmd.desktop |
| 应用数据目录 | appData/slipsmd |
| preload API / IPC | window.slipsmd / slipsmd: |
| 自动化启动变量 | SLIPSMD_USER_DATA、SLIPSMD_WORKSPACE、SLIPSMD_OPEN_FILE |
| 发布产物 | slipsmd-版本-架构.扩展名 |

## 历史数据

- 应用 ID 沿用上一版，维持 Windows 安装身份；新名称从 0.1.0-alpha.3 开始发布。
- `src/main/migration.ts` 只从最新存在且含用户数据或初始化标记的旧 profile 导入设置、drafts 和 pending-images；不复制 Chromium 缓存，不混入更早版本的已处理草稿。
- 新版已有设置和同名草稿优先；旧目录不删除。完成后写入一次性标记，防止已处理草稿下次启动被再次导入。使用显式测试 profile 时不导入个人数据。
- `src/shared/captures.ts` 同时识别历次 Chat 元数据；新写入使用 slipsmd 前缀。旧归档状态和来源标记继续有效，打开旧笔记不会触发正文迁移。
- 旧名称只在兼容入口、解析器及测试夹具中保留，不能重新用于界面、构建配置或发布包。
- Git 历史保留；旧 alpha 的二进制属于历史构建，不通过修改文件名冒充新版。
