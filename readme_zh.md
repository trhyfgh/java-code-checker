# Java Code Checker

一个集成 **PMD**、**SpotBugs** 和 **CheckStyle** 的 Trae/VS Code Java 代码检查扩展。

## 功能特性

- **PMD** — 源码级静态分析，覆盖最佳实践、代码风格、设计、易错模式、性能和安全
- **SpotBugs** + **FindSecurityBugs** — 字节码级 Bug 检测，含安全漏洞扫描
- **CheckStyle** — 代码风格与规范检查
- **Git 集成** — 自动检测 Git 工作目录中的待检 Java 文件
- **文件选择** — 通过侧边栏树或 Webview 面板选择/取消选择待检文件
- **可视化结果** — Webview 面板按工具分 Tab 展示，含汇总卡片和分组问题列表
- **问题面板** — SpotBugs 和 CheckStyle 的问题直接显示在 VS Code 的问题面板中
- **报告生成** — 为每个工具生成详细的 Markdown + HTML 报告
- **内置工具** — 内置 PMD 7.22.0、SpotBugs 4.9.8 和 CheckStyle 10.21.4，无需额外安装
- **多模块 Maven 支持** — 支持多模块 Maven 项目的 class 文件定位

## 环境要求

- Trae IDE 或 VS Code 1.74.0 及以上
- Java 8+ 运行时（SpotBugs 和 CheckStyle 需要）
- Git（用于待检文件检测）

## 安装

1. 从插件市场安装或通过 `.vsix` 文件安装
2. 所有工具已内置，无需额外配置
3. 可选：在设置中配置外部工具路径

## 使用方法

### 快速开始

1. 打开一个包含 Git 的 Java 项目
2. 点击活动栏中的 **Java Code Checker** 图标
3. 在 **Pending Files** 列表中选择文件
4. 点击工具按钮执行检查：
   - ▶ **PMD** — 源码分析
   - 🐛 **SpotBugs** — 字节码 Bug 检测
   - ✓ **CheckStyle** — 代码风格检查

### 命令列表

| 命令 | 说明 |
|------|------|
| `Java Code Checker: Open Panel` | 打开 Webview 面板 |
| `Run PMD Check` | 对选中文件运行 PMD 检查 |
| `Run SpotBugs Check` | 对选中文件运行 SpotBugs 检查 |
| `Run CheckStyle Check` | 对选中文件运行 CheckStyle 检查 |
| `Refresh Files` | 刷新待检文件列表 |
| `Select All Files` | 全选待检文件 |
| `Deselect All Files` | 取消全选 |

### 快捷键

- `Ctrl+Shift+P`（Windows/Linux）/ `Cmd+Shift+P`（macOS）：打开 Java Code Checker 面板

## 配置项

打开设置（`Ctrl+,`），搜索 "Java Code Checker"：

### PMD 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `javaCodeChecker.rulesetPath` | PMD 规则集 XML 文件路径（PMD7 格式） | `""` |
| `javaCodeChecker.pmdPath` | PMD 可执行文件路径 | `"pmd"` |
| `javaCodeChecker.outputFormat` | 输出格式 (json/xml/text) | `"json"` |
| `javaCodeChecker.outputPath` | 报告输出文件路径 | `"pmd-report.md"` |
| `javaCodeChecker.autoCheckOnSave` | 保存时自动运行 PMD 检查 | `false` |
| `javaCodeChecker.fileExtensions` | 待检文件扩展名 | `["java"]` |

### SpotBugs 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `javaCodeChecker.spotbugsPath` | SpotBugs 可执行文件路径（空=使用内置） | `""` |
| `javaCodeChecker.spotbugsOutputPath` | SpotBugs 报告输出路径 | `"spotbugs-report.md"` |
| `javaCodeChecker.enableFindSecBugs` | 启用 FindSecurityBugs 插件 | `true` |
| `javaCodeChecker.spotbugsMinPriority` | 最低优先级级别 | `"medium"` |

**优先级说明：**
- `high` — 仅 Priority 1（严重 Bug）
- `medium` — Priority 1-2（严重 + 重要，与 IDEA FindSecurityBugs 默认行为一致）
- `low` — 所有优先级

### CheckStyle 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `javaCodeChecker.checkstylePath` | CheckStyle jar 路径（空=使用内置） | `""` |
| `javaCodeChecker.checkstyleConfigPath` | 配置 XML 文件路径 | `"/sun_checks.xml"` |
| `javaCodeChecker.checkstyleSuppressionsPath` | 抑制规则 XML 文件路径 | `""` |
| `javaCodeChecker.checkstyleOutputPath` | CheckStyle 报告输出路径 | `"checkstyle-report.md"` |

**内置配置：** 使用 `/google_checks.xml` 或 `/sun_checks.xml` 即可使用 CheckStyle 内置配置。自定义配置请提供绝对路径或工作区相对路径。

## PMD 规则集示例（PMD7 格式）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ruleset name="custom-ruleset"
         xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0 https://pmd.sourceforge.io/ruleset_2_0_0.xsd">
    <description>Custom PMD Ruleset</description>

    <rule ref="category/java/bestpractices.xml"/>
    <rule ref="category/java/codestyle.xml">
        <exclude name="ShortVariable"/>
        <exclude name="LongVariable"/>
    </rule>
    <rule ref="category/java/design.xml"/>
    <rule ref="category/java/errorprone.xml"/>
    <rule ref="category/java/performance.xml"/>
    <rule ref="category/java/security.xml"/>
</ruleset>
```

## 报告输出

每个工具生成 Markdown + HTML 格式报告，包含：

- 汇总统计（检查文件数、问题数、执行时间）
- 按文件分组的详细问题列表
- 严重级别和规则描述
- 中文报告格式

## 常见问题

### PMD 未找到
默认使用内置的 PMD 7.22.0。如需使用自定义版本，请将 `javaCodeChecker.pmdPath` 设置为 PMD 可执行文件路径（Windows 下如 `C:\pmd\bin\pmd.bat`）。

### SpotBugs 找不到 .class 文件
确保项目已编译（`mvn compile` 或 `gradle build`）。扩展会在 `target/classes` 目录中搜索 `.class` 文件，并支持多模块 Maven 项目。

### CheckStyle suppressions.xml 找不到
如果自定义 CheckStyle 配置引用了 suppressions 文件，请将 `javaCodeChecker.checkstyleSuppressionsPath` 设置为 suppressions XML 的路径，扩展会自动将其复制到工作目录。

### 待检文件列表为空
确保工作区是 Git 仓库，且有变更（已暂存或未暂存）的 Java 文件。

## 许可证

MIT
