import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CheckStyleConfig } from './configService';

export interface CheckStyleViolation {
    source: string;
    severity: 'error' | 'warning' | 'ignore';
    message: string;
    filePath: string;
    line: number;
    column: number;
}

export interface CheckStyleResult {
    filesProcessed: number;
    violations: CheckStyleViolation[];
    errors: string[];
    executionTime: number;
}

export class CheckStyleService {
    private static instance: CheckStyleService;
    private outputChannel: vscode.OutputChannel;
    private extensionPath: string = '';
    private diagnosticCollection: vscode.DiagnosticCollection | undefined;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('CheckStyle Checker');
    }

    public static getInstance(): CheckStyleService {
        if (!CheckStyleService.instance) {
            CheckStyleService.instance = new CheckStyleService();
        }
        return CheckStyleService.instance;
    }

    public setExtensionPath(extensionPath: string): void {
        this.extensionPath = extensionPath;
        this.outputChannel.appendLine(`Extension path set: ${extensionPath}`);
    }

    public setDiagnosticCollection(collection: vscode.DiagnosticCollection): void {
        this.diagnosticCollection = collection;
    }

    public clearDiagnostics(): void {
        this.diagnosticCollection?.clear();
    }

    public async checkFiles(
        filePaths: string[],
        config: CheckStyleConfig,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<CheckStyleResult> {
        const startTime = Date.now();
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`\n========== CheckStyle Check Started ==========`);
        this.outputChannel.appendLine(`Files to analyze: ${filePaths.length}`);
        filePaths.forEach(f => this.outputChannel.appendLine(`  - ${f}`));
        this.outputChannel.appendLine(`CheckStyle path: ${config.checkstylePath || '(bundled)'}`);
        this.outputChannel.appendLine(`Config path: ${config.checkstyleConfigPath}`);

        if (!filePaths.length) {
            this.outputChannel.appendLine('No files to analyze, aborting.');
            return {
                filesProcessed: 0,
                violations: [],
                errors: [],
                executionTime: 0
            };
        }

        try {
            progress?.report({ message: 'Running CheckStyle check...' });
            const result = await this.runCheckStyle(filePaths, config);
            progress?.report({ message: 'Processing CheckStyle results...', increment: 20 });

            return {
                filesProcessed: filePaths.length,
                violations: result.violations,
                errors: result.errors,
                executionTime: Date.now() - startTime
            };
        } catch (error) {
            this.outputChannel.appendLine(`CheckStyle check error: ${error}`);
            throw new Error(`CheckStyle check failed: ${error}`);
        }
    }

    private async runCheckStyle(
        filePaths: string[],
        config: CheckStyleConfig
    ): Promise<{ violations: CheckStyleViolation[]; errors: string[] }> {
        return new Promise((resolve, reject) => {
            const errors: string[] = [];

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                reject(new Error('No workspace folder open'));
                return;
            }
            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            // Resolve CheckStyle jar path
            let jarPath = config.checkstylePath || '';
            if (!jarPath) {
                this.outputChannel.appendLine('Looking for bundled CheckStyle...');
                if (this.extensionPath) {
                    const bundledJar = path.join(
                        this.extensionPath,
                        'resources',
                        'checkstyle-10.21.4',
                        'checkstyle-10.21.4-all.jar'
                    );
                    if (fs.existsSync(bundledJar)) {
                        jarPath = bundledJar;
                        this.outputChannel.appendLine(`Using bundled CheckStyle: ${jarPath}`);
                    } else {
                        this.outputChannel.appendLine(`Bundled CheckStyle not found at: ${bundledJar}`);
                    }
                }
            } else {
                this.outputChannel.appendLine(`Using configured CheckStyle: ${jarPath}`);
            }

            if (!jarPath) {
                this.outputChannel.appendLine('CheckStyle not found. Please configure checkstylePath or install CheckStyle.');
                errors.push('CheckStyle not found. Please configure checkstylePath or place checkstyle JAR in resources/.');
                resolve({ violations: [], errors });
                return;
            }

            // Resolve config path
            let configPath = config.checkstyleConfigPath.trim().replace(/[‪‫‎‏‬]/g, '');
            if (!configPath.startsWith('/')) {
                // Not a built-in config — resolve to absolute path
                if (!path.isAbsolute(configPath)) {
                    configPath = path.join(workspaceRoot, configPath);
                }
                configPath = path.normalize(configPath);

                if (!fs.existsSync(configPath)) {
                    const msg = `CheckStyle config file not found: ${configPath}`;
                    this.outputChannel.appendLine(msg);
                    errors.push(msg);
                    resolve({ violations: [], errors });
                    return;
                }
            }

            this.outputChannel.appendLine(`Config path: ${configPath}`);

            // Handle suppressions - copy to a temp working directory so CheckStyle can find it
            const checkstyleWorkDir = path.join(os.tmpdir(), `checkstyle-work-${Date.now()}`);
            fs.mkdirSync(checkstyleWorkDir, { recursive: true });

            if (config.checkstyleSuppressionsPath) {
                let suppressionsPath = config.checkstyleSuppressionsPath.trim();
                if (!path.isAbsolute(suppressionsPath)) {
                    suppressionsPath = path.join(workspaceRoot, suppressionsPath);
                }
                suppressionsPath = path.normalize(suppressionsPath);

                if (fs.existsSync(suppressionsPath)) {
                    const destPath = path.join(checkstyleWorkDir, 'suppressions.xml');
                    fs.copyFileSync(suppressionsPath, destPath);
                    this.outputChannel.appendLine(`Copied suppressions file to: ${destPath}`);
                } else {
                    this.outputChannel.appendLine(`Warning: Suppressions file not found: ${suppressionsPath}`);
                }
            }

            // Build args: java -jar <jarPath> -c <config> -f xml <files...>
            const baseArgs = ['-jar', jarPath, '-c', configPath, '-f', 'xml'];
            const allArgs = [...baseArgs, ...filePaths];

            const isWindows = process.platform === 'win32';
            let spawnCmd: string;
            let spawnArgs: string[];
            const spawnOptions: any = {
                cwd: checkstyleWorkDir
            };

            // Handle long command lines on Windows via @argfile
            const totalCmdLength = allArgs.reduce((sum, a) => sum + a.length + 3, 0);
            if (isWindows && totalCmdLength > 7000) {
                const argFilePath = path.join(os.tmpdir(), `checkstyle-args-${Date.now()}.txt`);
                const argFileContent = allArgs.map(a => {
                    const escaped = a.replace(/\\/g, '\\\\');
                    return escaped.includes(' ') ? `"${escaped}"` : escaped;
                }).join('\n');
                fs.writeFileSync(argFilePath, argFileContent, 'utf-8');
                spawnCmd = 'java';
                spawnArgs = [`@${argFilePath}`];
                this.outputChannel.appendLine(`Using @argfile due to long command (${totalCmdLength} chars): ${argFilePath}`);
            } else {
                spawnCmd = 'java';
                spawnArgs = allArgs;
            }

            this.outputChannel.appendLine(`Spawn: ${spawnCmd} ${spawnArgs.join(' ')}`);

            const checkstyleProcess = spawn(spawnCmd, spawnArgs, spawnOptions);
            let processTimedOut = false;

            const timeout = setTimeout(() => {
                processTimedOut = true;
                this.outputChannel.appendLine('CheckStyle process timed out after 5 minutes');
                checkstyleProcess.kill();
                errors.push('CheckStyle analysis timed out after 5 minutes');
                resolve({ violations: [], errors });
            }, 5 * 60 * 1000);

            let stdout = '';
            let stderr = '';
            let outputLineCount = 0;
            const maxOutputLines = 100;

            checkstyleProcess.stdout.on('data', (data) => {
                stdout += data.toString();
                if (outputLineCount < maxOutputLines) {
                    const lines = data.toString().trim().split('\n');
                    for (const line of lines) {
                        if (outputLineCount < maxOutputLines) {
                            this.outputChannel.appendLine(`CheckStyle: ${line}`);
                            outputLineCount++;
                        }
                    }
                } else if (outputLineCount === maxOutputLines) {
                    this.outputChannel.appendLine('... (output truncated for performance)');
                    outputLineCount++;
                }
            });

            checkstyleProcess.stderr.on('data', (data) => {
                stderr += data.toString();
                const lines = data.toString().trim().split('\n').slice(0, 20);
                for (const line of lines) {
                    this.outputChannel.appendLine(`CheckStyle stderr: ${line}`);
                }
            });

            checkstyleProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (processTimedOut) {
                    return;
                }

                this.outputChannel.appendLine(`CheckStyle exit code: ${code}`);

                // Exit code 0 = no violations, 1 = violations found (normal), >= 2 = error
                if (code !== null && code >= 2) {
                    errors.push(`CheckStyle exited with code ${code}: ${stderr}`);
                }

                try {
                    const violations = this.parseCheckStyleXmlOutput(stdout, filePaths);
                    this.outputChannel.appendLine(`Parsed ${violations.length} violations from XML output`);

                    // Print summary
                    if (violations.length > 0) {
                        this.outputChannel.appendLine(`\n========== CheckStyle 扫描结果汇总 ==========`);
                        const violationsByFile = this.groupViolationsByFile(violations);
                        for (const [filePath, fileViolations] of Object.entries(violationsByFile)) {
                            const relativePath = vscode.workspace.asRelativePath(filePath);
                            this.outputChannel.appendLine(`\n📁 ${relativePath}`);
                            for (const v of fileViolations) {
                                const severityLabel = v.severity === 'error' ? '🔴 错误' : v.severity === 'warning' ? '🟡 警告' : '🔵 提示';
                                this.outputChannel.appendLine(`   📍 第 ${v.line} 行 | ${v.source} - ${severityLabel}: ${v.message}`);
                            }
                        }
                        this.outputChannel.appendLine(`\n==========================================`);
                    }

                    this.updateDiagnostics(violations);
                    resolve({ violations, errors });
                } catch (parseError) {
                    reject(new Error(`Failed to parse CheckStyle output: ${parseError}`));
                }
            });

            checkstyleProcess.on('error', (error) => {
                clearTimeout(timeout);
                this.outputChannel.appendLine(`CheckStyle process error: ${error.message}`);
                reject(new Error(`Failed to run CheckStyle: ${error.message}. Make sure Java is installed and in PATH.`));
            });
        });
    }

    private unescapeXml(str: string): string {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    }

    private parseCheckStyleXmlOutput(xmlOutput: string, sourceFiles: string[]): CheckStyleViolation[] {
        const violations: CheckStyleViolation[] = [];

        if (!xmlOutput || xmlOutput.trim().length === 0) {
            this.outputChannel.appendLine('Empty XML output from CheckStyle');
            return violations;
        }

        this.outputChannel.appendLine(`Parsing CheckStyle XML (${xmlOutput.length} bytes)...`);

        const fileCount = (xmlOutput.match(/<file\s/g) || []).length;
        this.outputChannel.appendLine(`Found ${fileCount} <file> elements in XML`);

        // Match <file name="..."> ... </file>
        const fileRegex = /<file\s+name="([^"]*)">([\s\S]*?)<\/file>/g;
        const attrRegex = (name: string) => new RegExp(`${name}="([^"]*)"`);

        let fileMatch;
        while ((fileMatch = fileRegex.exec(xmlOutput)) !== null) {
            const rawFilePath = this.unescapeXml(fileMatch[1]);
            const fileContent = fileMatch[2];

            // Resolve to actual source file path
            const filePath = this.resolveFilePath(rawFilePath, sourceFiles);

            // Match <error line="..." column="..." severity="..." message="..." source="..." />
            const errorRegex = /<error\s+([\s\S]*?)\/>/g;
            let errorMatch;
            while ((errorMatch = errorRegex.exec(fileContent)) !== null) {
                const attrs = errorMatch[1];

                const lineMatch = attrs.match(attrRegex('line'));
                const columnMatch = attrs.match(attrRegex('column'));
                const severityMatch = attrs.match(attrRegex('severity'));
                const messageMatch = attrs.match(attrRegex('message'));
                const sourceMatch = attrs.match(attrRegex('source'));

                if (!lineMatch || !severityMatch || !messageMatch) {
                    continue;
                }

                const line = parseInt(lineMatch[1], 10) || 0;
                const column = columnMatch ? parseInt(columnMatch[1], 10) : 0;
                const severity = severityMatch[1] as 'error' | 'warning' | 'ignore';
                const message = this.unescapeXml(messageMatch[1]);
                const fullSource = sourceMatch ? this.unescapeXml(sourceMatch[1]) : 'unknown';
                // Extract short rule name from fully qualified class name
                const source = fullSource.split('.').pop() || fullSource;

                violations.push({
                    source,
                    severity,
                    message,
                    filePath,
                    line,
                    column
                });
            }
        }

        return violations;
    }

    private resolveFilePath(rawPath: string, sourceFiles: string[]): string {
        const normalized = rawPath.replace(/\\/g, '/');
        const matchingSource = sourceFiles.find(sf => {
            const normalizedSf = sf.replace(/\\/g, '/');
            return normalizedSf === normalized || normalizedSf.endsWith('/' + normalized) || normalizedSf.endsWith(normalized);
        });
        return matchingSource || rawPath;
    }

    public async generateReport(
        result: CheckStyleResult,
        outputPath: string,
        format: 'markdown' | 'html' | 'both' = 'both'
    ): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder open');
        }

        if (format === 'both' || format === 'markdown') {
            const mdPath = this.getReportPath(outputPath, 'md');
            const fullMdPath = path.isAbsolute(mdPath)
                ? mdPath
                : path.join(workspaceFolders[0].uri.fsPath, mdPath);

            const mdContent = this.generateMarkdownReport(result);
            await fs.promises.writeFile(fullMdPath, mdContent, 'utf-8');

            const doc = await vscode.workspace.openTextDocument(fullMdPath);
            await vscode.window.showTextDocument(doc);

            this.outputChannel.appendLine(`Markdown report generated: ${fullMdPath}`);
        }

        if (format === 'both' || format === 'html') {
            const htmlPath = this.getReportPath(outputPath, 'html');
            const fullHtmlPath = path.isAbsolute(htmlPath)
                ? htmlPath
                : path.join(workspaceFolders[0].uri.fsPath, htmlPath);

            const htmlContent = this.generateHtmlReport(result);
            await fs.promises.writeFile(fullHtmlPath, htmlContent, 'utf-8');

            this.outputChannel.appendLine(`HTML report generated: ${fullHtmlPath}`);

            if (format === 'both') {
                vscode.window.showInformationMessage(
                    'CheckStyle reports generated: Markdown and HTML',
                    'Open HTML'
                ).then(action => {
                    if (action === 'Open HTML') {
                        vscode.env.openExternal(vscode.Uri.file(fullHtmlPath));
                    }
                });
            }
        }
    }

    private getReportPath(outputPath: string, extension: string): string {
        const basePath = outputPath.replace(/\.(md|markdown|html|htm|json)$/i, '');
        return `${basePath}.${extension}`;
    }

    private generateMarkdownReport(result: CheckStyleResult): string {
        const now = new Date().toLocaleString();
        const errorCount = result.violations.filter(v => v.severity === 'error').length;
        const warningCount = result.violations.filter(v => v.severity === 'warning').length;
        const infoCount = result.violations.filter(v => v.severity === 'ignore').length;
        const violationsByFile = this.groupViolationsByFile(result.violations);

        let report = `# CheckStyle代码检查报告

**生成时间**: ${now}

## 检查结果汇总

| 指标 | 数值 |
|------|------|
| 检查文件数 | ${result.filesProcessed} |
| 发现问题数 | ${result.violations.length} |
| 错误 (Error) | ${errorCount} |
| 警告 (Warning) | ${warningCount} |
| 提示 (Info) | ${infoCount} |
| 执行时间 | ${(result.executionTime / 1000).toFixed(2)}s |

`;

        if (result.errors.length > 0) {
            report += `## 执行错误

`;
            for (const error of result.errors) {
                report += `- ${error}\n`;
            }
            report += `\n`;
        }

        if (result.violations.length > 0) {
            report += `## 详细问题列表

`;

            for (const [filePath, violations] of Object.entries(violationsByFile)) {
                const relativePath = vscode.workspace.asRelativePath(filePath);
                report += `### ${relativePath}

| 行号 | 列号 | 规则 | 级别 | 描述 |
|------|------|------|------|------|
`;
                for (const v of violations) {
                    const severityLabel = v.severity === 'error' ? '🔴 ERROR' :
                                         v.severity === 'warning' ? '🟡 WARNING' : '🔵 INFO';
                    report += `| ${v.line} | ${v.column} | ${v.source} | ${severityLabel} | ${v.message} |\n`;
                }
                report += `\n`;
            }
        } else {
            report += `## 检查结果

✅ 未发现代码问题！\n`;
        }

        return report;
    }

    private generateHtmlReport(result: CheckStyleResult): string {
        const now = new Date().toLocaleString();
        const errorCount = result.violations.filter(v => v.severity === 'error').length;
        const warningCount = result.violations.filter(v => v.severity === 'warning').length;
        const infoCount = result.violations.filter(v => v.severity === 'ignore').length;
        const violationsByFile = this.groupViolationsByFile(result.violations);

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>CheckStyle 代码检查报告</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        h2 { color: #444; border-bottom: 2px solid #4CAF50; padding-bottom: 5px; }
        h3 { color: #555; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .error { color: #d32f2f; }
        .warning { color: #f57c00; }
        .info { color: #1976d2; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .summary-card { background: white; padding: 15px; border-radius: 5px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .summary-card .number { font-size: 24px; font-weight: bold; }
        .summary-card .label { color: #666; font-size: 12px; }
        .error-card .number { color: #d32f2f; }
        .warning-card .number { color: #f57c00; }
        .info-card .number { color: #1976d2; }
    </style>
</head>
<body>
    <h1>CheckStyle 代码检查报告</h1>
    <p><strong>生成时间:</strong> ${now}</p>

    <div class="summary">
        <h2>检查结果汇总</h2>
        <div class="summary-grid">
            <div class="summary-card">
                <div class="number">${result.filesProcessed}</div>
                <div class="label">检查文件数</div>
            </div>
            <div class="summary-card error-card">
                <div class="number">${errorCount}</div>
                <div class="label">错误 (Error)</div>
            </div>
            <div class="summary-card warning-card">
                <div class="number">${warningCount}</div>
                <div class="label">警告 (Warning)</div>
            </div>
            <div class="summary-card info-card">
                <div class="number">${infoCount}</div>
                <div class="label">提示 (Info)</div>
            </div>
            <div class="summary-card">
                <div class="number">${result.violations.length}</div>
                <div class="label">总问题数</div>
            </div>
            <div class="summary-card">
                <div class="number">${(result.executionTime / 1000).toFixed(2)}s</div>
                <div class="label">执行时间</div>
            </div>
        </div>
    </div>
`;

        if (result.violations.length > 0) {
            html += `    <h2>详细问题列表</h2>\n`;

            for (const [filePath, violations] of Object.entries(violationsByFile)) {
                const relativePath = vscode.workspace.asRelativePath(filePath);
                html += `    <h3>${relativePath}</h3>
    <table>
        <tr>
            <th>行号</th>
            <th>列号</th>
            <th>规则</th>
            <th>级别</th>
            <th>描述</th>
        </tr>
`;
                for (const v of violations) {
                    const cssClass = v.severity === 'error' ? 'error' : v.severity === 'warning' ? 'warning' : 'info';
                    const severityLabel = v.severity === 'error' ? '错误' : v.severity === 'warning' ? '警告' : '提示';
                    html += `        <tr>
            <td>${v.line}</td>
            <td>${v.column}</td>
            <td>${v.source}</td>
            <td class="${cssClass}">${severityLabel}</td>
            <td>${v.message}</td>
        </tr>
`;
                }
                html += `    </table>\n`;
            }
        } else {
            html += `    <h2>检查结果</h2>
    <p style="color: green; font-size: 18px;">✅ 未发现代码问题！</p>\n`;
        }

        html += `</body>
</html>`;
        return html;
    }

    private updateDiagnostics(violations: CheckStyleViolation[]): void {
        if (!this.diagnosticCollection) {
            return;
        }

        this.diagnosticCollection.clear();

        const violationsByFile = this.groupViolationsByFile(violations);

        for (const [filePath, fileViolations] of Object.entries(violationsByFile)) {
            const diagnostics: vscode.Diagnostic[] = [];

            for (const v of fileViolations) {
                const line = Math.max(0, v.line - 1);
                const column = Math.max(0, v.column - 1);
                const range = new vscode.Range(line, column, line, 999);

                let severity: vscode.DiagnosticSeverity;
                if (v.severity === 'error') {
                    severity = vscode.DiagnosticSeverity.Error;
                } else if (v.severity === 'warning') {
                    severity = vscode.DiagnosticSeverity.Warning;
                } else {
                    severity = vscode.DiagnosticSeverity.Information;
                }

                const diagnostic = new vscode.Diagnostic(
                    range,
                    `${v.source}: ${v.message}`,
                    severity
                );
                diagnostic.code = v.source;
                diagnostic.source = 'CheckStyle';

                diagnostics.push(diagnostic);
            }

            if (diagnostics.length > 0) {
                this.diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
            }
        }

        this.outputChannel.appendLine(`Updated ${violations.length} diagnostics in Problems panel`);
    }

    private groupViolationsByFile(violations: CheckStyleViolation[]): Record<string, CheckStyleViolation[]> {
        const grouped: Record<string, CheckStyleViolation[]> = {};

        for (const v of violations) {
            if (!grouped[v.filePath]) {
                grouped[v.filePath] = [];
            }
            grouped[v.filePath].push(v);
        }

        for (const filePath in grouped) {
            grouped[filePath].sort((a, b) => a.line - b.line);
        }

        return grouped;
    }
}
