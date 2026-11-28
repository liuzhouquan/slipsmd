# TASK-005：实施计划

基线：origin/main @ `d25644d`。分支／worktree：`docs/task-005-manual-uat` / `/home/lzq/projects/slipsmd@task-005`。

## 实施步骤

| 步骤 | 模块与产物 | 对应 AC | 验证方式 |
| --- | --- | --- | --- |
| 1 | 建立 `TASK-005` 分支与 worktree，对照 `validation.md`、`EditorPane.vue`、`src/main/index.ts` 与 `electron-builder.yml` 编写 `spec.md`、`plan.md` 与逐项可执行验收表 `checklist.md` | AC-1..AC-4 | 核对文档路径、配置项与错误边界与源码一致 |
| 2 | 人工在真实 Windows 10/11 环境下载 CI／Release 产物（NSIS `.exe` 与便携 `.zip`），准备隔离测试笔记目录、真实 PicGo 与同步文件夹 | AC-1..AC-4 | 记录系统版本、产物版本／Commit SHA 与工具版本 |
| 3 | 逐项执行 `checklist.md` 第 1–4 节检查并填写结果、现象与截图／日志路径；若发现缺陷另建修复任务跟踪 | AC-1..AC-4 | 所有已测项均有实测结论，未测项明确标为 `未验证` |
| 4 | 回填结果至 `checklist.md` 与 `progress.md`（合并后同步更新 `docs/validation.md`），经独立审核并提交 PR | AC-4 | 检查链接与文档格式，CI 检查通过 |

## 并行边界

- **负责文件**：`docs/tasks/TASK-005/*`（以及验收完成并合入后由协调者同步更新 `docs/validation.md` 和 `docs/progress.md`）。
- **禁止改动**：不修改 `src/` 产品源码、测试代码或 CI 配置；不与 `TASK-002`、`TASK-003`、`TASK-004` 争抢源码文件。

## 验证与交付

- 文档改动完成标准：链接有效、内容与当前代码行为一致（`EditorPane.vue`、`src/main/index.ts`、`electron-builder.yml`）。
- 任务进入 `Done` 的门槛：必须由真实 Windows 环境操作者完成 `checklist.md` 回填，禁止将空白模板或模拟结果作为验收通过提交。

## 回退

- 纯文档任务，不涉及任何程序数据或磁盘结构变更；如需调整验收项，直接修订 `docs/tasks/TASK-005/` 文档即可。
