 为 pmd-checker 插件集成 SpotBugs + FindSecurityBugs 检测

 Context

 插件已有 PMD 检查功能，现需集成 SpotBugs（代码缺陷）和 FindSecurityBugs（安全漏洞）检测，输出单独报告。
 out/services/spotbugsService.js 已有编译产物，需基于此创建 TypeScript 源文件并完善集成。

 关键差异：SpotBugs 分析编译后的 .class 文件，而非源码；FindSecurityBugs 是 SpotBugs
 的插件（findsecbugs-plugin-1.14.0.jar），两者合并一次运行。

 ---
 涉及文件

 ┌──────┬─────────────────────────────────┐
 │ 操作 │              文件               │
 ├──────┼─────────────────────────────────┤
 │ 新建 │ src/services/spotbugsService.ts │
 ├──────┼─────────────────────────────────┤
 │ 修改 │ src/services/configService.ts   │
 ├──────┼─────────────────────────────────┤
 │ 修改 │ src/extension.ts                │
 ├──────┼─────────────────────────────────┤
 │ 修改 │ package.json                    │
 ├──────┼─────────────────────────────────┤
 │ 修改 │ src/webview/panel.ts            │
 └──────┴─────────────────────────────────┘

 ---
 详细实现步骤

 1. 新建 src/services/spotbugsService.ts

 基于 out/services/spotbugsService.js 反向创建，附加 generateReport() 方法。

 接口定义：
 export interface SpotBugsBug {
     type: string;        // bug 规则名 (e.g. SQL_INJECTION_JDBC)
     category: string;    // 类别 (SECURITY / CORRECTNESS / PERFORMANCE ...)
     priority: number;    // 1=High, 2=Medium, 3=Low
     message: string;
     filePath: string;
     line: number;
 }

 export interface SpotBugsResult {
     filesProcessed: number;
     bugs: SpotBugsBug[];
     errors: string[];
     executionTime: number;
 }

 关键方法：
 - setExtensionPath(path: string) — 在 activate() 中设置，供定位 bundled 工具使用
 - checkFiles(filePaths, config, progress) — 主入口
 - runSpotBugs(filePaths, config) — spawn 进程（复用 JS 逻辑）：
   - 查找 resources/spotbugs-4.9.8/bin/spotbugs.bat（bundled，已确认存在）
   - 加载 FindSecBugs 插件：resources/findsecbugs-cli-1.14.0/lib/findsecbugs-plugin-1.14.0.jar（修正 JS 中错误的文件名
 1.14.jar → 1.14.0.jar）
   - 自动检测 .class 文件目录（target/classes, build/classes 等）
   - 输出格式：-xml 到临时文件
   - 5 分钟超时保护
 - parseSpotBugsXml(xml, sourceFiles) — 复用 JS 中的 regex 解析逻辑
 - generateReport(result, outputPath) — 新增，生成 MD + HTML

 报告格式（Markdown）：
 # SpotBugs / FindSecurityBugs 代码检查报告
 **生成时间**: ...
 **扫描模式**: SpotBugs 4.9.8 + FindSecurityBugs 1.14.0

 ## 检查结果汇总
 | 指标 | 数值 |
 | 分析文件数 | X |
 | 安全漏洞 (SECURITY) | X |
 | 代码缺陷 | X |
 | 高危 (Priority 1) | X |
 | 中危 (Priority 2) | X |
 | 低危 (Priority 3) | X |

 ## 安全漏洞 (FindSecurityBugs)
 ### filename.java
 | 行号 | Bug类型 | 级别 | 描述 |

 ## 代码缺陷 (SpotBugs)
 （按 CORRECTNESS / PERFORMANCE / STYLE 等分节）
 ### filename.java
 | 行号 | Bug类型 | 类别 | 级别 | 描述 |

 ---
 2. 修改 src/services/configService.ts

 在 PMDConfig 之后新增接口并在 ConfigService 中添加方法：

 export interface SpotBugsConfig {
     spotbugsPath: string;      // 默认 '' (使用 bundled)
     spotbugsOutputPath: string; // 默认 'spotbugs-report.md'
     enableFindSecBugs: boolean; // 默认 true
 }

 新增方法：
 - getSpotBugsConfig(): SpotBugsConfig — 从 vscode 配置读取

 ---
 3. 修改 src/extension.ts

 新增内容：
 - 顶部 import SpotBugsService 和 SpotBugsConfig
 - 在 activate() 中：
   - SpotBugsService.getInstance().setExtensionPath(context.extensionPath)
   - 注册命令 pmdChecker.runSpotBugs
 - 新增独立函数 runSpotBugsCheck() —— 模仿 runPMDCheck() 结构：
   a. 获取 checked Java 文件
   b. 显示 progress notification
   c. 调用 spotbugsService.checkFiles()
   d. 调用 spotbugsService.generateReport()
   e. 将结果 postMessage 到 webview（type: 'spotbugsResults'）
   f. 显示结果摘要
 - 在 webview message handler 中添加 case 'runSpotBugs'

 ---
 4. 修改 package.json

 新增 command：
 {
   "command": "pmdChecker.runSpotBugs",
   "title": "Run SpotBugs Check",
   "icon": "$(bug)"
 }

 新增 view/title menu：
 {
   "command": "pmdChecker.runSpotBugs",
   "when": "view == pmdChecker.fileTree",
   "group": "navigation"
 }

 新增配置项：
 "pmdChecker.spotbugsPath": { "type": "string", "default": "", "description": "SpotBugs
 可执行文件路径（留空使用内置版本）" },
 "pmdChecker.spotbugsOutputPath": { "type": "string", "default": "spotbugs-report.md", "description": "SpotBugs
 报告输出路径" },
 "pmdChecker.enableFindSecBugs": { "type": "boolean", "default": true, "description": "启用 FindSecurityBugs
 安全检测插件" }

 ---
 5. 修改 src/webview/panel.ts

 在 header 添加 SpotBugs 按钮：
 <button class="btn btn-primary" onclick="runSpotBugs()">
     <span>🐛</span> SpotBugs
 </button>

 将 Check Results 面板改为标签页，添加 SpotBugs 标签：
 - Tab 1: PMD 结果（现有）
 - Tab 2: SpotBugs/FindSecBugs 结果（新增）
 - 实现简单 tab 切换逻辑（纯 JS，无框架）

 新增 SpotBugs 结果渲染函数 renderSpotBugsResults(results)：
 - 汇总卡片：安全漏洞数、高危数、中危数、文件数
 - SECURITY 类别优先高亮展示
 - 其他 bug 类别按优先级排序

 新增消息处理：
 case 'spotbugsResults':
     spotbugsResults = message.results;
     renderSpotBugsResults(spotbugsResults);
     break;

 ---
 重要注意事项

 1. SpotBugs 需要 Java 环境 — 若 Java 未安装，给出友好提示
 2. 需先编译 Java 项目 — 未找到 .class 文件时，明确提示 "请先执行 mvn compile 或 gradle build"
 3. Windows 路径 — spotbugs.bat 用 cmd /c 调用，与 pmdService.ts 模式一致
 4. 插件 jar 路径修正 — 使用 findsecbugs-plugin-1.14.0.jar（非 1.14.jar）
 5. extensionPath 传递 — 通过 setExtensionPath() 注入，避免多次查找 extension
 6. 不修改 PMD 报告 — SpotBugs 报告完全独立（单独文件）

 ---
 验证方式

 1. npm run compile — 确保 TypeScript 编译无误
 2. 在插件宿主中按 F5 运行，打开一个有 Java 项目（已编译）的 workspace
 3. 选择 Java 文件后点击 "SpotBugs" 按钮
 4. 确认 spotbugs-report.md 和 spotbugs-report.html 生成
 5. 确认 webview 中 SpotBugs 标签显示检测结果
 6. 确认安全漏洞（SECURITY 类别）在报告中单独分节展示