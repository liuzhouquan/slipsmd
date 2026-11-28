# 多 agent 开发流程

适用于人工开发者、同一会话内的子 agent，以及不同工具／机器上的独立 agent。采用轻量的规格驱动开发（Spec-Driven Development，SDD），不依赖某个专有 agent 框架。

## 从哪里接手

| 文件                               | 职责                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)          | agent 必须遵循的项目规则与交付门槛                    |
| [progress.md](progress.md)         | 当前基线、进度、近期路线、任务索引；从这里判断下一步  |
| [product.md](product.md)           | 用户确认的需求、优先级与产品边界                      |
| [decisions.md](decisions.md)       | 技术与产品决策，不把早期建议当成已确认需求            |
| [architecture.md](architecture.md) | 当前模块职责与未来方向                                |
| [roadmap.md](roadmap.md)           | 阶段验收目标与已交付历史；近期排期以 progress.md 为准 |
| [validation.md](validation.md)     | 已发生的验证和限制，不把计划写成已通过                |
| tasks/&lt;ID&gt;/spec.md           | 本任务做什么、不做什么、可验证的验收条件              |
| tasks/&lt;ID&gt;/plan.md           | 实施顺序、模块／接口、依赖与验证映射                  |
| tasks/&lt;ID&gt;/progress.md       | 工作记录、当前分支／提交、阻塞和交接                  |

已有 alpha 历史并没有逐特性 spec / plan；保留真实记录，从新任务开始补齐，不伪造过去的审批或规格。

## 协调与认领

一个协调者负责拆任务、指定实现者／审核者、串行集成及更新总路线。任务使用唯一 ID，例如 TASK-002。协调者在 progress.md 分配任务，远端任务 Issue 或 Draft PR 记录实时负责人、状态及分支；表中只存在的候选事项尚未认领。开始前检查最新 main、开放 PR 和任务讨论，已有负责人时先协调，不能把“我读到了文件”当作锁。

同一会话的子 agent 可使用平台提供的通信工具。不同独立会话不会因 AGENTS.md 自动共享对话；通过已提交文档、GitHub Issue／PR 及协调者交接工作。如工具提供跨会话消息，可用于通知，结论仍要写入持久记录。跨机器需 fetch / push；同机 worktree 共享 Git 对象与引用，但各自的工作文件、未提交内容和构建输出独立，分支改动不会自动合入另一个 worktree。

同一任务只有一个实现写入者；审核者只读。不要多个 agent 同时写一个 worktree。多 agent 并行通常是 TASK-A 与 TASK-B 的不同 worktree，而不是几个 agent 同时改 App.vue。

任务状态：Proposed → Ready → Active → Review → Done；阻塞时记录 Blocked、原因、负责人和解除条件。Ready 表示 spec / plan 已检查，接口和边界足以实施；Done 只在 PR 已合并且验证通过后生效。PR 分支里的目标完成记录不代表 main 已交付，必须同时看链接 PR 的实际状态。

## 分支与 worktree

沿用现有主目录 `/home/lzq/projects/slipsmd`，不迁移或重复克隆。工作树建在相邻的 `slipsmd@<任务 ID>`，例如 `slipsmd@task-002`；Windows / 其他机器可换父目录，保留相同命名约定。

分支：`feat/task-002-short-name`、`fix/task-003-short-name`、`docs/task-001-collaboration`。从最新 origin/main 创建，所有修改和检查都在任务 worktree 中执行：

```sh
git -C /home/lzq/projects/slipsmd fetch origin
git -C /home/lzq/projects/slipsmd worktree add \
  -b feat/task-002-short-name \
  /home/lzq/projects/slipsmd@task-002 origin/main
cd /home/lzq/projects/slipsmd@task-002
# 产品代码任务安装各自依赖；使用 npm 缓存，不共享 node_modules / out / dist。
npm ci
```

已有 worktree 先用 `git worktree list` 找到并接手，不对同一分支另建副本。现有 projects 布局优先；新克隆可使用 x-cmd repo 的共享路径约定。使用 x-cmd 前加载 `. ~/.x-cmd.root/X`，再查看 `x repo --help`；不能为了使用工具又克隆一份 slipsmd。

每个任务的测试工作区、Electron `SLIPSMD_USER_DATA` 和需要的服务端口单独分配；优先使用已有临时夹具脚本和隔离显示。不要在用户正在输入的 WSLg 桌面并行跑交互测试。审核如需构建，使用独立的 detached review worktree，不覆盖实现者输出。

## Spec → Plan → 实现

1. 从 [任务模板](tasks/_template/spec.md) 建立任务文件。spec 写用户场景、范围、非目标、AC 编号、文件／窗口／保存影响及尚待决策项。
2. plan 将 AC 映射到具体模块、步骤和检查命令；列出要修改的共享接口、与其他任务重叠的文件、依赖和回退方式。
3. 协调者检查范围和依赖后开始实施。规格变更与代码一起更新；超出用户范围的需求不能仅凭 agent 自行批准。
4. 大任务拆为可独立验证的纵向任务；依赖接口的实现等接口规格确定后再并行。若两个任务都必须大改 src/main/index.ts、App.vue、shared/types.ts 或统一文件服务，先约定接口／拆出模块，再实施或串行集成。
5. 完成相关验证后创建 Draft PR，并使用仓库 PR 模板。提交与 PR 描述讲清最终行为和证据，不依赖聊天历史。

