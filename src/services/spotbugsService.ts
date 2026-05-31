import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SpotBugsConfig } from './configService';

export interface SpotBugsBug {
    type: string;
    category: string;
    priority: number;
    message: string;
    filePath: string;
    relativePath: string;
    line: number;
}

export interface SpotBugsResult {
    filesProcessed: number;
    bugs: SpotBugsBug[];
    errors: string[];
    executionTime: number;
}

export class SpotBugsService {
    private static instance: SpotBugsService;
    private outputChannel: vscode.OutputChannel;
    private extensionPath: string = '';
    private diagnosticCollection: vscode.DiagnosticCollection | undefined;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('SpotBugs Checker');
    }

    public setDiagnosticCollection(collection: vscode.DiagnosticCollection): void {
        this.diagnosticCollection = collection;
    }

    public clearDiagnostics(): void {
        this.diagnosticCollection?.clear();
    }

    public static getInstance(): SpotBugsService {
        if (!SpotBugsService.instance) {
            SpotBugsService.instance = new SpotBugsService();
        }
        return SpotBugsService.instance;
    }

    public setExtensionPath(extensionPath: string): void {
        this.extensionPath = extensionPath;
        this.outputChannel.appendLine(`Extension path set: ${extensionPath}`);
    }

    public async checkFiles(
        filePaths: string[],
        config: SpotBugsConfig,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<SpotBugsResult> {
        const startTime = Date.now();
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`\n========== SpotBugs Check Started ==========`);
        this.outputChannel.appendLine(`Files to analyze: ${filePaths.length}`);
        filePaths.forEach(f => this.outputChannel.appendLine(`  - ${f}`));
        this.outputChannel.appendLine(`EnableFindSecBugs: ${config.enableFindSecBugs}`);
        this.outputChannel.appendLine(`SpotBugs path: ${config.spotbugsPath || '(bundled)'}`);

        if (!filePaths.length) {
            this.outputChannel.appendLine('No files to analyze, aborting.');
            return {
                filesProcessed: 0,
                bugs: [],
                errors: [],
                executionTime: 0
            };
        }

        const spotbugsPath = config.spotbugsPath || '';
        const spotbugsValidation = await this.validateSpotBugsPath(spotbugsPath);
        if (!spotbugsValidation.valid) {
            throw new Error(`Invalid SpotBugs path: ${spotbugsValidation.message}`);
        }

        try {
            progress?.report({ message: 'Running SpotBugs check...' });
            const result = await this.runSpotBugs(filePaths, config);
            progress?.report({ message: 'Processing SpotBugs results...', increment: 20 });

            return {
                filesProcessed: filePaths.length,
                bugs: result.bugs,
                errors: result.errors,
                executionTime: Date.now() - startTime
            };
        } catch (error) {
            this.outputChannel.appendLine(`SpotBugs check error: ${error}`);
            throw new Error(`SpotBugs check failed: ${error}`);
        }
    }

    private async validateSpotBugsPath(spotbugsPath: string): Promise<{ valid: boolean; message?: string }> {
        if (!spotbugsPath) {
            return { valid: true };
        }
        return { valid: true };
    }

    private async runSpotBugs(
        filePaths: string[],
        config: SpotBugsConfig
    ): Promise<{ bugs: SpotBugsBug[]; errors: string[] }> {
        return new Promise((resolve, reject) => {
            const bugs: SpotBugsBug[] = [];
            const errors: string[] = [];
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                reject(new Error('No workspace folder open'));
                return;
            }
            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            let spotbugsPath = config.spotbugsPath || '';
            let spotbugsInstalled = false;

            if (!spotbugsPath) {
                this.outputChannel.appendLine('Looking for bundled SpotBugs...');
                if (this.extensionPath) {
                    const bundledSpotBugsPath = path.join(
                        this.extensionPath, 
                        'resources', 
                        'spotbugs-4.9.8', 
                        'bin', 
                        'spotbugs.bat'
                    );
                    if (fs.existsSync(bundledSpotBugsPath)) {
                        spotbugsPath = bundledSpotBugsPath;
                        spotbugsInstalled = true;
                        this.outputChannel.appendLine(`Using bundled SpotBugs: ${spotbugsPath}`);
                    } else {
                        this.outputChannel.appendLine(`Bundled SpotBugs not found at: ${bundledSpotBugsPath}`);
                    }
                }
            } else {
                spotbugsInstalled = true;
                this.outputChannel.appendLine(`Using configured SpotBugs: ${spotbugsPath}`);
            }

            if (!spotbugsInstalled) {
                this.outputChannel.appendLine('SpotBugs not found. Please install from https://spotbugs.github.io/');
                errors.push('SpotBugs not found. Please install from https://spotbugs.github.io/');
                resolve({ bugs: [], errors });
                return;
            }

            const tempOutputFile = path.join(os.tmpdir(), `spotbugs-result-${Date.now()}.xml`);
            const argFile = path.join(os.tmpdir(), `spotbugs-args-${Date.now()}.txt`);

            const possibleOutputDirs = [
                path.join(workspaceRoot, 'target', 'classes'),
                path.join(workspaceRoot, 'build', 'classes', 'java', 'main'),
                path.join(workspaceRoot, 'build', 'classes'),
                path.join(workspaceRoot, 'bin'),
                path.join(workspaceRoot, 'out', 'production'),
                path.join(workspaceRoot, 'out'),
                workspaceRoot
            ];

            this.outputChannel.appendLine(`Workspace root: ${workspaceRoot}`);
            for (let i = 0; i < possibleOutputDirs.length; i++) {
                this.outputChannel.appendLine(`  [${i}] ${possibleOutputDirs[i]} - Exists: ${fs.existsSync(possibleOutputDirs[i])}`);
            }

            const classFilePaths: string[] = [];
            for (const javaFile of filePaths) {
                const relativeJavaPath = path.relative(workspaceRoot, javaFile);
                const normalizedPath = relativeJavaPath.replace(/\\/g, '/');

                // Strip src/main/java or src/test/java from path (works for both single and multi-module projects)
                // e.g. "cops-common/src/main/java/com/example/Foo.java" -> "com/example/Foo.java"
                let cleanPath = normalizedPath;
                const srcJavaIndex = cleanPath.indexOf('/src/main/java/');
                const srcTestIndex = cleanPath.indexOf('/src/test/java/');
                const srcIdx = srcJavaIndex >= 0 ? srcJavaIndex : srcTestIndex;
                if (srcIdx >= 0) {
                    cleanPath = cleanPath.substring(srcIdx + '/src/main/java/'.length);
                } else if (cleanPath.startsWith('src/main/java/') || cleanPath.startsWith('src/test/java/')) {
                    cleanPath = cleanPath.substring(cleanPath.indexOf('/', 4) + 1);
                }

                const classFileName = path.basename(cleanPath, '.java') + '.class';
                const packageDir = path.dirname(cleanPath).replace(/\\/g, '/');

                this.outputChannel.appendLine(`Looking for class file for: ${relativeJavaPath}`);
                this.outputChannel.appendLine(`  Package dir: ${packageDir}, Class file: ${classFileName}`);

                // Build module-specific search paths for multi-module Maven projects
                const searchDirs = [...possibleOutputDirs];
                if (srcIdx > 0) {
                    const moduleRelativeDir = normalizedPath.substring(0, srcIdx);
                    searchDirs.unshift(
                        path.join(workspaceRoot, moduleRelativeDir, 'target', 'classes'),
                        path.join(workspaceRoot, moduleRelativeDir, 'build', 'classes', 'java', 'main'),
                        path.join(workspaceRoot, moduleRelativeDir, 'bin')
                    );
                }

                let found = false;
                for (const outputDir of searchDirs) {
                    const possibleClassPath = path.join(outputDir, packageDir, classFileName);
                    if (fs.existsSync(possibleClassPath)) {
                        classFilePaths.push(possibleClassPath);
                        this.outputChannel.appendLine(`  Found: ${possibleClassPath}`);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    this.outputChannel.appendLine(`  NOT found in any search directory`);
                }
            }

            if (classFilePaths.length === 0) {
                this.outputChannel.appendLine('No compiled .class files found for the selected Java files.');
                this.outputChannel.appendLine('Please build your project first (e.g., mvn compile, gradle build)');
                errors.push('No compiled .class files found. Please build your project first (e.g., mvn compile, gradle build).');
                resolve({ bugs: [], errors });
                return;
            }

            this.outputChannel.appendLine(`Found ${classFilePaths.length} compiled class files`);

            const priorityArg = config.spotbugsMinPriority === 'high' ? '-high' :
                               config.spotbugsMinPriority === 'medium' ? '-medium' : '-low';

            const args: string[] = [
                '-textui',
                '-xml',
                '-output', tempOutputFile,
                '-effort:max',
                priorityArg
            ];

            // Track whether to use FindSecBugs CLI (java -cp findsecbugs-cli/lib/*) instead of spotbugs.bat
            // This is necessary because findsecbugs-plugin-1.14.0.jar was built against spotbugs-4.9.3,
            // and loading it via spotbugs-4.9.8 causes API incompatibility (silent plugin failure).
            let useFindSecBugsCLI = false;
            let findSecBugsClasspath = '';

            if (config.enableFindSecBugs && this.extensionPath) {
                const findSecBugsCliLibDir = path.join(
                    this.extensionPath,
                    'resources',
                    'findsecbugs-cli-1.14.0',
                    'lib'
                );
                const findSecBugsPluginPath = path.join(findSecBugsCliLibDir, 'findsecbugs-plugin-1.14.0.jar');

                if (fs.existsSync(findSecBugsPluginPath) && fs.existsSync(findSecBugsCliLibDir)) {
                    // Use Java classpath wildcard (lib/*) - JVM expands it internally, avoids ENAMETOOLONG
                    findSecBugsClasspath = path.join(findSecBugsCliLibDir, '*');
                    useFindSecBugsCLI = true;
                    args.push('-pluginList', findSecBugsPluginPath);
                    this.outputChannel.appendLine(`Using FindSecBugs CLI: ${findSecBugsPluginPath}`);
                    this.outputChannel.appendLine(`FindSecBugs classpath: ${findSecBugsClasspath}`);
                }

                if (!useFindSecBugsCLI) {
                    // Fallback: try bundled plugin with spotbugs (may have compatibility issues)
                    const bundledPluginPath = path.join(this.extensionPath, 'resources', 'findsecbugs-plugin.jar');
                    if (fs.existsSync(bundledPluginPath)) {
                        args.push('-pluginList', bundledPluginPath);
                        this.outputChannel.appendLine(`Using bundled FindSecBugs plugin (fallback): ${bundledPluginPath}`);
                    } else {
                        this.outputChannel.appendLine('FindSecBugs plugin not found, running with default SpotBugs detectors');
                    }
                }
            }

            // Instead of passing entire directories (which would analyze ALL classes),
            // pass only the specific .class files corresponding to the selected Java files
            this.outputChannel.appendLine(`Will analyze ${classFilePaths.length} specific class files (not entire directories)`);

            args.push('-sourcepath', path.join(workspaceRoot, 'src', 'main', 'java'));

            let auxClasspath = '';
            const possibleLibDirs = [
                path.join(workspaceRoot, 'target', 'lib'),
                path.join(workspaceRoot, 'target', 'dependency'),
                path.join(workspaceRoot, 'lib'),
                path.join(workspaceRoot, 'libs'),
                path.join(workspaceRoot, 'build', 'libs'),
                path.join(workspaceRoot, 'WEB-INF', 'lib')
            ];

            for (const libDir of possibleLibDirs) {
                if (fs.existsSync(libDir)) {
                    try {
                        const files = fs.readdirSync(libDir);
                        const jars = files.filter(f => f.endsWith('.jar'));
                        if (jars.length > 0) {
                            auxClasspath = jars.map(j => path.join(libDir, j)).join(path.delimiter);
                            this.outputChannel.appendLine(`Found ${jars.length} jars in ${libDir}`);
                            break;
                        }
                    } catch {
                        // Ignore errors reading directory
                    }
                }
            }

            if (!auxClasspath) {
                const pomPath = path.join(workspaceRoot, 'pom.xml');
                if (fs.existsSync(pomPath)) {
                    try {
                        const { execSync } = require('child_process');
                        this.outputChannel.appendLine('Trying to get Maven dependencies classpath...');
                        const mvnOutput = execSync(
                            'mvn dependency:build-classpath -DincludeScope=compile -Dmdep.outputFile=/dev/stdout -q',
                            { cwd: workspaceRoot, encoding: 'utf-8', timeout: 60000 }
                        );
                        if (mvnOutput && mvnOutput.trim()) {
                            auxClasspath = mvnOutput.trim();
                            this.outputChannel.appendLine(`Got Maven classpath with ${auxClasspath.split(path.delimiter).length} entries`);
                        }
                    } catch (mvnError) {
                        this.outputChannel.appendLine(`Failed to get Maven classpath: ${mvnError}`);
                    }
                }
            }

            if (auxClasspath) {
                args.push('-auxclasspath', auxClasspath);
                this.outputChannel.appendLine(`Using auxiliary classpath with ${auxClasspath.split(path.delimiter).length} jars`);
            } else {
                this.outputChannel.appendLine('Warning: No dependency jars found. Analysis may have missing class warnings.');
            }

            args.push(...classFilePaths);

            const isWindows = process.platform === 'win32';
            const isBatFile = spotbugsPath.toLowerCase().endsWith('.bat') || spotbugsPath.toLowerCase().endsWith('.cmd');

            let spawnCmd: string;
            let spawnArgs: string[];
            const spawnOptions: any = {
                cwd: workspaceRoot
            };

            if (useFindSecBugsCLI) {
                // Use java -cp <findsecbugs-cli/lib/*> LaunchAppropriateUI to ensure plugin compatibility
                // findsecbugs-plugin-1.14.0.jar was built against spotbugs-4.9.3 (in the CLI lib),
                // so we must run it with that same spotbugs version, not spotbugs-4.9.8.
                spawnCmd = 'java';
                const allJavaArgs = ['-cp', findSecBugsClasspath, 'edu.umd.cs.findbugs.LaunchAppropriateUI', ...args];
                const totalCmdLength = allJavaArgs.reduce((sum, a) => sum + a.length + 3, 0);

                if (isWindows && totalCmdLength > 8000) {
                    // Use Java @argfile feature (Java 9+) to avoid ENAMETOOLONG
                    const javaArgFile = path.join(os.tmpdir(), `spotbugs-java-args-${Date.now()}.txt`);
                    const argFileContent = allJavaArgs.map(a => {
                        // Java argfile: backslashes must be doubled; paths with spaces must be quoted
                        const escaped = a.replace(/\\/g, '\\\\');
                        return escaped.includes(' ') ? `"${escaped}"` : escaped;
                    }).join('\n');
                    fs.writeFileSync(javaArgFile, argFileContent, 'utf-8');
                    spawnArgs = [`@${javaArgFile}`];
                    this.outputChannel.appendLine(`Using Java @argfile due to long command (${totalCmdLength} chars): ${javaArgFile}`);
                } else {
                    spawnArgs = allJavaArgs;
                }
                this.outputChannel.appendLine(`Using FindSecBugs CLI: java -cp <findsecbugs-cli/lib/*> LaunchAppropriateUI`);
            } else {
                const argsStr = args.map(a => a.includes(' ') ? `"${a}"` : a).join('\n');
                const totalCmdLength = spotbugsPath.length + args.reduce((sum, a) => sum + a.length + 3, 0);

                if (isWindows && totalCmdLength > 8000) {
                    try {
                        fs.writeFileSync(argFile, argsStr, 'utf-8');
                        this.outputChannel.appendLine(`Using arg file due to long command line (${totalCmdLength} chars)`);

                        if (isBatFile) {
                            spawnCmd = 'cmd';
                            spawnArgs = ['/c', spotbugsPath, '@' + argFile];
                            spawnOptions.shell = false;
                        } else {
                            spawnCmd = spotbugsPath;
                            spawnArgs = ['@' + argFile];
                        }
                    } catch (writeError) {
                        this.outputChannel.appendLine(`Failed to write arg file: ${writeError}`);
                        if (isWindows && isBatFile) {
                            spawnCmd = 'cmd';
                            spawnArgs = ['/c', spotbugsPath, ...args];
                            spawnOptions.shell = false;
                        } else {
                            spawnCmd = spotbugsPath;
                            spawnArgs = args;
                        }
                    }
                } else {
                    if (isWindows && isBatFile) {
                        spawnCmd = 'cmd';
                        spawnArgs = ['/c', spotbugsPath, ...args];
                        spawnOptions.shell = false;
                    } else {
                        spawnCmd = spotbugsPath;
                        spawnArgs = args;
                    }
                }
            }

            this.outputChannel.appendLine(`Spawn: ${spawnCmd} ${spawnArgs.join(' ')}`);

            const spotbugsProcess = spawn(spawnCmd, spawnArgs, spawnOptions);
            let processTimedOut = false;

            const timeout = setTimeout(() => {
                processTimedOut = true;
                this.outputChannel.appendLine('SpotBugs process timed out after 5 minutes');
                spotbugsProcess.kill();
                errors.push('SpotBugs analysis timed out after 5 minutes');
                resolve({ bugs: [], errors });
            }, 5 * 60 * 1000);

            let outputLineCount = 0;
            const maxOutputLines = 100;

            spotbugsProcess.stdout.on('data', (data) => {
                const str = data.toString();
                if (outputLineCount < maxOutputLines) {
                    const lines = str.trim().split('\n');
                    for (const line of lines) {
                        if (outputLineCount < maxOutputLines) {
                            this.outputChannel.appendLine(`SpotBugs: ${line}`);
                            outputLineCount++;
                        }
                    }
                } else if (outputLineCount === maxOutputLines) {
                    this.outputChannel.appendLine('... (output truncated for performance)');
                    outputLineCount++;
                }
            });

            spotbugsProcess.stderr.on('data', (data) => {
                const str = data.toString();
                const lines = str.trim().split('\n').slice(0, 20);
                for (const line of lines) {
                    this.outputChannel.appendLine(`SpotBugs stderr: ${line}`);
                }
            });

            spotbugsProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (processTimedOut) {
                    return;
                }

                this.outputChannel.appendLine(`SpotBugs exit code: ${code}`);
                if (code !== 0 && code !== null) {
                    errors.push(`SpotBugs exited with code ${code}`);
                }

                try {
                    if (fs.existsSync(tempOutputFile)) {
                        const xmlContent = fs.readFileSync(tempOutputFile, 'utf-8');
                        this.outputChannel.appendLine(`XML output file size: ${xmlContent.length} bytes`);
                        
                        if (xmlContent.length > 0) {
                            this.outputChannel.appendLine(`XML preview: ${xmlContent.substring(0, 2000)}`);
                        }
                        
                        const parsedBugs = this.parseSpotBugsXml(xmlContent, filePaths);
                        this.outputChannel.appendLine(`Parsed ${parsedBugs.length} bugs from XML`);
                        
                        try {
                            fs.unlinkSync(tempOutputFile);
                        } catch {
                            // Ignore cleanup errors
                        }
                        
                        resolve({ bugs: parsedBugs, errors });
                    } else {
                        this.outputChannel.appendLine('XML output file not found');
                        resolve({ bugs: [], errors });
                    }
                } catch (parseError) {
                    reject(new Error(`Failed to parse SpotBugs output: ${parseError}`));
                }
            });

            spotbugsProcess.on('error', (error) => {
                clearTimeout(timeout);
                this.outputChannel.appendLine(`SpotBugs process error: ${error.message}`);
                reject(new Error(`Failed to run SpotBugs: ${error.message}. Make sure Java is installed and in PATH.`));
            });
        });
    }

    private parseSpotBugsXml(xmlContent: string, sourceFiles: string[]): SpotBugsBug[] {
        const bugs: SpotBugsBug[] = [];
        
        this.outputChannel.appendLine(`Parsing SpotBugs XML (${xmlContent.length} bytes)...`);
        
        const bugInstanceCount = (xmlContent.match(/<BugInstance/g) || []).length;
        this.outputChannel.appendLine(`Found ${bugInstanceCount} BugInstance elements in XML`);
        
        // Attributes can appear in any order in XML, so match the whole opening tag first
        const bugInstanceRegex = /<BugInstance\b([^>]*)>([\s\S]*?)<\/BugInstance>/g;
        const attrRegex = (name: string) => new RegExp(`${name}="([^"]+)"`);
        const shortMessageRegex = /<ShortMessage>([^<]*)<\/ShortMessage>/;
        // SpotBugs XML uses start/end attributes (not line), and sourcepath gives the package-based path
        // NOTE: [^/]* would stop at the first '/' inside attribute values like sourcepath="com/example/Foo.java"
        // so we use a lazy match up to the self-closing '/>'
        const sourceLineTagRegex = /<SourceLine\b([\s\S]*?)\/>/g;

        let match;
        let parsedCount = 0;

        while ((match = bugInstanceRegex.exec(xmlContent)) !== null) {
            const attrs = match[1];
            const typeMatch = attrs.match(attrRegex('type'));
            const priorityMatch = attrs.match(attrRegex('priority'));
            const categoryMatch = attrs.match(attrRegex('category'));
            if (!typeMatch || !priorityMatch || !categoryMatch) { continue; }
            const type = typeMatch[1];
            const priority = parseInt(priorityMatch[1], 10);
            const category = categoryMatch[1];
            const bugContent = match[0];

            const shortMessageMatch = bugContent.match(shortMessageRegex);
            const message = shortMessageMatch ? shortMessageMatch[1] : type;

            // Parse all SourceLine tags; prefer the one marked primary="true"
            let filePath = '';
            let line = 0;
            let bestSourceLineAttrs = '';
            sourceLineTagRegex.lastIndex = 0;
            let slMatch: RegExpExecArray | null;
            while ((slMatch = sourceLineTagRegex.exec(bugContent)) !== null) {
                const slAttrs = slMatch[1];
                if (!bestSourceLineAttrs || /primary="true"/.test(slAttrs)) {
                    bestSourceLineAttrs = slAttrs;
                }
            }
            if (bestSourceLineAttrs) {
                const sfMatch = bestSourceLineAttrs.match(/sourcefile="([^"]+)"/);
                const spMatch = bestSourceLineAttrs.match(/sourcepath="([^"]+)"/);
                const startMatch = bestSourceLineAttrs.match(/start="([^"]+)"/);
                line = startMatch ? (parseInt(startMatch[1], 10) || 0) : 0;
                const sourceFile = sfMatch ? sfMatch[1] : '';
                const sourcePath = spMatch ? spMatch[1] : '';
                if (sourceFile) {
                    const normalizedSourcePath = sourcePath.replace(/\\/g, '/');
                    const matchingSource = sourceFiles.find(sf => {
                        const normalizedSf = sf.replace(/\\/g, '/');
                        return (normalizedSourcePath && normalizedSf.endsWith(normalizedSourcePath)) ||
                               normalizedSf.endsWith('/' + sourceFile) ||
                               path.basename(sf) === sourceFile;
                    });
                    filePath = matchingSource || sourceFile;
                }
            }
            
            const priorityLabel = priority === 1 ? '🔴 高危' : priority === 2 ? '🟡 中危' : '🟢 低危';
            const relativePath = filePath ? vscode.workspace.asRelativePath(filePath) : '未知文件';
            this.outputChannel.appendLine(
                `📄 ${relativePath}:${line} | [${category}] ${type} - ${priorityLabel}: ${message}`
            );

            bugs.push({
                type,
                category,
                priority,
                message,
                filePath,
                relativePath,
                line
            });
            parsedCount++;
        }
        
        this.outputChannel.appendLine(`Successfully parsed ${parsedCount} bugs from XML`);

        const categories = new Set(bugs.map(b => b.category));
        this.outputChannel.appendLine(`Bug categories found: ${Array.from(categories).join(', ')}`);

        // 汇总输出所有 bug 的文件位置
        if (bugs.length > 0) {
            this.outputChannel.appendLine(`\n========== SpotBugs 扫描结果汇总 ==========`);
            const bugsByFile = this.groupBugsByFile(bugs);
            for (const [filePath, fileBugs] of Object.entries(bugsByFile)) {
                const relativePath = vscode.workspace.asRelativePath(filePath);
                this.outputChannel.appendLine(`\n📁 ${relativePath}`);
                for (const b of fileBugs) {
                    const priorityLabel = b.priority === 1 ? '🔴 高危' : b.priority === 2 ? '🟡 中危' : '🟢 低危';
                    this.outputChannel.appendLine(`   📍 第 ${b.line} 行 | [${b.category}] ${b.type} - ${priorityLabel}: ${b.message}`);
                }
            }
            this.outputChannel.appendLine(`\n==========================================`);
        }

        // 更新 VS Code 问题面板中的诊断信息
        this.updateDiagnostics(bugs);

        return bugs;
    }

    public async generateReport(
        result: SpotBugsResult,
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
                    'SpotBugs reports generated: Markdown and HTML',
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

    private generateMarkdownReport(result: SpotBugsResult): string {
        const now = new Date().toLocaleString();
        const securityBugs = result.bugs.filter(b => b.category === 'SECURITY');
        const otherBugs = result.bugs.filter(b => b.category !== 'SECURITY');
        
        let report = `# SpotBugs / FindSecurityBugs 代码检查报告

**生成时间**: ${now}
**扫描模式**: SpotBugs 4.9.8 + FindSecurityBugs 1.14.0

## 检查结果汇总

| 指标 | 数值 |
|------|------|
| 分析文件数 | ${result.filesProcessed} |
| 安全漏洞 (SECURITY) | ${securityBugs.length} |
| 代码缺陷 | ${otherBugs.length} |
| 高危 (Priority 1) | ${result.bugs.filter(b => b.priority === 1).length} |
| 中危 (Priority 2) | ${result.bugs.filter(b => b.priority === 2).length} |
| 低危 (Priority 3) | ${result.bugs.filter(b => b.priority >= 3).length} |
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

        if (securityBugs.length > 0) {
            report += `## 安全漏洞 (FindSecurityBugs)

`;
            const securityByFile = this.groupBugsByFile(securityBugs);
            for (const [filePath, bugs] of Object.entries(securityByFile)) {
                const relativePath = vscode.workspace.asRelativePath(filePath);
                report += `### ${relativePath}

| 行号 | Bug类型 | 级别 | 描述 |
|------|---------|------|------|
`;
                for (const b of bugs) {
                    const priorityLabel = b.priority === 1 ? '🔴 高危' : 
                                         b.priority === 2 ? '🟡 中危' : '🟢 低危';
                    report += `| ${b.line} | ${b.type} | ${priorityLabel} | ${b.message} |\n`;
                }
                report += `\n`;
            }
        }

        if (otherBugs.length > 0) {
            report += `## 代码缺陷 (SpotBugs)

`;
            const categoryOrder = ['CORRECTNESS', 'PERFORMANCE', 'STYLE', 'BAD_PRACTICE', 'MT_CORRECTNESS'];
            const bugsByCategory = this.groupBugsByCategory(otherBugs);
            
            for (const category of categoryOrder) {
                if (bugsByCategory[category] && bugsByCategory[category].length > 0) {
                    report += `### ${category}\n\n`;
                    const categoryByFile = this.groupBugsByFile(bugsByCategory[category]);
                    
                    for (const [filePath, bugs] of Object.entries(categoryByFile)) {
                        const relativePath = vscode.workspace.asRelativePath(filePath);
                        report += `#### ${relativePath}

| 行号 | Bug类型 | 类别 | 级别 | 描述 |
|------|---------|------|------|------|
`;
                        for (const b of bugs) {
                            const priorityLabel = b.priority === 1 ? '🔴 高' : 
                                                 b.priority === 2 ? '🟡 中' : '🟢 低';
                            report += `| ${b.line} | ${b.type} | ${b.category} | ${priorityLabel} | ${b.message} |\n`;
                        }
                        report += `\n`;
                    }
                }
            }
            
            const otherCategories = Object.keys(bugsByCategory).filter(c => !categoryOrder.includes(c));
            for (const category of otherCategories) {
                if (bugsByCategory[category].length > 0) {
                    report += `### ${category}\n\n`;
                    const categoryByFile = this.groupBugsByFile(bugsByCategory[category]);
                    
                    for (const [filePath, bugs] of Object.entries(categoryByFile)) {
                        const relativePath = vscode.workspace.asRelativePath(filePath);
                        report += `#### ${relativePath}

| 行号 | Bug类型 | 类别 | 级别 | 描述 |
|------|---------|------|------|------|
`;
                        for (const b of bugs) {
                            const priorityLabel = b.priority === 1 ? '🔴 高' : 
                                                 b.priority === 2 ? '🟡 中' : '🟢 低';
                            report += `| ${b.line} | ${b.type} | ${b.category} | ${priorityLabel} | ${b.message} |\n`;
                        }
                        report += `\n`;
                    }
                }
            }
        }

        if (result.bugs.length === 0) {
            report += `## 检查结果

✅ 未发现代码问题！\n`;
        }

        return report;
    }

    private generateHtmlReport(result: SpotBugsResult): string {
        const now = new Date().toLocaleString();
        const securityBugs = result.bugs.filter(b => b.category === 'SECURITY');
        const otherBugs = result.bugs.filter(b => b.category !== 'SECURITY');

        let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>SpotBugs / FindSecurityBugs 代码检查报告</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        h2 { color: #444; border-bottom: 2px solid #4CAF50; padding-bottom: 5px; }
        h3 { color: #555; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .security { background-color: #ffebee; }
        .security th { background-color: #d32f2f; }
        .high { color: #d32f2f; font-weight: bold; }
        .medium { color: #f57c00; }
        .low { color: #388e3c; }
        .summary { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .summary-card { background: white; padding: 15px; border-radius: 5px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .summary-card .number { font-size: 24px; font-weight: bold; }
        .summary-card .label { color: #666; font-size: 12px; }
        .security-card .number { color: #d32f2f; }
    </style>
</head>
<body>
    <h1>SpotBugs / FindSecurityBugs 代码检查报告</h1>
    <p><strong>生成时间:</strong> ${now}</p>
    <p><strong>扫描模式:</strong> SpotBugs 4.9.8 + FindSecurityBugs 1.14.0</p>
    
    <div class="summary">
        <h2>检查结果汇总</h2>
        <div class="summary-grid">
            <div class="summary-card">
                <div class="number">${result.filesProcessed}</div>
                <div class="label">分析文件数</div>
            </div>
            <div class="summary-card security-card">
                <div class="number">${securityBugs.length}</div>
                <div class="label">安全漏洞</div>
            </div>
            <div class="summary-card">
                <div class="number">${otherBugs.length}</div>
                <div class="label">代码缺陷</div>
            </div>
            <div class="summary-card">
                <div class="number">${result.bugs.filter(b => b.priority === 1).length}</div>
                <div class="label">高危</div>
            </div>
            <div class="summary-card">
                <div class="number">${result.bugs.filter(b => b.priority === 2).length}</div>
                <div class="label">中危</div>
            </div>
            <div class="summary-card">
                <div class="number">${result.bugs.filter(b => b.priority >= 3).length}</div>
                <div class="label">低危</div>
            </div>
        </div>
        <p>执行时间: ${(result.executionTime / 1000).toFixed(2)}s</p>
    </div>
`;

        if (securityBugs.length > 0) {
            html += `    <h2>安全漏洞 (FindSecurityBugs)</h2>\n`;
            const securityByFile = this.groupBugsByFile(securityBugs);
            
            for (const [filePath, bugs] of Object.entries(securityByFile)) {
                const relativePath = vscode.workspace.asRelativePath(filePath);
                html += `    <h3>${relativePath}</h3>
    <table class="security">
        <tr>
            <th>行号</th>
            <th>Bug类型</th>
            <th>级别</th>
            <th>描述</th>
        </tr>
`;
                for (const b of bugs) {
                    const cssClass = b.priority === 1 ? 'high' : b.priority === 2 ? 'medium' : 'low';
                    const priorityLabel = b.priority === 1 ? '高危' : b.priority === 2 ? '中危' : '低危';
                    html += `        <tr>
            <td>${b.line}</td>
            <td>${b.type}</td>
            <td class="${cssClass}">${priorityLabel}</td>
            <td>${b.message}</td>
        </tr>
`;
                }
                html += `    </table>\n`;
            }
        }

        if (otherBugs.length > 0) {
            html += `    <h2>代码缺陷 (SpotBugs)</h2>\n`;
            const bugsByCategory = this.groupBugsByCategory(otherBugs);
            
            for (const [category, categoryBugs] of Object.entries(bugsByCategory)) {
                html += `    <h3>${category}</h3>\n`;
                const categoryByFile = this.groupBugsByFile(categoryBugs);
                
                for (const [filePath, bugs] of Object.entries(categoryByFile)) {
                    const relativePath = vscode.workspace.asRelativePath(filePath);
                    html += `    <h4>${relativePath}</h4>
    <table>
        <tr>
            <th>行号</th>
            <th>Bug类型</th>
            <th>级别</th>
            <th>描述</th>
        </tr>
`;
                    for (const b of bugs) {
                        const cssClass = b.priority === 1 ? 'high' : b.priority === 2 ? 'medium' : 'low';
                        const priorityLabel = b.priority === 1 ? '高' : b.priority === 2 ? '中' : '低';
                        html += `        <tr>
            <td>${b.line}</td>
            <td>${b.type}</td>
            <td class="${cssClass}">${priorityLabel}</td>
            <td>${b.message}</td>
        </tr>
`;
                    }
                    html += `    </table>\n`;
                }
            }
        }

        if (result.bugs.length === 0) {
            html += `    <h2>检查结果</h2>
    <p style="color: green; font-size: 18px;">✅ 未发现代码问题！</p>\n`;
        }

        html += `</body>
</html>`;
        return html;
    }

    private updateDiagnostics(bugs: SpotBugsBug[]): void {
        if (!this.diagnosticCollection) {
            return;
        }

        // 清除之前的诊断信息
        this.diagnosticCollection.clear();

        // 按文件分组 bugs
        const bugsByFile = this.groupBugsByFile(bugs);
        const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

        for (const [filePath, fileBugs] of Object.entries(bugsByFile)) {
            const diagnostics: vscode.Diagnostic[] = [];

            for (const bug of fileBugs) {
                // 创建诊断信息的位置
                const line = Math.max(0, bug.line - 1); // VS Code 使用 0-based 行号
                const range = new vscode.Range(line, 0, line, 999);

                // 根据优先级设置诊断严重程度
                let severity: vscode.DiagnosticSeverity;
                if (bug.priority === 1) {
                    severity = vscode.DiagnosticSeverity.Error;
                } else if (bug.priority === 2) {
                    severity = vscode.DiagnosticSeverity.Warning;
                } else {
                    severity = vscode.DiagnosticSeverity.Information;
                }

                // 创建诊断信息
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `[${bug.category}] ${bug.type}: ${bug.message}`,
                    severity
                );

                // 设置诊断代码（用于在问题面板中显示）
                diagnostic.code = bug.type;
                diagnostic.source = bug.category === 'SECURITY' ? 'FindSecBugs' : 'SpotBugs';

                diagnostics.push(diagnostic);
            }

            if (diagnostics.length > 0) {
                diagnosticMap.set(vscode.Uri.file(filePath).toString(), diagnostics);
            }
        }

        // 设置诊断集合
        for (const [uri, diagnostics] of diagnosticMap) {
            this.diagnosticCollection.set(vscode.Uri.parse(uri), diagnostics);
        }

        this.outputChannel.appendLine(`Updated ${bugs.length} diagnostics in Problems panel`);
    }

    private groupBugsByFile(bugs: SpotBugsBug[]): Record<string, SpotBugsBug[]> {
        const grouped: Record<string, SpotBugsBug[]> = {};

        for (const b of bugs) {
            if (!grouped[b.filePath]) {
                grouped[b.filePath] = [];
            }
            grouped[b.filePath].push(b);
        }

        for (const filePath in grouped) {
            grouped[filePath].sort((a, b) => a.line - b.line);
        }

        return grouped;
    }

    private groupBugsByCategory(bugs: SpotBugsBug[]): Record<string, SpotBugsBug[]> {
        const grouped: Record<string, SpotBugsBug[]> = {};
        
        for (const b of bugs) {
            if (!grouped[b.category]) {
                grouped[b.category] = [];
            }
            grouped[b.category].push(b);
        }

        return grouped;
    }
}
