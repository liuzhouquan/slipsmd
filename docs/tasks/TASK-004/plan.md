# TASK-004：实施计划

基线：origin/main @ `d25644d`。分支／worktree：`feat/task-004-folder-relocation` / `/home/lzq/projects/slipsmd@task-004`。

## 实施步骤

| 步骤 | 模块与产物 | 对应 AC | 验证方式 |
| --- | --- | --- | --- |
| 1 | 建立 `TASK-004` 分支与 worktree，编写 `spec.md`、`plan.md`、`progress.md` | — | `npm run typecheck && npm test` |
| 2 | 在 `src/main/relocation.ts` 实现 `folderMoveTarget` 与子目录前缀替换辅助函数，补充路径边界单元测试 | AC-1 | `npm test` |
| 3 | 在 `src/main/documents.ts` 实现 `DocumentStore.relocateFolder`，涵盖有序锁、目标空位、恢复草稿、脏会话、外部冲突检查与会话迁移，补充单元测试 | AC-1、AC-2 | `npm test` |
| 4 | 在 `src/shared/types.ts`、`src/preload/index.ts`、`src/main/index.ts` 接入 `moveFolder` 与 `folderRelocated` 跨窗口／快捷方式／索引同步 | AC-3 | `npm run typecheck && npm run build` |
| 5 | 在 `src/renderer/src/components/FileTree.vue`、`src/renderer/src/App.vue`、`src/renderer/src/style.css` 增加文件夹重命名／移动按钮与对话框支持，同步视图／历史／位置缓存 | AC-1、AC-3 | `npm run typecheck && npm run build` |
| 6 | 新增 `scripts/folder-relocation-smoke.mjs` 并加入 `scripts/desktop.mjs`，运行完整格式、类型、单元、构建与桌面集成检查；提交 PR 并由独立审核者审核 | AC-4 | `npm run format:check && npm run typecheck && npm test && npm run build && npm run test:desktop` |

## 并行边界

- **负责文件**：`docs/tasks/TASK-004/*`、`src/main/relocation.ts`、`src/main/documents.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/shared/types.ts`、`src/renderer/src/components/FileTree.vue`、`src/renderer/src/App.vue`、`src/renderer/src/style.css`、`test/relocation.test.ts`、`scripts/folder-relocation-smoke.mjs`、`scripts/desktop.mjs`。
- **禁止改动**：不修改 `docs/progress.md`（合入 `main` 后由协调者更新），不修改 `TASK-002` 产物。

## 验证与交付

- 必跑命令：
  - `npm run format:check`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm run test:desktop`（在可用图形环境中运行真实 Electron 验证，并记录本地环境与 CI 边界）

## 回退

- 本任务不改变 Markdown 文件格式或设置结构（仅更新已移动目录对应的快捷方式路径）。如发现异常，可直接回退本 PR；移动失败时源目录保持原位且不覆盖目标。