总进度文件由协调者维护，其他实现者优先只更新自己的任务文件，避免每个 PR 都改同一张表。协调者可预先用规划 PR 登记一批任务；紧急任务先建 Issue／Draft PR 记录认领，再补总索引。多人独立执行时，认领需协调者确认，Git 文档本身不提供原子分布式锁。

## 验证与交叉审核

代码验证遵循 AGENTS.md 与任务 plan；现有 CI 包含 Windows / Ubuntu 的格式、类型、单元测试、索引基准、源码桌面、打包和打包后桌面流程。纯文档改动本地检查链接／JSON／差异即可，但 PR 仍等待两平台现有 CI；不为文档新增与实现镜像的测试。

审核由另一 agent 或开发者执行。独立审核上下文只带需求、规格、基线／HEAD、差异和验证证据；不要让作者替审核者写结论。至少检查：AC 是否实现、数据写入／冲突／权限和多窗口风险、回归、遗漏验证、文档一致性、并行任务接口冲突。

PR 描述或审核评论必须记录：审核者标识、被审 HEAD SHA、结论（通过／需修正）、问题等级、修正与复核情况、实际验证及限制。审核记录放在 PR 中可以避免提交记录本身又改变被审核 HEAD。新增代码、规格、计划或状态提交后，审核者复核新的完整 HEAD；旧 SHA 的通过不覆盖新内容。未验证的条件必须显式标明。

同一个 GitHub 账号不能正式 approve 自己创建的 PR。多个 agent 共用账号时，独立 agent 审核报告属于项目流程证据，不冒充 GitHub Approve；配置正式审批数为 0，同时保留强制 PR、两平台 CI、过期检查失效和对话解决要求。以后有第二个独立 GitHub 评审账号时，再通过明确的维护者决定将正式审批数提高至至少 1。只有一人／一个会话可用时保持 PR 待审，不把作者自查当成独立通过。

主分支保护的可审计配置是 [.github/branch-protection.main.json](../.github/branch-protection.main.json)。GitHub 不会自动读取此文件；维护者须应用并读回确认，配置变更也走 PR。目标为强制 PR、最新主线上的两个 Actions 检查、线性历史、禁止强推／删除，管理员也遵守。它不自动验证独立 agent 身份，不能把这一约定说成服务器已验证的双人审核。

## 合并与交接

协调者一次合并一个 PR：确认实际 HEAD 已获独立审核、未解决问题为空、两个 CI 检查成功且基线最新。主线已变化时更新任务分支（通常 merge origin/main；如需 rebase，先协调并仅对自有分支使用 force-with-lease），然后重新跑检查和审核。不能对 main 强推或使用 `--admin` 绕过门槛。

```sh
# 将 REVIEWED_SHA 与 PR_NUMBER 替换为审核记录里的值。
gh pr merge PR_NUMBER --repo liuzhouquan/slipsmd \
  --squash --match-head-commit REVIEWED_SHA
```

合并之后才更新总进度的主线完成状态、规格交付证据与验证记录。可在规划／收尾 PR 中集中同步；不能为更新进度直接推 main。产品发布是另一个交付动作，不要求每个纯文档 PR 发布新版本。

退出、阻塞或换 agent 时，更新任务 progress.md：任务 ID、负责人、分支／worktree、base 与当前 HEAD、已完成／未完成、改动文件、准确命令及结果、未跟踪文件、阻塞、下一步、PR 和审核链接。最后 commit / push；有不能提交的内容时明确记录位置和原因，不能声称另一个机器能读取本机草稿。

合并并确认工作树干净、没有待交接文件后，使用 `git worktree remove <path>` 清理；不要 `rm -rf`，不要强制删除脏 worktree。主目录干净时使用 `git pull --ff-only` 同步，脏目录先保留用户改动。需要留给其他 agent 的工作树写进交接记录，不擅自清理。

## 给新 agent 的启动消息

```text
接手 SlipsMD 的 TASK-XXX。仓库 liuzhouquan/slipsmd。
先 fetch 并读取 AGENTS.md、docs/development.md、docs/progress.md，
再读本任务 spec.md / plan.md / progress.md、产品决策与相关源码。
检查远端 Issue／PR 的认领记录后，只在分配给你的任务分支和 worktree 工作。
当前负责人：...；分支：...；base：...；文件范围：...；依赖：...。
不要改 main，不覆盖其他 agent 的未提交内容。完成后附验证证据，提交 PR，
交由另一 agent 审核实际 HEAD，协调者串行合并；中断前留下可独立接手的进度。
```

工具能力参考：[Codex 子 agent](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)、[Codex worktree](https://learn.chatgpt.com/docs/environments/git-worktrees.md)。具体通信能力取决于当前会话提供的工具，这些文件本身不是自动调度器或消息总线。
