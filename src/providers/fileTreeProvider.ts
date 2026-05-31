import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, GitFile } from '../services/gitService';

export class FileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly file: GitFile,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(path.basename(file.path), collapsibleState);
        
        this.tooltip = file.path;
        this.description = this.getStatusDescription(file);
        this.resourceUri = vscode.Uri.file(file.path);
        
        // Set icon based on status
        this.iconPath = this.getIconPath(file);
        
        // Set context value for menu conditions
        this.contextValue = file.status;
    }

    private getStatusDescription(file: GitFile): string {
        const statusMap: Record<string, string> = {
            'staged': 'Staged',
            'unstaged': 'Modified',
            'untracked': 'Untracked'
        };
        
        const changeTypeMap: Record<string, string> = {
            'added': 'A',
            'modified': 'M',
            'deleted': 'D',
            'renamed': 'R'
        };
        
        return `${changeTypeMap[file.changeType]} - ${statusMap[file.status]}`;
    }

    private getIconPath(file: GitFile): vscode.ThemeIcon {
        if (!file.checked) {
            return new vscode.ThemeIcon('circle-outline');
        }
        
        switch (file.status) {
            case 'staged':
                return new vscode.ThemeIcon('check');
            case 'unstaged':
                return new vscode.ThemeIcon('edit');
            case 'untracked':
                return new vscode.ThemeIcon('new-file');
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}

export class FileTreeProvider implements vscode.TreeDataProvider<FileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileTreeItem | undefined | null | void> = new vscode.EventEmitter<FileTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<FileTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private files: GitFile[] = [];
    private gitService: GitService;

    constructor() {
        this.gitService = GitService.getInstance();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileTreeItem): Thenable<FileTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        return this.getFiles();
    }

    private async getFiles(): Promise<FileTreeItem[]> {
        try {
            this.files = await this.gitService.getPendingFiles();
            
            // Filter only Java files
            const javaFiles = this.gitService.filterJavaFiles(this.files);
            
            return javaFiles.map(file => new FileTreeItem(
                file,
                vscode.TreeItemCollapsibleState.None
            ));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load pending files: ${error}`);
            return [];
        }
    }

    public getCheckedFiles(): GitFile[] {
        return this.files.filter(f => f.checked);
    }

    public getAllFiles(): GitFile[] {
        return this.files;
    }

    public toggleFileCheck(filePath: string): void {
        const file = this.files.find(f => f.path === filePath);
        if (file) {
            file.checked = !file.checked;
            this.refresh();
        }
    }

    public selectAll(): void {
        this.files.forEach(f => f.checked = true);
        this.refresh();
    }

    public deselectAll(): void {
        this.files.forEach(f => f.checked = false);
        this.refresh();
    }

    public async checkSelectedFiles(): Promise<void> {
        const checkedFiles = this.getCheckedFiles();
        if (checkedFiles.length === 0) {
            vscode.window.showWarningMessage('No files selected for checking');
            return;
        }

        // Filter only Java files for PMD check
        const javaFiles = checkedFiles.filter(f => f.path.toLowerCase().endsWith('.java'));
        if (javaFiles.length === 0) {
            vscode.window.showWarningMessage('No Java files selected for checking. PMD only supports Java files.');
            return;
        }

        // Import here to avoid circular dependency
        const { PMDService } = await import('../services/pmdService');
        const { ConfigService } = await import('../services/configService');

        const pmdService = PMDService.getInstance();
        const configService = ConfigService.getInstance();

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

        // Run PMD check with progress
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Running PMD check',
            cancellable: true
        }, async (progress, token) => {
            try {
                const filePaths = javaFiles.map(f => f.path);
                const result = await pmdService.checkFiles(filePaths, config, progress);

                if (token.isCancellationRequested) {
                    return;
                }

                // Generate report
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
                        `⚠️ PMD check completed. Found ${totalIssues} issues ` +
                        `(${errors} errors, ${warnings} warnings) in ${result.filesProcessed} files.`
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(`PMD check failed: ${error}`);
            }
        });
    }
}
