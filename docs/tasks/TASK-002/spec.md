# TASK-002：长文／大库界面测量

状态：Active。负责人：agent (feat/task-002-ui-measurement)。Issue / PR：待创建。

## 场景与范围

- **背景与目标**：依据 [progress.md](../../progress.md) 近期路线与 [validation.md](../../validation.md) 待测项，建立可重复的长文档与大型工作区界面测量场景，量化**首次扫描**、**文件树渲染与筛选**、**长文输入与光标移动**的真实桌面耗时与 DOM 规模，为后续优化点提供实证依据，避免在缺乏测量数据时盲目改动编辑器或文件树实现。
- **范围**：
  - 新增独立测量脚本 `scripts/benchmark-ui.mjs` 与 npm 脚本 `benchmark:ui`，使用临时合成工作区与隔离 `SLIPSMD_USER_DATA` 启动真实 Electron 应用进行测量，不接触用户个人笔记。
  - 覆盖三类可重复场景并输出结构化 JSON 报告（`.test-results/ui-benchmark.json`）：
    1. **首次扫描（大库）**：在嵌套目录工作区（默认 2,000 份 Markdown，支持参数调节）中测量应用启动至编辑器与文件树就绪、`refreshWorkspace()` 全量目录树扫描、以及首次 `links()` 冷索引耗时。
    2. **文件树（大库）**：测量 `.file-tree` DOM 节点规模、筛选输入框（`查找笔记…`）键入与清空的渲染延迟、以及目录展开定位延迟。
    3. **长文输入**：在包含标题、段落、链接、表格、数学公式、代码块与中英文混排的长文档（默认 4,000 行）中，分别在**实时预览模式**与**源码模式**下测量连续输入与光标移动的逐帧延迟（min / p50 / p95 / max / mean）。
  - 在 `docs/benchmarks/` 保存可追溯的基线测量原始报告，并在任务交付记录中基于实测数据归纳候选优化点。
- **非目标**：
  - 本任务不修改 `src/main/`、`src/preload/`、`src/shared/` 或 `src/renderer/` 的产品行为与界面实现，不提前实施虚拟滚动或局部装饰优化。
  - 不将单机合成工作区的绝对毫秒数当作跨机器硬性阈值或 CI 门禁。
- **数据、窗口与平台影响**：
  - 仅在 `os.tmpdir()` 创建临时合成 Markdown 工作区与临时用户数据目录，测量结束后自动清理。
  - 不修改任何现有 Markdown 数据格式、保存逻辑、文件权限或跨窗口协议。

## 验收条件

| ID | 可观察的结果 | 失败／边界条件 |
| --- | --- | --- |
| AC-1 | 执行 `npm run build` 后运行 `npm run benchmark:ui`，可在隔离临时工作区启动真实 Electron 窗口并完整跑通首次扫描、文件树与长文输入三类场景 | 缺少构建产物或未提供图形环境时显式报错退出，不静默跳过测量；临时目录在 `finally` 中清理 |
| AC-2 | 产出包含环境元数据、参数规模与三类场景指标的 JSON 报告 `.test-results/ui-benchmark.json`（含样本统计 p50/p95/max 及 DOM 计数） | 参数越界（如笔记数或行数非正整数／超出首版 10,000 篇上限）时在启动前参数校验失败退出 |
| AC-3 | 在 `docs/benchmarks/task002-ui-baseline.json` 与任务交接文档中记录真实运行基线数据，并基于实测对比明确后续优化候选点 | 不得伪造未运行平台的数据；若仅在本地 Linux/WSLg 运行，明确标注平台与限制 |
| AC-4 | 现有 `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build` 与 `npm run test:desktop`（或可用图形环境验证）均保持通过，无产品行为回退 | 不因新增基准脚本破坏现有 CI 流程或污染工作区 |

## 待决策与依赖

- 无阻塞外部依赖；本任务不修改产品源码，不与 `TASK-003`、`TASK-004` 产生共享产品文件冲突。
- 是否将 `benchmark:ui` 纳入 GitHub CI 的常规运行由协调者后续决定；本轮保持独立按需脚本，不修改 `.github/workflows/ci.yml`。
