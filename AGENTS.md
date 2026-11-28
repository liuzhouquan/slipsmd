# SlipsMD 开发约定

先读 README.md、docs/development.md、docs/progress.md，再读 docs/product.md、docs/decisions.md、当前任务的 spec.md / plan.md。docs/roadmap.md 保留阶段说明与历史。

## 协作与交付

- 新特性、修复和独立文档改动默认使用任务分支与独立 worktree；main 只用于集成，不直接编辑／提交／推送。已有任务范围内的修正继续用原分支。
- 采用 docs/development.md 的轻量规格驱动流程：任务认领 → spec → plan → 实现 → 验证 → PR → 独立审核 → 合并。
- docs/progress.md 是进度与路线入口；每个任务使用 docs/tasks/<任务 ID>/ 下的 spec.md、plan.md、progress.md。沿用 docs/tasks/_template/，小修可合并章节并在 PR 说明，不为拼写更正另建整套规格。
- 协调者分配唯一任务 ID、负责人、分支和文件范围；独立会话通过远端任务 Issue／PR 和已提交文档交接，不能假定共享聊天记录或未提交改动。
- 每个工作 worktree 只有一个写入者；多个 agent 可以并行处理边界清楚的不同任务，不得并行修改同一分支或共用构建输出、测试笔记和 Electron 用户数据目录。
- 使用其他 agent 执行独立 PR 审核；审核者读取 spec / plan 和完整差异，不代作者实现。支持子 agent 时分配给独立上下文；不支持时交接另一会话，不得把作者自查写成独立审核。
- PR 记录被审核的确切 HEAD SHA、审核者、结论、问题处理和验证证据；被审核内容改变后重新审核。只改 PR 描述／审核评论不改变 HEAD。
- 所有 PR（含纯文档）等待当前提交的 Windows 与 Ubuntu CI；修复／合并主线后重新验证，禁止用 --admin、关闭保护或强推绕过检查。
- 合并由协调者串行执行，使用已审核 HEAD 的匹配保护并 squash；main 更新后再启动后续任务或处理依赖任务。
- 中断／换 agent 前更新任务 progress.md；进度不得只留在聊天。目录规则、认领、交接、同账号审核限制与清理方法见 docs/development.md。

## 产品与实现

- 当前品牌显示为 SlipsMD，仓库与本地目录为 slipsmd；npm 包名和可执行文件为 slipsmd，应用 ID 为 io.slipsmd.desktop。旧名称仅允许出现在历史数据兼容代码及其测试中。
- 首期只使用英文品牌，不添加中文名称或中文品牌标识；中文界面文案正常保留。新名称须先检查网页与代码托管平台上的重名情况。
- Windows 优先；多独立窗口属于核心需求，标签页属于后续需求。
- 用户之前说的“分页”指窗口管理，不要据此实现纸张分页。
- 普通 Markdown 文件是用户数据的最终载体，索引与缓存必须可重建。
- 保留 Files.md 的产品理念；具体代码、编辑器和桌面框架以原型证据决定，不把建议当作已确认需求。
- 不把整库同步、图谱、多工作区双链、Telegram 接入提前塞进首版。
- 所有编辑、Chat 追加和文件移动经过统一文件服务；防止多窗口互相覆盖。
- 不把本地文件系统、Electron 或 PicGo 能力直接散落在共享 UI 中，方便未来 Web 入口。
- 参考仓库位于 ../reference/files.md 和 ../reference/marktext；不要在参考仓库中实现 SlipsMD。
- 复用代码记录来源提交与许可证；不要假定整个 web/lib 的许可证与仓库根目录相同。
- 已确认采用 Electron + TypeScript + Vue 3 + CodeMirror 6，MIT 公开仓库；不要重新切换到 Muya。
- 原生窗口为主，不把纸张分页或 tabs 当作首版要求。
- 运行 npm run typecheck、npm test、npm run build；编辑器／窗口变更再运行 npm run test:desktop。
- 本地 Linux 检查与 Windows CI / 人工 IME 验证分别报告；不要把模拟 PicGo 当作真实图床验证。
- 当前代码集中在 src/main、src/preload、src/shared 和 src/renderer；docs/architecture.md 中的多 package 布局属于后续演进。
