import * as vscode from 'vscode';
import { FileTreeProvider, FileTreeItem } from './providers/fileTreeProvider';
import { JavaCodeCheckerPanel } from './webview/panel';
import { ConfigService, SpotBugsConfig } from './services/configService';
import { GitService } from './services/gitService';
import { PMDService } from './services/pmdService';
import { SpotBugsService } from './services/spotbugsService';
import { CheckStyleService } from './services/checkstyleService';

let fileTreeProvider: FileTreeProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('PMD Checker extension is now active');

    // Initialize services
    const configService = ConfigService.getInstance();
    const gitService = GitService.getInstance();
    const pmdService = PMDService.getInstance();
    const spotbugsService = SpotBugsService.getInstance();
    const checkstyleService = CheckStyleService.getInstance();

    // Set extension path for PMD service
    pmdService.setExtensionPath(context.extensionPath);

    // Set extension path for SpotBugs service
    spotbugsService.setExtensionPath(context.extensionPath);

    // Set extension path for CheckStyle service
    checkstyleService.setExtensionPath(context.extensionPath);

    // Create diagnostic collection for SpotBugs
    const spotbugsDiagnostics = vscode.languages.createDiagnosticCollection('spotbugs');
    spotbugsService.setDiagnosticCollection(spotbugsDiagnostics);
    context.subscriptions.push(spotbugsDiagnostics);

    // Create diagnostic collection for CheckStyle
    const checkstyleDiagnostics = vscode.languages.createDiagnosticCollection('checkstyle');
    checkstyleService.setDiagnosticCollection(checkstyleDiagnostics);
    context.subscriptions.push(checkstyleDiagnostics);

    // Initialize file tree provider
    fileTreeProvider = new FileTreeProvider();

    // Register tree view
    const treeView = vscode.window.createTreeView('javaCodeChecker.fileTree', {
        treeDataProvider: fileTreeProvider,
        showCollapseAll: true
    });

    // Set context to show the view
    vscode.commands.executeCommand('setContext', 'javaCodeChecker:enabled', true);

    // Register commands
    const openPanelCommand = vscode.commands.registerCommand('javaCodeChecker.openPanel', () => {
        const panel = JavaCodeCheckerPanel.createOrShow(context.extensionUri);
        
        // Load and send files to webview
        loadFilesForWebview(panel);
    });

    const runCheckCommand = vscode.commands.registerCommand('javaCodeChecker.runCheck', async (filePaths?: string[]) => {
        await runPMDCheck(filePaths);
    });

    const openConfigCommand = vscode.commands.registerCommand('javaCodeChecker.openConfig', async () => {
        await openConfiguration();
    });

    const refreshFilesCommand = vscode.commands.registerCommand('javaCodeChecker.refreshFiles', () => {
        fileTreeProvider.refresh();

        // Also refresh webview if it's open
        if (JavaCodeCheckerPanel.currentPanel) {
            loadFilesForWebview(JavaCodeCheckerPanel.currentPanel);
        }
    });

    const selectAllCommand = vscode.commands.registerCommand('javaCodeChecker.selectAll', () => {
        fileTreeProvider.selectAll();
    });

    const deselectAllCommand = vscode.commands.registerCommand('javaCodeChecker.deselectAll', () => {
        fileTreeProvider.deselectAll();
    });

    const toggleFileCommand = vscode.commands.registerCommand('javaCodeChecker.toggleFile', (item: FileTreeItem) => {
        fileTreeProvider.toggleFileCheck(item.file.path);
    });

    const checkSelectedCommand = vscode.commands.registerCommand('javaCodeChecker.checkSelected', async () => {
        await fileTreeProvider.checkSelectedFiles();
    });

    const runSpotBugsCommand = vscode.commands.registerCommand('javaCodeChecker.runSpotBugs', async (filePaths?: string[]) => {
        await runSpotBugsCheck(filePaths);
    });

    const runCheckStyleCommand = vscode.commands.registerCommand('javaCodeChecker.runCheckStyle', async (filePaths?: string[]) => {
        await runCheckStyleCheck(filePaths);
    });

    // Add all disposables to context
    context.subscriptions.push(
        openPanelCommand,
        runCheckCommand,
        openConfigCommand,
        refreshFilesCommand,
        selectAllCommand,
        deselectAllCommand,
        toggleFileCommand,
        checkSelectedCommand,
        runSpotBugsCommand,
        runCheckStyleCommand,
        treeView
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('javaCodeChecker')) {
                // Configuration changed, refresh if needed
                console.log('PMD Checker configuration changed');
            }
        })
    );

    // Auto-check on save (if enabled)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = configService.getConfig();
            if (config.autoCheckOnSave && document.languageId === 'java') {
                // Run quick check on saved file
                try {
                    const result = await pmdService.checkFiles(
                        [document.fileName],
                        config
                    );
                    
                    if (result.violations.length > 0) {
                        // Show notification with issues
                        const issues = result.violations.length;
                        const action = await vscode.window.showInformationMessage(
                            `PMD found ${issues} issue(s) in ${path.basename(document.fileName)}`,
                            'View Details',
                            'Dismiss'
                        );
                        
                        if (action === 'View Details') {
                            await pmdService.generateReport(result, config.outputPath);
                        }
                    }
                } catch (error) {
                    console.error('Auto-check failed:', error);
                }
            }
        })
    );

    // Refresh files on git changes
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
        const git = gitExtension.exports;
        if (git && git.repositories) {
            git.repositories.forEach((repo: any) => {
                repo.state.onDidChange(() => {
                    fileTreeProvider.refresh();
                });
            });
        }
    }

    // Initial file load
    fileTreeProvider.refresh();
}

