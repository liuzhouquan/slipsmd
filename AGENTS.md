# SlipsMD 开发约定

先读 README.md、docs/product.md、docs/decisions.md，再读当前阶段的 docs/roadmap.md。

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
