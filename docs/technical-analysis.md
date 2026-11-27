# 技术分析与参考依据

调研日期：2026-11-27。Windows 优先。结论基于官方资料与本地源码阅读；没有启动参考应用、执行性能测试或编辑器原型。

## 已确认的实施路线

用户在比较 Muya、ProseMirror / Milkdown 与 CodeMirror 6 后，确认采用 **Electron + TypeScript + Vue 3 + CodeMirror 6**。独立开发预览扩展，不引入 Muya。前期框架比较作为调研历史保留，不覆盖 docs/decisions.md 的后续决定。

## 初期建议（已被后续决策替换）

建议新建产品，采用 **Electron + TypeScript + Vue 3 + Vite**；以 **Muya** 为第一编辑器候选，用小原型验证后再锁定。保留 Files.md 的收集、整理、链接与文件工作区逻辑，不直接合并两个项目的 UI 和全局状态。备选是先复用 HyperMD，或因实测结果切换到 CodeMirror 6 / Milkdown。

这里的“独立客户端”指独立安装、系统级窗口、文件关联和本地文件访问。Electron、Tauri、Wails 均能提供这些体验，内部仍使用 Web 渲染。若以后要求完全不用 WebView，Qt 等原生路线需重新评估，现有 JS 编辑器无法直接变为原生控件。

## Electron 是否过时