async function loadFilesForWebview(panel: JavaCodeCheckerPanel): Promise<void> {
    try {
        const gitService = GitService.getInstance();
        const files = await gitService.getPendingFiles();
        const javaFiles = gitService.filterJavaFiles(files);
        
        panel.postMessage({
            type: 'files',
            files: javaFiles.map(f => ({
                path: f.path,
                status: f.status,
                changeType: f.changeType,
                checked: f.checked
            }))
        });
    } catch (error) {
        panel.postMessage({
            type: 'status',
            text: `Error loading files: ${error}`
        });
    }
}

async function runPMDCheck(webviewFilePaths?: string[]): Promise<void> {
    const configService = ConfigService.getInstance();
    const pmdService = PMDService.getInstance();

    const config = configService.getConfig();

    // Validate ruleset configuration
    if (!config.rulesetPath) {
        const action = await vscode.window.showWarningMessage(
            'PMD ruleset not configured. Would you like to create a default ruleset?',
            'Create Default',
            'Open Settings'
        );

        if (action === 'Create Default') {
            const rulesetPath = await configService.createDefaultRuleset();
            if (rulesetPath) {
                await configService.updateConfig('rulesetPath', 'pmd-ruleset.xml');
                vscode.window.showInformationMessage(`Default ruleset created: ${rulesetPath}`);
            }
            return;
        } else if (action === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'javaCodeChecker');
            return;
        }
        return;
    }

    // Get file paths: from webview or from file tree provider
    let filePaths: string[];
    if (webviewFilePaths && webviewFilePaths.length > 0) {
        filePaths = webviewFilePaths.filter(f => f.toLowerCase().endsWith('.java'));
    } else {
        const checkedFiles = fileTreeProvider.getCheckedFiles();
        filePaths = checkedFiles.filter(f => f.path.toLowerCase().endsWith('.java')).map(f => f.path);
    }

    if (filePaths.length === 0) {
        vscode.window.showWarningMessage('No files selected for checking. Please select files from the Pending Files view.');
        return;
    }

    // Run PMD check with progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running PMD check',
        cancellable: true
    }, async (progress, token) => {
        try {
            const result = await pmdService.checkFiles(filePaths, config, progress);

            if (token.isCancellationRequested) {
                return;
            }

            // Update webview with results
            if (JavaCodeCheckerPanel.currentPanel) {
                JavaCodeCheckerPanel.currentPanel.postMessage({
                    type: 'results',
                    results: {
                        filesProcessed: result.filesProcessed,
                        violations: result.violations,
                        executionTime: result.executionTime
                    }
                });
            }

            // Generate report (both Markdown and HTML)
            await pmdService.generateReport(result, config.outputPath);

            // Show summary
            if (result.violations.length === 0) {
                vscode.window.showInformationMessage(
                    `✅ PMD check completed. No issues found in ${result.filesProcessed} files.`
                );
            } else {
                const totalIssues = result.violations.length;
                const errors = result.violations.filter(v => v.priority <= 2).length;
                const warnings = result.violations.filter(v => v.priority === 3).length;

                vscode.window.showWarningMessage(
                    `⚠️ Found ${totalIssues} issues (${errors} errors, ${warnings} warnings) in ${result.filesProcessed} files.`,
                    'View Report',
                    'Dismiss'
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`PMD check failed: ${error}`);
        }
    });
}

