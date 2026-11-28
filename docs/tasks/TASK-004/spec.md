# TASK-004：文件夹重命名／移动设计与实现

状态：Active。负责人：agent (feat/task-004-folder-relocation)。Issue / PR：待创建。

## 场景与范围

- **用户场景与问题**：用户在工作区中创建和整理目录后，需要将已有文件夹重命名或移动到工作区内的其他已有文件夹下。当前首版仅支持单文件重命名／移动，文件夹只能通过外部文件管理器操作，容易导致已打开笔记、右侧历史、阅读位置、窗口授权路径和快捷方式失去同步。
- **范围**：
  - 在 `src/main/relocation.ts` 新增 `folderMoveTarget(source, root, destination)`，校验源目录位于当前工作区内（且非工作区根目录本身），目标使用相对工作区路径，拒绝隐藏／忽略目录、无效名称、父目录缺失、向自身或子目录内移动、以及 Windows 仅改大小写。
  - 在统一文件服务 `DocumentStore`（`src/main/documents.ts`）新增 `relocateFolder(sourceDir, targetDir)`：沿用队列锁（按源目录、目标目录及受影响会话路径排序加锁）、不覆盖保护（目标存在任何文件／目录／符号链接或存在活动会话／恢复草稿时拒绝）、源目录下存在未保存修改（`dirty`）、未恢复草稿或外部版本冲突时拒绝；安全重命名后同步更新所有受影响会话路径并保留各会话的 `owner`、`revision`、`eol` 与 `bom`。
  - 在 `src/main/index.ts`、`src/preload/index.ts`、`src/shared/types.ts` 新增 `moveFolder` IPC 与 `folderRelocated` 广播事件：同步更新所有窗口的 `allowed`、`initial`、链接索引失效、工作区或子目录固定快捷方式（`settings.pins`）及持久化。
  - 在 `src/renderer/src/components/FileTree.vue` 与 `src/renderer/src/App.vue` 增加文件夹重命名／移动入口与统一移动对话框支持：提交前保存已修改正文，成功后更新主／右侧视图、标题、右侧历史、主／右侧阅读位置缓存、`creationFolder`、展开定位移动后的文件夹并刷新工作区；提示用户检查笔记内旧链接与相对图片路径。
  - 新增单元测试（`test/relocation.test.ts`）与真实 Electron 桌面集成测试（`scripts/folder-relocation-smoke.mjs`，纳入 `scripts/desktop.mjs`）。
- **非目标**：
  - 不重写笔记正文中的 Markdown 链接或相对图片路径（留待 `TASK-003`）。
  - 不实现文件夹删除、跨磁盘／跨工作区移动或移动工作区根目录本身。
  - 不修改 `Chat.md` 收集箱位置语义；工作区根目录的 `Chat.md` 保持原位。
- **数据、窗口与平台影响**：
  - 不改写任何 Markdown 文件字节；已打开且未修改的文档保留原 `BOM` / `CRLF` 与 `revision`。
  - 跨窗口同步：任一窗口移动文件夹后，其他窗口中已打开的该目录下笔记、只读镜像、历史与允许路径同步更新，若另一窗口内有未保存编辑或冲突则拒绝移动。
  - 跨平台：`fs.lstat` 检查目标空位后调用 `fs.rename`，防止 POSIX 下目标为空目录时被静默替换；Windows 下 `win32` 队列键忽略大小写并拒绝仅改大小写。

## 验收条件

| ID | 可观察的结果 | 失败／边界条件 |
| --- | --- | --- |
| AC-1 | 在工作区内重命名文件夹或将文件夹移动到另一个已有文件夹下，磁盘目录与其中所有子目录和 Markdown 文件完整迁移，文件树刷新并展开定位到新目录 | 目标已存在文件／文件夹／符号链接、父目录不存在、移动到自身或子目录、工作区外或隐藏／忽略目录、Windows 仅改大小写均被拒绝且源目录保持不变 |
| AC-2 | 移动经由统一 `DocumentStore` 执行：目录下有未保存修改、外部磁盘修改冲突、源／目标路径存在恢复草稿或目标下存在活动会话时拒绝移动 | 跨文件系统或无权限时返回明确中文错误提示，不破坏源目录与现有草稿 |
| AC-3 | 移动后，所有窗口中受影响的已打开主／右侧文档路径、标题、只读／编辑所有权、右侧导航历史、阅读位置缓存、窗口授权路径、固定文件夹／文件快捷方式与链接索引均同步更新 | 不自动改写笔记正文内的链接与图片路径；移动后提示用户检查引用 |
| AC-4 | 单元测试覆盖文件夹路径校验、不覆盖保护、脏会话／草稿／外部冲突拒绝、多会话更新与跨窗口同步；真实 Electron 桌面回归覆盖界面操作、错误保留输入、跨窗口同步与重启后快捷方式保留 | `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build` 与 `npm run test:desktop` 全部通过 |

## 待决策与依赖

- 与 `TASK-003`（移动后链接修复）接口协调：`moveFolder` 返回 `{ path, warning }` 并通过 `folderRelocated` 事件携带 `{ previous, path, documents }`，后续 `TASK-003` 可直接基于目录映射计算引用重写，无需破坏本接口。
- `TASK-002` PR #3 正在等待合并，本任务不修改 `scripts/benchmark-ui.mjs` 或 `docs/benchmarks/`，仅在 `src/`、`test/`、`scripts/folder-relocation-smoke.mjs`、`scripts/desktop.mjs` 与 `docs/tasks/TASK-004/` 工作。
