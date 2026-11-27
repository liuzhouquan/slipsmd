# 首版验证记录

版本：0.1.0-alpha.1。日期：2026-11-27。以下记录区分本地检查、CI 和人工验收，不把某个平台的结果外推到其他平台。

## 本地环境

开发与桌面验证在 Linux / WSLg 中进行，Node.js 24、Electron 45、Vue 3、CodeMirror 6。Electron 下载包与 npm 包内附的官方 SHA256 清单核对后使用。测试启动时的 --no-sandbox 仅用于测试环境；正常应用代码保持 renderer sandbox 和 contextIsolation 开启，nodeIntegration 关闭。

## 自动检查

- `npm run typecheck`：Vue、renderer、preload 和 main 的 TypeScript 检查。
- `npm test`：真实临时文件上的 BOM/CRLF 保留、外部冲突、草稿恢复、重复编辑所有权、串行写入、Chat 追加冲突、外部删除后的恢复保护，以及链接解析。
- `npm run build`：三个入口构建，生成依赖许可声明。
- `npm run test:desktop`：启动真实 Electron 窗口，通过 Playwright 操作 CodeMirror、文件树、独立窗口、收集箱、图片、设置和冲突界面；生成临时截图，不接触用户文件。
- `npm audit`：检查锁文件依赖。打包工具的 minimatch 使用 11.0.1 修复版本覆盖，需随打包流程一起验证。

桌面测试中的 PicGo 是本机模拟 HTTP 服务：验证请求里传入的是实际临时图片路径，以及返回 URL 被正确写入 Markdown。这不等于已在用户的 PicGo 与图床上测试成功。

本地已通过：13 项文件／链接测试、类型检查、生产构建，以及源码启动与打包后 Linux 应用两套桌面流程。桌面流程还包含笔记链接补全、加粗快捷键和右侧任务框保存。Windows 的结果将在首次推送后由 CI 产生。

## GitHub CI

`.github/workflows/ci.yml` 配置 Windows 和 Ubuntu 的依赖安装、测试、构建、真实 Electron 检查与打包。是否通过，以对应提交的 Actions 记录为准。构建产物为 Windows NSIS 安装包、zip 与 Linux tar.gz。

## 仍需人工验证

- Windows 微软拼音／其他中文输入法的 composition、候选选择、跨行修改与撤销。
- 真实 PicGo、实际图床、网络代理和失败重试。
- OneDrive、Syncthing、Git checkout、杀毒软件、网络盘等造成的外部修改／锁定情形。
- 大型工作区、长文档、缩放、多显示器与 1/3/5 窗口资源消耗。
- macOS 的运行、系统菜单与打包。

没有宣称完整 CommonMark / Typora 扩展兼容、零数据丢失、任意规模性能或同文件多人实时协作。初版同文件重复打开聚焦原有编辑窗口，服务层也拒绝另一窗口的直接写入。
