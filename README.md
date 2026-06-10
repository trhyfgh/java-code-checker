[**中文文档**](readme_zh.md)
# Java Code Checker

A Trae/VS Code extension for comprehensive Java code checking, integrating **PMD**, **SpotBugs**, and **CheckStyle** in one place.

## repository

- [Java Code Checker](https://github.com/trhyfgh/java-code-checker)

## Features

- **PMD** — Source-level static analysis for best practices, code style, design, error-prone patterns, performance, and security
- **SpotBugs** + **FindSecurityBugs** — Bytecode-level bug detection with security vulnerability scanning
- **CheckStyle** — Code style and convention enforcement
- **Git Integration** — Automatically detects pending Java files from your Git working directory
- **File Selection** — Select/deselect files to check via sidebar tree or webview panel
- **Visual Results** — View results in a webview panel with tabs for each tool, summary cards, and grouped issue lists
- **Problems Panel** — SpotBugs and CheckStyle issues appear directly in VS Code's Problems panel
- **Report Generation** — Generates detailed Markdown + HTML reports for each tool
- **Bundled Tools** — PMD 7.22.0, SpotBugs 4.9.8, and CheckStyle 10.21.4 are bundled — no external installation required
- **Multi-module Maven** — Supports multi-module Maven project structures for class file resolution

## Requirements

- Trae IDE or VS Code 1.74.0 or higher
- Java 8+ runtime (required for SpotBugs and CheckStyle)
- Git (for pending file detection)

## Installation

1. Install the extension from the marketplace or via `.vsix` file
2. All tools are bundled — no additional setup required
3. Optionally configure external tool paths in settings

## Usage

### Quick Start

1. Open a Java project with Git
2. Click the **Java Code Checker** icon in the Activity Bar
3. Select files from the **Pending Files** list
4. Click the tool button to run a check:
   - ▶ **PMD** — Source code analysis
   - 🐛 **SpotBugs** — Bytecode bug detection
   - ✓ **CheckStyle** — Code style checking

### Commands

| Command | Description |
|---------|-------------|
| `Java Code Checker: Open Panel` | Open the webview panel |
| `Run PMD Check` | Run PMD on selected files |
| `Run SpotBugs Check` | Run SpotBugs on selected files |
| `Run CheckStyle Check` | Run CheckStyle on selected files |
| `Refresh Files` | Refresh the pending files list |
| `Select All Files` | Select all pending files |
| `Deselect All Files` | Deselect all pending files |

### Keyboard Shortcuts

- `Ctrl+Shift+P` (Windows/Linux) / `Cmd+Shift+P` (macOS): Open Java Code Checker Panel

## Configuration

Open settings (`Ctrl+,`) and search for "Java Code Checker":

### PMD Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `javaCodeChecker.rulesetPath` | Path to PMD ruleset XML file (PMD7 format) | `""` |
| `javaCodeChecker.pmdPath` | Path to PMD executable | `"pmd"` |
| `javaCodeChecker.outputFormat` | Output format (json/xml/text) | `"json"` |
| `javaCodeChecker.outputPath` | Report output file path | `"pmd-report.md"` |
| `javaCodeChecker.autoCheckOnSave` | Auto-run PMD check on save | `false` |
| `javaCodeChecker.fileExtensions` | File extensions to check | `["java"]` |

### SpotBugs Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `javaCodeChecker.spotbugsPath` | SpotBugs executable path (empty = bundled) | `""` |
| `javaCodeChecker.spotbugsOutputPath` | SpotBugs report output path | `"spotbugs-report.md"` |
| `javaCodeChecker.enableFindSecBugs` | Enable FindSecurityBugs plugin | `true` |
| `javaCodeChecker.spotbugsMinPriority` | Minimum priority level | `"medium"` |

**Priority levels:**
- `high` — Priority 1 only (critical bugs)
- `medium` — Priority 1-2 (critical + important, matches IDEA FindSecurityBugs default)
- `low` — All priorities

### CheckStyle Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `javaCodeChecker.checkstylePath` | CheckStyle jar path (empty = bundled) | `""` |
| `javaCodeChecker.checkstyleConfigPath` | Configuration XML file path | `"/sun_checks.xml"` |
| `javaCodeChecker.checkstyleSuppressionsPath` | Suppressions XML file path | `""` |
| `javaCodeChecker.checkstyleOutputPath` | CheckStyle report output path | `"checkstyle-report.md"` |

**Built-in configs:** Use `/google_checks.xml` or `/sun_checks.xml` for CheckStyle's built-in configurations. For custom configs, provide an absolute or workspace-relative path.

## Example PMD Ruleset (PMD7 Format)

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

## Report Output

Each tool generates a Markdown + HTML report with:

- Summary statistics (files checked, issues found, execution time)
- Detailed issue list grouped by file
- Severity levels and rule descriptions
- Chinese-language report format

## Troubleshooting

### PMD not found
The bundled PMD 7.22.0 is used by default. To use a custom version, set `javaCodeChecker.pmdPath` to the PMD executable path (e.g., `C:\pmd\bin\pmd.bat` on Windows).

### SpotBugs cannot find .class files
Make sure your project has been compiled (`mvn compile` or `gradle build`). The extension searches for `.class` files in `target/classes` directories and supports multi-module Maven projects.

### CheckStyle suppressions.xml not found
If your custom CheckStyle config references a suppressions file, set `javaCodeChecker.checkstyleSuppressionsPath` to the suppressions XML path. The extension will copy it to the working directory automatically.

### No files showing
Ensure your workspace is a Git repository and you have Java files with changes (staged or unstaged).

## License

MIT
