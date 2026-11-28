# TASK-004：进度与交接

- 负责人／审核者：agent（实现者）／待分配（独立审核者）。
- 状态：Review（待独立审核与 PR 合并）；基于 `origin/main`（`d25644d`）在独立 worktree 开发。
- 分支／worktree：`feat/task-004-folder-relocation` / `/home/lzq/projects/slipsmd@task-004`。
- base / 当前 HEAD：`d25644d` / 待提交本地开发。
- Issue / PR / 审核报告：待创建。审查 SHA 放在 PR 描述／评论，避免写入本文件反过来改变被审 HEAD。

## 已完成与证据

- **AC-1（路径校验与目录移动）**：在 [src/main/relocation.ts](../../../src/main/relocation.ts) 新增 `folderMoveTarget` 与 `replaceFolderPrefix`，校验工作区边界、禁止移动工作区根目录、禁止移入自身或子目录、拒绝缺失父目录／隐藏或忽略目录／Windows 仅改大小写。
- **AC-2（统一文件服务与不覆盖保护）**：在 [src/main/documents.ts](../../../src/main/documents.ts) 新增 `DocumentStore.relocateFolder`，按源目录、目标目录与受影响会话路径排序加锁，拒绝覆盖已有文件／空目录／非空目录／符号链接，拒绝目录下存在 `dirty` 会话、外部磁盘修改冲突或源／目标路径恢复草稿，安全移动后迁移所有受影响会话路径并保留 `owner`、`revision`、`eol`、`bom`。
- **AC-3（跨窗口、快捷方式与 UI 同步）**：在 [src/shared/types.ts](../../../src/shared/types.ts)、[src/preload/index.ts](../../../src/preload/index.ts)、[src/main/index.ts](../../../src/main/index.ts) 新增 `moveFolder` 与 `grantFolder` 及 `folderRelocated`／`relocated`／`settings`／`filesystem` 同步；在 [FileTree.vue](../../../src/renderer/src/components/FileTree.vue)、[App.vue](../../../src/renderer/src/App.vue)、[style.css](../../../src/renderer/src/style.css) 增加文件夹重命名／移动入口与统一移动对话框支持，提交前保存正文，成功后更新主／右侧文档、历史、阅读位置缓存、`creationFolder` 与快捷方式并展开定位目标目录。
- **AC-4（测试与验证）**：
  - `test/relocation.test.ts` 新增 4 项单元测试（共 10 文件 74 项单元测试全部通过）。
  - 新增真实 Electron 桌面集成测试 `scripts/folder-relocation-smoke.mjs` 并加入 `scripts/desktop.mjs`（在 Linux WSLg 独立运行通过：验证不覆盖已有目录并保留输入、BOM/CRLF 字节保留、多窗口只读镜像同步、文件夹快捷方式更新及重启持久化）。
  - `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build` 均通过。
  - 未在本地运行全量 `npm run test:desktop` 其余七组及 Windows 平台测试，交由 GitHub Actions 两平台 CI 核验。

## 未完成／阻塞

- 待提交分支、创建 PR 并完成独立审核与两平台 CI。

## 接手下一步

1. 推送 `feat/task-004-folder-relocation` 并创建 PR，记录独立审核结果。
2. 等待 Windows 与 Ubuntu CI 通过后由协调者 squash 合并。
