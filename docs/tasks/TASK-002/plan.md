# TASK-002：实施计划

基线：origin/main @ `d25644d`。分支／worktree：`feat/task-002-ui-measurement` / `/home/lzq/projects/slipsmd@task-002`。

## 实施步骤

| 步骤 | 模块与产物 | 对应 AC | 验证方式 |
| --- | --- | --- | --- |
| 1 | 建立 `TASK-002` 任务分支与 worktree，安装依赖与 Electron 二进制，编写 `spec.md`、`plan.md`、`progress.md` | — | `npm run typecheck && npm test` |
| 2 | 实现 `scripts/benchmark-ui.mjs` 并在 `package.json` 注册 `benchmark:ui`：参数校验、合成大库与长文生成器、首次扫描／文件树／长文输入（预览 vs 源码）测量与 `.test-results/ui-benchmark.json` 输出 | AC-1、AC-2 | `npm run build && npm run benchmark:ui` |
| 3 | 运行多组真实测量，保存基线报告 `docs/benchmarks/task002-ui-baseline.json`，分析实测瓶颈并整理后续优化建议 | AC-3 | 检查 JSON 字段完整性与数据一致性 |
| 4 | 运行全量格式、类型、单元测试、构建与桌面集成检查，更新 `TASK-002/progress.md` 并准备 PR 与独立审核 | AC-4 | `npm run format:check && npm run typecheck && npm test && npm run build && npm run test:desktop` |

## 并行边界

- **负责文件**：`docs/tasks/TASK-002/*`、`scripts/benchmark-ui.mjs`、`package.json`（仅新增 `benchmark:ui` 脚本）、`docs/benchmarks/task002-ui-baseline.json`。
- **禁止改动**：不修改 `src/` 下任何产品源码、`.github/workflows/ci.yml` 或 `docs/progress.md`（总进度由协调者在合并后统一更新）。
- **环境隔离**：测试工作区建于 `os.tmpdir()`，Electron `SLIPSMD_USER_DATA` 指向临时目录，不触碰用户个人目录。

## 验证与交付

- 必跑命令：
  - `npm run format:check`
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm run benchmark:ui`
  - `npm run test:desktop`（视本地图形环境可用性执行并如实记录）
- 证据位置：`.test-results/ui-benchmark.json`（临时运行产物）与 `docs/benchmarks/task002-ui-baseline.json`（入库基线证据）。

## 回退

- 本任务无任何数据格式变更或持久化状态迁移。若需回退，仅移除 `scripts/benchmark-ui.mjs`、`package.json` 中的 `benchmark:ui` 条目及相关文档即可，对应用功能零影响。
