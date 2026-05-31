import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { PMDConfig } from './configService';

export interface PMDViolation {
    rule: string;
    ruleset: string;
    priority: number;
    message: string;
    filePath: string;
    line: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    description?: string;
    externalInfoUrl?: string;
}

export interface PMDResult {
    filesProcessed: number;
    violations: PMDViolation[];
    errors: string[];
    executionTime: number;
}

export class PMDService {
    private static instance: PMDService;
    private outputChannel: vscode.OutputChannel;
    private extensionPath: string = '';

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('PMD Checker');
    }

    public static getInstance(): PMDService {
        if (!PMDService.instance) {
            PMDService.instance = new PMDService();
        }
        return PMDService.instance;
    }

    public setExtensionPath(extensionPath: string): void {
        this.extensionPath = extensionPath;
        this.outputChannel.appendLine(`Extension path set: ${extensionPath}`);
    }

    public async checkFiles(
        filePaths: string[],
        config: PMDConfig,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<PMDResult> {
        const startTime = Date.now();
        
        if (!filePaths.length) {
            return {
                filesProcessed: 0,
                violations: [],
                errors: [],
                executionTime: 0
            };
        }

        // Validate ruleset path
        const rulesetValidation = await this.validateRulesetPath(config.rulesetPath);
        if (!rulesetValidation.valid) {
            throw new Error(`Invalid ruleset: ${rulesetValidation.message}`);
        }

        // Create temp file list
        const tempFileList = await this.createTempFileList(filePaths);
        
        try {
            progress?.report({ message: 'Running PMD check...' });
            
            const result = await this.runPMD(tempFileList, config);
            
            progress?.report({ message: 'Processing results...', increment: 20 });
            
            return {
                filesProcessed: filePaths.length,
                violations: result.violations,
                errors: result.errors,
                executionTime: Date.now() - startTime
            };
        } finally {
            // Clean up temp file
            try {
                await fs.promises.unlink(tempFileList);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    private async validateRulesetPath(rulesetPath: string): Promise<{ valid: boolean; message?: string }> {
        if (!rulesetPath) {
            return { valid: false, message: 'Ruleset path not configured' };
        }

        // Clean the path - remove any zero-width or invisible characters
        const cleanPath = rulesetPath.trim().replace(/[\u202A\u202B\u200E\u200F\u202C]/g, '');
        
        this.outputChannel.appendLine(`Validating ruleset path: ${cleanPath}`);
        this.outputChannel.appendLine(`Is absolute: ${path.isAbsolute(cleanPath)}`);
        this.outputChannel.appendLine(`Original path chars: ${[...rulesetPath].map(c => c.charCodeAt(0).toString(16)).join(' ')}`);

        let fullPath: string;
        if (path.isAbsolute(cleanPath)) {
            fullPath = cleanPath;
        } else {
            fullPath = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, cleanPath);
        }

        // Normalize path for Windows
        fullPath = path.normalize(fullPath);
        this.outputChannel.appendLine(`Full ruleset path: ${fullPath}`);

        try {
            await fs.promises.access(fullPath, fs.constants.F_OK);
            return { valid: true };
        } catch {
            return { valid: false, message: `Ruleset file not found: ${fullPath}` };
        }
    }

    private async createTempFileList(filePaths: string[]): Promise<string> {
        const tempDir = path.join(require('os').tmpdir(), 'java-code-checker');
        await fs.promises.mkdir(tempDir, { recursive: true });
        
        const tempFile = path.join(tempDir, `file-list-${Date.now()}.txt`);
        const content = filePaths.join('\n');
        await fs.promises.writeFile(tempFile, content, 'utf-8');
        
        return tempFile;
    }

    private async runPMD(
        fileListPath: string,
        config: PMDConfig
    ): Promise<{ violations: PMDViolation[]; errors: string[] }> {
        return new Promise((resolve, reject) => {
            const violations: PMDViolation[] = [];
            const errors: string[] = [];
            let stdout = '';
            let stderr = '';

            // Clean the path - remove any zero-width or invisible characters
            const cleanRulesetPath = config.rulesetPath.trim().replace(/[\u202A\u202B\u200E\u200F\u202C]/g, '');

            // Handle ruleset path - support both absolute and relative paths
            let rulesetFullPath: string;
            if (path.isAbsolute(cleanRulesetPath)) {
                rulesetFullPath = cleanRulesetPath;
            } else {
                rulesetFullPath = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, cleanRulesetPath);
            }

            // Normalize path for Windows
            rulesetFullPath = path.normalize(rulesetFullPath);

            this.outputChannel.appendLine(`Original ruleset path: ${config.rulesetPath}`);
            this.outputChannel.appendLine(`Cleaned ruleset path: ${cleanRulesetPath}`);
            this.outputChannel.appendLine(`Is absolute: ${path.isAbsolute(cleanRulesetPath)}`);
            this.outputChannel.appendLine(`Final ruleset path: ${rulesetFullPath}`);

            // Resolve PMD path - use bundled version if not configured or default 'pmd'
            let pmdPath = config.pmdPath.trim();
            const isWindows = process.platform === 'win32';

            if (!pmdPath || pmdPath === 'pmd') {
                // Try to use bundled PMD
                if (this.extensionPath) {
                    const bundledPmdPath = isWindows
                        ? path.join(this.extensionPath, 'resources', 'pmd-bin-7.22.0', 'bin', 'pmd.bat')
                        : path.join(this.extensionPath, 'resources', 'pmd-bin-7.22.0', 'bin', 'pmd');
                    if (fs.existsSync(bundledPmdPath)) {
                        pmdPath = bundledPmdPath;
                        this.outputChannel.appendLine(`Using bundled PMD: ${pmdPath}`);
                    } else {
                        this.outputChannel.appendLine(`Bundled PMD not found at: ${bundledPmdPath}, falling back to 'pmd' in PATH`);
                        pmdPath = 'pmd';
                    }
                }
            } else {
                this.outputChannel.appendLine(`Using configured PMD: ${pmdPath}`);
            }

            const args = [
                'check',
                '--file-list', fileListPath,
                '-R', rulesetFullPath,
                '-f', 'json',
                '--no-cache',
                '--fail-on-violation', 'false'
            ];

            this.outputChannel.appendLine(`Running: ${pmdPath} ${args.join(' ')}`);

            // Windows: use shell mode for .bat files
            const isBatFile = pmdPath.toLowerCase().endsWith('.bat') || pmdPath.toLowerCase().endsWith('.cmd');

            let spawnCmd: string;
            let spawnArgs: string[];
            let spawnOptions: any = {
                cwd: vscode.workspace.workspaceFolders![0].uri.fsPath
            };

            if (isWindows && isBatFile) {
                // For .bat files on Windows, use cmd /c
                spawnCmd = 'cmd';
                spawnArgs = ['/c', pmdPath, ...args];
                spawnOptions.shell = false;
            } else {
                spawnCmd = pmdPath;
                spawnArgs = args;
            }

            this.outputChannel.appendLine(`Spawn: ${spawnCmd} ${spawnArgs.join(' ')}`);

            const pmdProcess = spawn(spawnCmd, spawnArgs, spawnOptions);

            pmdProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pmdProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pmdProcess.on('close', (code) => {
                this.outputChannel.appendLine(`PMD exit code: ${code}`);
                
                if (stderr) {
                    this.outputChannel.appendLine(`PMD stderr: ${stderr}`);
                    errors.push(stderr);
                }

                try {
                    const parsedViolations = this.parsePMDOutput(stdout);
                    resolve({ violations: parsedViolations, errors });
                } catch (parseError) {
                    reject(new Error(`Failed to parse PMD output: ${parseError}`));
                }
            });

            pmdProcess.on('error', (error) => {
                reject(new Error(`Failed to run PMD: ${error.message}. Make sure PMD is installed and in PATH, or configure javaCodeChecker.pmdPath setting.`));
            });
        });
    }

    private parsePMDOutput(output: string): PMDViolation[] {
        try {
            const data = JSON.parse(output);
            const violations: PMDViolation[] = [];

            if (data.files && Array.isArray(data.files)) {
                for (const file of data.files) {
                    if (file.violations && Array.isArray(file.violations)) {
                        for (const v of file.violations) {
                            violations.push({
                                rule: v.rule,
                                ruleset: v.ruleset || 'Unknown',
                                priority: v.priority || 3,
                                message: v.description || v.message || '',
                                filePath: file.filename,
                                line: v.beginline || 1,
                                column: v.begincolumn,
                                endLine: v.endline,
                                endColumn: v.endcolumn,
                                description: v.description,
                                externalInfoUrl: v.externalInfoUrl
                            });
                        }
                    }
                }
            }

            return violations;
        } catch (error) {
            // Try to parse as text format if JSON parsing fails
            return this.parseTextOutput(output);
        }
    }

    private parseTextOutput(output: string): PMDViolation[] {
        const violations: PMDViolation[] = [];
        const lines = output.split('\n');
        
        // Simple text parsing - this is a fallback
        for (const line of lines) {
            const match = line.match(/^(.+):(\d+):\s+(.+)$/);
            if (match) {
                violations.push({
                    rule: 'Unknown',
                    ruleset: 'Unknown',
                    priority: 3,
                    message: match[3],
                    filePath: match[1],
                    line: parseInt(match[2], 10)
                });
            }
        }

        return violations;
    }

    public async generateReport(
        result: PMDResult,
        outputPath: string,
        format: 'markdown' | 'html' | 'json' | 'both' = 'both'
    ): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder open');
        }

        // Generate both Markdown and HTML reports
        if (format === 'both' || format === 'markdown') {
            const mdPath = this.getReportPath(outputPath, 'md');
            const fullMdPath = path.isAbsolute(mdPath)
                ? mdPath
                : path.join(workspaceFolders[0].uri.fsPath, mdPath);
            
            const mdContent = this.generateMarkdownReport(result);
            await fs.promises.writeFile(fullMdPath, mdContent, 'utf-8');
            
            // Open the Markdown report file
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
            
            // Show information message with HTML report location
            if (format === 'both') {
                vscode.window.showInformationMessage(
                    `Reports generated: Markdown and HTML`,
                    'Open HTML'
                ).then(action => {
                    if (action === 'Open HTML') {
                        vscode.env.openExternal(vscode.Uri.file(fullHtmlPath));
                    }
                });
            }
        }

        if (format === 'json') {
            const jsonPath = this.getReportPath(outputPath, 'json');
            const fullJsonPath = path.isAbsolute(jsonPath)
                ? jsonPath
                : path.join(workspaceFolders[0].uri.fsPath, jsonPath);
            
            const jsonContent = JSON.stringify(result, null, 2);
            await fs.promises.writeFile(fullJsonPath, jsonContent, 'utf-8');
            
            const doc = await vscode.workspace.openTextDocument(fullJsonPath);
            await vscode.window.showTextDocument(doc);
        }
    }

    private getReportPath(outputPath: string, extension: string): string {
        // Remove existing extension if any
        const basePath = outputPath.replace(/\.(md|markdown|html|htm|json)$/i, '');
        return `${basePath}.${extension}`;
    }

    private generateMarkdownReport(result: PMDResult): string {
        const now = new Date().toLocaleString();
        const violationsByFile = this.groupViolationsByFile(result.violations);
        
        let report = `# PMD代码检查报告

**生成时间**: ${now}

## 检查结果汇总

| 指标 | 数值 |
|------|------|
| 检查文件数 | ${result.filesProcessed} |
| 发现问题数 | ${result.violations.length} |
| 严重错误 (Priority 1-2) | ${result.violations.filter(v => v.priority <= 2).length} |
| 警告 (Priority 3) | ${result.violations.filter(v => v.priority === 3).length} |
| 建议 (Priority 4-5) | ${result.violations.filter(v => v.priority >= 4).length} |
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

| 行号 | 规则 | 级别 | 描述 |
|------|------|------|------|
`;
                for (const v of violations) {
                    const priorityLabel = v.priority <= 2 ? '🔴 ERROR' : 
                                         v.priority === 3 ? '🟡 WARNING' : '🔵 INFO';
                    report += `| ${v.line} | ${v.rule} | ${priorityLabel} | ${v.message} |\n`;
                }
                report += `\n`;
            }
        } else {
            report += `## 检查结果

✅ 未发现代码问题！\n`;
        }

        return report;
    }

    private generateHtmlReport(result: PMDResult): string {
        const now = new Date().toLocaleString();
        const violationsByFile = this.groupViolationsByFile(result.violations);

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PMD Code Check Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .error { color: #d32f2f; }
        .warning { color: #f57c00; }
        .info { color: #1976d2; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>PMD代码检查报告</h1>
    <p><strong>生成时间:</strong> ${now}</p>
    
    <div class="summary">
        <h2>检查结果汇总</h2>
        <p>检查文件数: ${result.filesProcessed}</p>
        <p>发现问题数: ${result.violations.length}</p>
        <p>执行时间: ${(result.executionTime / 1000).toFixed(2)}s</p>
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
            <th>规则</th>
            <th>级别</th>
            <th>描述</th>
        </tr>
`;
                for (const v of violations) {
                    const cssClass = v.priority <= 2 ? 'error' : v.priority === 3 ? 'warning' : 'info';
                    html += `        <tr>
            <td>${v.line}</td>
            <td>${v.rule}</td>
            <td class="${cssClass}">Priority ${v.priority}</td>
            <td>${v.message}</td>
        </tr>
`;
                }
                html += `    </table>\n`;
            }
        }

        html += `</body>
</html>`;
        return html;
    }

    private groupViolationsByFile(violations: PMDViolation[]): Record<string, PMDViolation[]> {
        const grouped: Record<string, PMDViolation[]> = {};
        
        for (const v of violations) {
            if (!grouped[v.filePath]) {
                grouped[v.filePath] = [];
            }
            grouped[v.filePath].push(v);
        }

        // Sort violations by line number within each file
        for (const filePath in grouped) {
            grouped[filePath].sort((a, b) => a.line - b.line);
        }

        return grouped;
    }
}
