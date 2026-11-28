# TASK-001：实施计划

基线：origin/main @ `276a8e440025d1b4a6a79f3eca3d4b47675d978c`。
分支：docs/task-001-collaboration。worktree：/home/lzq/projects/slipsmd@task-001。

| 步骤 | 产物／检查                                                                                       | 对应 AC    |
| ---- | ------------------------------------------------------------------------------------------------ | ---------- |
| 1    | 清点现有需求／架构／路线／验证，查明 main 无保护与无 PR 模板                                     | AC-1       |
| 2    | 增补 development.md、progress.md、任务模板和 TASK-001 规格／计划／交接；AGENTS / README 链接入口 | AC-1、AC-2 |
| 3    | 补 PR 模板与 branch-protection.main.json，明确审核 SHA 和同账号限制                              | AC-3、AC-4 |
| 4    | 检查相对链接、JSON、格式和差异，提交 Draft PR，更新任务入口                                      | AC-1、AC-5 |
| 5    | 独立 agent 审核最终 HEAD，修正必要项，再复核并在 PR 记录结果；两个 CI 检查成功                   | AC-3、AC-5 |
| 6    | 维护者应用主线保护并读回核验；按审核 HEAD squash 合并，主目录 fast-forward 同步                  | AC-4、AC-5 |

只修改项目约定／文档和 .github 模板／保护声明，不修改产品源码、依赖和 CI workflow。实现者 coordinator，审核者使用独立上下文，只读检查本 worktree；不与其他特性并行修改共享文件。

回退为通过后续 PR 调整协议；分支保护若应用失败保留真实错误并报告，不声称已强制，也不通过绕过来合并。未完成的 PR / worktree 保留用于交接。