async function runSpotBugsCheck(webviewFilePaths?: string[]): Promise<void> {
    const configService = ConfigService.getInstance();
    const spotbugsService = SpotBugsService.getInstance();

    const config = configService.getSpotBugsConfig();

    // Get file paths: from webview or from file tree provider
    let filePaths: string[];
    if (webviewFilePaths && webviewFilePaths.length > 0) {
        filePaths = webviewFilePaths.filter(f => f.toLowerCase().endsWith('.java'));
    } else {
        const checkedFiles = fileTreeProvider.getCheckedFiles();
        filePaths = checkedFiles.filter(f => f.path.toLowerCase().endsWith('.java')).map(f => f.path);
    }

    if (filePaths.length === 0) {
        vscode.window.showWarningMessage('No files selected for checking. Please select files from the Pending Files view.');
        return;
    }

    // Clear previous diagnostics before running new check
    spotbugsService.clearDiagnostics();

    // Run SpotBugs check with progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running SpotBugs check',
        cancellable: true
    }, async (progress, token) => {
        try {
            const result = await spotbugsService.checkFiles(filePaths, config, progress);

            if (token.isCancellationRequested) {
                return;
            }

            // Update webview with results
            if (JavaCodeCheckerPanel.currentPanel) {
                JavaCodeCheckerPanel.currentPanel.postMessage({
                    type: 'spotbugsResults',
                    results: {
                        filesProcessed: result.filesProcessed,
                        bugs: result.bugs,
                        errors: result.errors,
                        executionTime: result.executionTime
                    }
                });
            }

            // Generate report (both Markdown and HTML)
            await spotbugsService.generateReport(result, config.spotbugsOutputPath);

            // Show summary
            const securityBugs = result.bugs.filter(b => b.category === 'SECURITY');
            const highPriorityBugs = result.bugs.filter(b => b.priority === 1);
            const mediumPriorityBugs = result.bugs.filter(b => b.priority === 2);

            if (result.bugs.length === 0) {
                vscode.window.showInformationMessage(
                    `✅ SpotBugs check completed. No issues found in ${result.filesProcessed} files.`
                );
            } else {
                const totalIssues = result.bugs.length;
                vscode.window.showWarningMessage(
                    `⚠️ Found ${totalIssues} issues (${securityBugs.length} security, ${highPriorityBugs.length} high, ${mediumPriorityBugs.length} medium) in ${result.filesProcessed} files.`,
                    'View Report',
                    'Dismiss'
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`SpotBugs check failed: ${error}`);
        }
    });
}

async function runCheckStyleCheck(webviewFilePaths?: string[]): Promise<void> {
    const configService = ConfigService.getInstance();
    const checkstyleService = CheckStyleService.getInstance();

    const config = configService.getCheckStyleConfig();

    // Get file paths: from webview or from file tree provider
    let filePaths: string[];
    if (webviewFilePaths && webviewFilePaths.length > 0) {
        filePaths = webviewFilePaths.filter(f => f.toLowerCase().endsWith('.java'));
    } else {
        const checkedFiles = fileTreeProvider.getCheckedFiles();
        filePaths = checkedFiles.filter(f => f.path.toLowerCase().endsWith('.java')).map(f => f.path);
    }

    if (filePaths.length === 0) {
        vscode.window.showWarningMessage('No files selected for checking. Please select files from the Pending Files view.');
        return;
    }

    // Clear previous diagnostics before running new check
    checkstyleService.clearDiagnostics();

    // Run CheckStyle check with progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running CheckStyle check',
        cancellable: true
    }, async (progress, token) => {
        try {
            const result = await checkstyleService.checkFiles(filePaths, config, progress);

            if (token.isCancellationRequested) {
                return;
            }

            // Update webview with results
            if (JavaCodeCheckerPanel.currentPanel) {
                JavaCodeCheckerPanel.currentPanel.postMessage({
                    type: 'checkstyleResults',
                    results: {
                        filesProcessed: result.filesProcessed,
                        violations: result.violations,
                        errors: result.errors,
                        executionTime: result.executionTime
                    }
                });
            }

            // Generate report (both Markdown and HTML)
            await checkstyleService.generateReport(result, config.checkstyleOutputPath);

            // Show summary
            const errorCount = result.violations.filter(v => v.severity === 'error').length;
            const warningCount = result.violations.filter(v => v.severity === 'warning').length;

            if (result.violations.length === 0) {
                vscode.window.showInformationMessage(
                    `✅ CheckStyle check completed. No issues found in ${result.filesProcessed} files.`
                );
            } else {
                const totalIssues = result.violations.length;
                vscode.window.showWarningMessage(
                    `⚠️ Found ${totalIssues} issues (${errorCount} errors, ${warningCount} warnings) in ${result.filesProcessed} files.`,
                    'View Report',
                    'Dismiss'
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`CheckStyle check failed: ${error}`);
        }
    });
}

