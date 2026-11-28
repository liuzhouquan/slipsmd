# TASK-002：进度与交接

- 负责人／审核者：agent（实现者）／待分配（独立审核者）。
- 状态：Review（待独立审核与 PR 合并）；基于 `origin/main`（`d25644d`）在独立 worktree 开发。
- 分支／worktree：`feat/task-002-ui-measurement` / `/home/lzq/projects/slipsmd@task-002`。
- base / 当前 HEAD：`d25644d` / 待提交本地改动（`package.json`、`scripts/benchmark-ui.mjs`、`docs/benchmarks/task002-ui-baseline.json`、`docs/tasks/TASK-002/*`）。
- Issue / PR / 审核报告：待创建。审查 SHA 放在 PR 描述／评论，避免写入本文件反过来改变被审 HEAD。

## 已完成与证据

- **AC-1 / AC-2**：实现 `scripts/benchmark-ui.mjs` 并在 `package.json` 注册 `npm run benchmark:ui`，支持 `notes`（20–10,000）与 `lines`（200–20,000）参数校验、`--packaged` 标志、缺失 `out/main/index.js` 前置失败检查及 `finally` 临时目录清理；在真实 Electron（WSLg）运行并生成 `.test-results/ui-benchmark.json`。
- **AC-3**：保存 Linux 基线报告 [docs/benchmarks/task002-ui-baseline.json](../../benchmarks/task002-ui-baseline.json)（2,000 篇嵌套笔记、40 个目录、4,013 行 / 82,786 字节长文档）：
  - **首次扫描**：应用启动至编辑器与文件树就绪 `1539.92 ms`；首次 `links()` 冷索引 `1425.39 ms`（1,190 条反链）；`refreshWorkspace()` `123.85 ms`。
  - **文件树**：2,000 篇笔记共挂载 `12,360` 个 DOM 元素；筛选 `Note-100` 耗时 `80.45 ms`（11 条可见），清空筛选重挂载耗时 `204.2 ms`，目录展开耗时 `99.16 ms`。
  - **长文输入与光标移动**：打开 4,013 行文档 `467.5 ms`；实时预览模式输入 `p50 = 66.06 ms / p95 = 101.43 ms / max = 118.18 ms`、光标移动 `p50 = 67.16 ms / p95 = 100.58 ms`；源码模式输入 `p50 = 34.48 ms / p95 = 62.72 ms / max = 90.55 ms`、光标移动 `p50 = 34.54 ms / p95 = 61.9 ms`。
- **基于实测数据的后续优化候选点**：
  1. **编辑器实时预览局部装饰（优先级最高）**：`src/renderer/src/editor/preview.ts` 的 `decorations()` 在每次 `tr.docChanged || tr.selection` 时全量扫描 `1..state.doc.lines` 与整棵 `syntaxTree`，导致 4,013 行文档下预览模式的输入与光标移动延迟约为源码模式的两倍（p50 约 +32 ms）。后续可按可见视口范围（`view.visibleRanges`）拆分行内/非块级装饰，或对块级表格/公式范围做增量更新。
  2. **文件树按需渲染／折叠分支延迟挂载**：`src/renderer/src/components/FileTree.vue` 在目录折叠时仍渲染全部子节点（2,000 篇即 12,360 DOM 节点），导致清空筛选重挂载耗时达 `204.2 ms`。后续可在 `<details>` 未展开且无筛选词时延迟渲染子节点，或在超千篇工作区引入扁平虚拟列表。
  3. **冷建链接索引与首屏调度**：2,000 篇冷索引 `1425.39 ms` 与启动 `1539.92 ms` 可作为后续大库基准参照，注意与后台异步预热及磁盘缓存评估结合。
- **未验证项**：Windows 平台 `benchmark:ui` 尚未运行（需在 Windows 环境或 PR CI 中按需补充）。

## 未完成／阻塞

- 待提交分支、推送并创建 PR，交由独立审核者审核实际 HEAD SHA。

## 接手下一步

1. 在 `slipsmd@task-002` 提交当前改动并推送 `feat/task-002-ui-measurement`，创建 PR。
2. 安排独立审核者按 `docs/tasks/TASK-002/spec.md` 与 `plan.md` 审核实际 HEAD SHA，等待两平台 CI 通过后由协调者 squash 合并。