没有。官方持续发布新版本；截至此次调研，稳定发布列表包含 2026-11-24 的更新。是否更适合 slips.md，要看编辑器兼容、窗口功能和资源占用，不能用“新旧”或未经统计的流行度排序代替选型。[Electron 官方发布列表](https://releases.electronjs.org/release?channel=stable)

| 方案 | 独立窗口与文件操作 | 对本项目的收益 | 主要代价 | 建议 |
| --- | --- | --- | --- | --- |
| Electron + TS | 主进程管理系统窗口与本地服务 | 与 MarkText 接近、统一 Chromium，编辑器渲染差异较少 | 自带运行时，发行体积与多窗口内存需实测 | 首版首选 |
| Tauri 2 + Rust + Web UI | 可创建独立窗口，通过 Rust 提供文件能力 | 不随包分发完整浏览器，适合关注发行体积 | 三平台 WebView 差异，新增 Rust 边界，MarkText 的 Node 服务需迁移 | 强备选 |
| Wails + Go + Web UI | Go 服务和系统 WebView | 如果将来服务端以 Go 为主，可复用部分业务与类型 | 不会自动复用 Files.md 的浏览器文件代码；仍需验证编辑器跨引擎表现 | Go 路线备选 |
| 纯浏览器 / PWA | 独立窗口受浏览器策略约束，本地权限受限 | 分发方便，适合远程在线入口 | 本地长期授权、文件关联、PicGo 与可控多窗口体验更费力 | 未来入口 |
| Qt 等原生 UI | 系统窗口、原生文件 API | 不依赖 WebView 的实现可行 | 重新做 Markdown 富编辑、复杂选择和渲染，Web 版难共享 | 当前不推荐 |

Electron 的窗口由主进程控制、编辑 UI 在 renderer 中执行。Tauri 默认使用 Windows WebView2、macOS WKWebView、Linux WebKitGTK，不打包这些渲染库；较小安装包不等于多窗口内存必然更低。[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) [Tauri 进程模型](https://v2.tauri.app/concept/process-model/)

Wails 官方当前文档将 v3 桌面版本标为稳定，并说明使用 Go 与系统 WebView；不应沿用旧印象笼统称其 v3 为实验版。正式开工时仍需锁定具体稳定版本和平台依赖。[Wails FAQ](https://wails.io/faq/)

Windows 优先会减轻 Tauri / Wails 首期跨引擎验证负担。但 slips.md 最主要的风险是编辑与文件安全，当前选择 Electron 是为了接近 MarkText 已使用的运行环境；若发行体积成为硬性要求，应在同一原型上比较 Tauri，而非中途重写产品功能。

## Typora 使用什么

Typora 官方主题工具说明：macOS 使用 Safari 系渲染引擎，Windows/Linux 使用 Chrome 系引擎；官方 Windows 排障页直接提到 Electron/Chromium。合理描述是 **Windows/Linux 使用 Electron/Chromium 路线，macOS 使用 WebKit 系渲染**，不能把所有平台都说成同一套 Electron 壳。官方主题说明不等于完整私有架构文档，不据此猜测编辑器内部实现。[官方主题工具](https://github.com/typora/typora-theme-toolkit) [官方排障说明](https://support.typora.io/Trouble-Shooting/)

Typora 的参考价值在交互和编辑体验。它是商业闭源软件，不能复用其编辑器源码。[Typora 官方问题仓库](https://github.com/typora/typora-issues)

## 本地源码基线

| 项目 | 本地提交 | 查看位置 |
| --- | --- | --- |
| Files.md | 946ced9，2026-11-21 | ../../reference/files.md |
| MarkText | 95a14e5，2026-11-23 | ../../reference/marktext |

这些是本地快照，不声称等于远程最新提交。以下路径均相对该参考仓库。

### Files.md

- [web/editor.js](https://github.com/zakirullin/files.md/blob/946ced9/web/editor.js)：HyperMD.fromTextArea、CodeMirror API、两个编辑器实例、图片粘贴和链接打开。
- [web/lib/fs.js](https://github.com/zakirullin/files.md/blob/946ced9/web/lib/fs.js)：使用 FileSystemHandle 风格 API；迁移到桌面需要文件服务适配。
- [web/files.js](https://github.com/zakirullin/files.md/blob/946ced9/web/files.js)：openFile、syncCurrentFile、syncFilesWithServer 交织使用全局文件与当前编辑器状态。不能把它当作纯文件库直接导入。
- [web/chat.js](https://github.com/zakirullin/files.md/blob/946ced9/web/chat.js)：sendToChat 追加到 Chat 及日志，并接入同步脏标记；理念和格式可参考，业务需与文件服务解耦。
- [web/app.js](https://github.com/zakirullin/files.md/blob/946ced9/web/app.js)：onLinkPicked 调用 addBacklink；后者在 files.js 中把反向 Markdown 链接追加到目标正文。
- [web/lib/theme-brutal-dark.css](https://github.com/zakirullin/files.md/blob/946ced9/web/lib/theme-brutal-dark.css)：暗色 CSS 包在 prefers-color-scheme 媒体查询内。改为显式主题状态是应用层工作，浏览器本身并不禁止独立主题。

**可以复用，但应分层复用。** 直接把现有 web 页面放入 Electron，确实能较快得到桌面窗口；多窗口共享文件、Chat 与编辑器同时写入、根目录与跨文件链接仍需重构。这适合短期可行性样机，不足以证明已具备 slips.md 的完整数据模型。

### MarkText / Muya

- [desktop/package.json](https://github.com/marktext/marktext/blob/95a14e5/packages/desktop/package.json)：Electron、Vue、Pinia、TypeScript，依赖独立 workspace 包 @muyajs/core。
- [muya/package.json](https://github.com/marktext/marktext/blob/95a14e5/packages/muya/package.json) 与 [src/index.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/muya/src/index.ts)：独立编辑器包及导出接口，当前本地导出还指向源码，不能假定 npm 某版本与本地接口一致。
- [muya/src/muya.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/muya/src/muya.ts)：getMarkdown、setContent、flush 等接口可用于宿主适配。
- [muya/examples/src/main.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/muya/examples/src/main.ts)：没有 Electron 壳的浏览器示例，说明编辑核心具有独立接入入口。
- [muya/src/state/stateToMarkdown.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/muya/src/state/stateToMarkdown.ts)：从块模型生成 Markdown；必须验证往返读写是否改动用户原格式。
- [muya/e2e/playwright.config.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/muya/e2e/playwright.config.ts)：配置 Chromium、Firefox、WebKit，但后两者有排除项。这不是所有浏览器已完全兼容的证据。
- [desktop/src/main/app/windowManager.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/desktop/src/main/app/windowManager.ts)：窗口管理与文件监听的参考。
- [desktop/src/main/ipc/uploader.ts](https://github.com/marktext/marktext/blob/95a14e5/packages/desktop/src/main/ipc/uploader.ts)：已有 PicGo CLI 和自定义上传调用，可参考图片生命周期；Windows .cmd 命令转义需单独处理，不照搬 shell 拼接。

当前建议是提取或依赖编辑核心、参考成熟桌面能力，新建 slips.md 的工作区与收集流程。完整 fork MarkText 也可行，但随后要维护很多不属于 slips.md 的产品功能、偏好和菜单；直接拼接两套编辑器会使文件和撤销状态更难统一。

## 编辑核心比较

| 候选 | 与需求的匹配 | 首期工程量 / 风险 | 选择条件 |
| --- | --- | --- | --- |
| Muya | 最接近 MarkText 的实时富编辑 | 适配链接与图片、序列化差异、依赖体积、中文输入需要实测 | 第一候选，通过原型再确定 |
| HyperMD + CodeMirror 5 | 最接近现有 Files.md 体验，可复用补丁 | 需脱离全局状态；仍须逐项审查 vendored 插件来源、版本和维护成本 | Muya 不达标或需要快速保留现有行为 |
| CodeMirror 6 | 源文本模型便于维护 Markdown 原格式 | Typora 式视觉编辑需要装饰、widget 和交互开发 | 原格式保真成为首要约束 |
| Milkdown / ProseMirror | 可组合的富文本编辑与 Markdown 扩展 | 需要配置插件并补足图片、表格、公式、快捷键和序列化行为 | Muya 扩展成本过高时比较 |

Milkdown 官方提供 CommonMark、历史等插件组合接口；不是安装一个包就完整获得 Typora 的功能。[Milkdown 入门](https://milkdown.dev/docs/guide/getting-started)

不默认引入第二套预览解析器。如果采用 Muya，尽量使用其编辑与导出能力，减少正文显示和导出语义分叉；源码模式可独立评估 CodeMirror 6。是否拆包、懒加载 Mermaid 等重型能力，在原型测量后决定。

## 双链、工作区和图谱

同工作区双链的基本实现是：解析出链，并建立“目标文件 → 引用它的源文件”索引。读取和修改 Markdown 都能更新索引，外部编辑也能纳入。反链面板不必在目标文件正文写入反向链接，这更接近 Obsidian 的行为。[Obsidian Backlinks](https://help.obsidian.md/plugins/backlinks)

跨工作区双链不是技术上做不到，主要需要定义路径命名、库身份、移动后的定位、跨设备路径与授权。初期按用户要求不做。图谱可以后消费同一个链接索引，无需现在引入图数据库。

Files.md 的链接常使用 /path.md 表示工作区根路径。slips.md 要支持导入这种语义，同时优先生成相对 Markdown 链接；不能把它误当 Windows 磁盘根路径。[[标题]] 是否支持、重名如何选择、重命名是否改链，另行明确。

## PicGo 与 Telegram

PicGo GUI 支持本地 HTTP 上传，默认地址为 127.0.0.1:36677，可传具体文件路径。推荐由桌面主进程提交本次粘贴得到的临时图片路径，不重新读取一个可能已变化的全局剪贴板。图床设置、密钥与具体厂商由 PicGo 管理。[PicGo 高级技巧](https://picgo.github.io/PicGo-Doc/zh/guide/advance.html)

成功后将对应占位替换为 URL，再清理临时文件；失败要保留可重试的图片，不插入伪成功链接。多张图片、切换文件和撤销后的迟到响应要绑定文档与操作身份。CLI 接入可作后续 provider，首版优先服务用户已有 PicGo GUI。

Telegram 可以作为远程收集渠道，但不等于整库同步。Bot API 支持 long polling 或 webhook，未消费更新最长保留 24 小时；只有桌面程序运行时轮询，无法保证长期关机后的消息完整获取。需要持久远程收集时再增加可选常驻接收器，保存事件并由客户端补拉，以 update_id / chat_id / message_id 去重。[Telegram Bot API](https://core.telegram.org/bots/api)

## 参考产品与许可

| 参考 | 借鉴范围 | 限定 |
| --- | --- | --- |
| Files.md | Chat 收集、整理、文件和链接上下文 | 不默认继承固定目录结构、同步或所有机器人业务 |
| MarkText / Muya | 编辑内核、窗口、图片处理 | 选定版本后审查接口与依赖，避免未经验证全量搬入 |
| Typora | 编辑手感、独立窗口、PicGo、主题 | 借鉴产品交互，不能拿到其闭源实现 |
| Obsidian | 反链、面板、收藏及未来图谱 | 作为交互参考，当前不实现跨库图谱 |
| VS Code | 窗口与文档身份、文件外部修改处理 | 参考思路，不为编辑器导入完整 IDE 框架 |

Obsidian 官方将标签页、分组与独立窗口作为不同组织方式；Bookmarks 支持文件和目录。slips.md 的全局外部目录快捷方式仍需自己的路径和持久化设计，不能直接等同于库内收藏。[Obsidian Tabs](https://help.obsidian.md/tabs) [Obsidian Bookmarks](https://help.obsidian.md/plugins/bookmarks)

Files.md 和 MarkText 根许可证均为 MIT；引入其代码须保留版权与许可，并逐一检查复制的库、字体和素材。[Files.md LICENSE](https://github.com/zakirullin/files.md/blob/946ced9/LICENSE) [MarkText LICENSE](https://github.com/marktext/marktext/blob/95a14e5/LICENSE)

## 尚未被证实的事

没有承诺启动时间、安装体积、单窗口内存、编辑大文档延迟或完整语法兼容。当前没有框架性能实测，也没有根据网上星数评定哪个框架“更流行”。Muya 的本地示例能解释接口边界，不能替代 slips.md 在 Windows 上的中文输入和文件往返验证。