async function openConfiguration(): Promise<void> {
    const configService = ConfigService.getInstance();
    const config = configService.getConfig();

    const items: vscode.QuickPickItem[] = [
        {
            label: '$(file-code) Ruleset Path',
            description: config.rulesetPath || 'Not configured',
            detail: 'Path to PMD ruleset XML file'
        },
        {
            label: '$(terminal) PMD Executable Path',
            description: config.pmdPath || 'pmd',
            detail: 'Path to PMD executable'
        },
        {
            label: '$(output) Output Path',
            description: config.outputPath || 'pmd-report.md',
            detail: 'Path for check result reports'
        },
        {
            label: '$(sync) Auto Check on Save',
            description: config.autoCheckOnSave ? 'Enabled' : 'Disabled',
            detail: 'Automatically run PMD check when saving Java files'
        },
        {
            label: '$(add) Create Default Ruleset',
            description: 'Create a default PMD ruleset file',
            detail: 'Generates a pmd-ruleset.xml with common rules'
        }
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a configuration option'
    });

    if (!selected) {
        return;
    }

    switch (selected.label) {
        case '$(file-code) Ruleset Path':
            const rulesetUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'XML files': ['xml'],
                    'All files': ['*']
                },
                title: 'Select PMD Ruleset File'
            });

            if (rulesetUri && rulesetUri[0]) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                let relativePath = rulesetUri[0].fsPath;
                
                if (workspaceFolders) {
                    relativePath = path.relative(workspaceFolders[0].uri.fsPath, relativePath);
                }
                
                await configService.updateConfig('rulesetPath', relativePath);
                vscode.window.showInformationMessage(`Ruleset path updated: ${relativePath}`);
            }
            break;

        case '$(terminal) PMD Executable Path':
            const pmdPath = await vscode.window.showInputBox({
                prompt: 'Enter PMD executable path',
                value: config.pmdPath || 'pmd',
                placeHolder: 'e.g., /usr/local/bin/pmd or C:\\pmd\\bin\\pmd.bat'
            });

            if (pmdPath !== undefined) {
                await configService.updateConfig('pmdPath', pmdPath);
                vscode.window.showInformationMessage(`PMD path updated: ${pmdPath}`);
            }
            break;

        case '$(output) Output Path':
            const outputPath = await vscode.window.showInputBox({
                prompt: 'Enter output report path',
                value: config.outputPath || 'pmd-report.md',
                placeHolder: 'e.g., reports/pmd-report.md'
            });

            if (outputPath !== undefined) {
                await configService.updateConfig('outputPath', outputPath);
                vscode.window.showInformationMessage(`Output path updated: ${outputPath}`);
            }
            break;

        case '$(sync) Auto Check on Save':
            await configService.updateConfig('autoCheckOnSave', !config.autoCheckOnSave);
            vscode.window.showInformationMessage(
                `Auto check on save ${!config.autoCheckOnSave ? 'enabled' : 'disabled'}`
            );
            break;

        case '$(add) Create Default Ruleset':
            const rulesetPath = await configService.createDefaultRuleset();
            if (rulesetPath) {
                await configService.updateConfig('rulesetPath', 'pmd-ruleset.xml');
                vscode.window.showInformationMessage(`Default ruleset created: ${rulesetPath}`);
                
                // Open the ruleset file
                const doc = await vscode.workspace.openTextDocument(rulesetPath);
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showErrorMessage('Failed to create default ruleset');
            }
            break;
    }
}

export function deactivate() {
    console.log('PMD Checker extension is now deactivated');
    // Clear SpotBugs diagnostics
    const spotbugsService = SpotBugsService.getInstance();
    spotbugsService.clearDiagnostics();
    // Clear CheckStyle diagnostics
    const checkstyleService = CheckStyleService.getInstance();
    checkstyleService.clearDiagnostics();
}

import * as path from 'path';
