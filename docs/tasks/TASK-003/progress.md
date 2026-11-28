# TASK-003：进度与交接

- 实现者：当前主 agent；独立审核者：在最终 PR 分配。
- 状态：Review（实现与本地验证完成，等待 PR 的独立审核与两平台检查）。
- 基线：d25644de745ea223d58d9179c371c5af399a54c1。
- 分支／worktree：feat/task-003-link-repair-preview / /home/lzq/projects/slipsmd@task-003。
- Issue / PR：[Issue #4](https://github.com/liuzhouquan/slipsmd/issues/4) 已认领；实际 HEAD 与审查 SHA 在 PR 记录。

## 已完成

读取总路线、产品与决策，确认没有 TASK-003 实现者。只读核对 TASK-002 交接范围；双方不并行修改 package.json、应用主入口或编辑器。已安装本 worktree 的独立依赖，并实现语法树定位的纯 URL 规划、只读扫描与快照检查、绑定计划的选择、可从仓库外启动的 CLI。

本地 `npm run format:check`、`npm run typecheck`、`npm test`（102 项，含 32 项新增纯函数／真实文件／真实 CLI 检查）及 `npm run build` 已通过。CLI 手工夹具也核对了 BOM／CRLF 原始文件字节不变且目标没有创建。未修改产品入口或编辑器，因此未重复本地交互桌面；PR 仍必须通过现有 Windows / Ubuntu 源码与打包后七组桌面检查。

## 下一步与未验证项

[PR #5](https://github.com/liuzhouquan/slipsmd/pull/5) 已创建。首轮 CI 的两平台通过，但独立审核指出三个边界：空相对目录、嵌套 HTML、Windows 大小写敏感目录。已补测试并确认前两项在旧实现上失败；修正采用点路径、块级祖先排除及严格路径／歧义跳过策略。新提交必须重新审核并通过 CI；首轮通过不覆盖修正后的 HEAD。随后 fetch 核对并行 TASK-002 是否更新主线，再按审核 HEAD 串行合并。

中断前补充准确命令、结果、当前提交及未提交文件；不得把设计中的写入／撤回契约说成已执行。
