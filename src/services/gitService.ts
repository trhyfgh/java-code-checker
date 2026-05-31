import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitFile {
    path: string;
    status: 'staged' | 'unstaged' | 'untracked';
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
    checked: boolean;
}

export class GitService {
    private static instance: GitService;
    private workspaceRoot: string | undefined;

    private constructor() {
        this.updateWorkspaceRoot();
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.updateWorkspaceRoot();
        });
    }

    public static getInstance(): GitService {
        if (!GitService.instance) {
            GitService.instance = new GitService();
        }
        return GitService.instance;
    }

    private updateWorkspaceRoot(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = workspaceFolders && workspaceFolders.length > 0 
            ? workspaceFolders[0].uri.fsPath 
            : undefined;
    }

    public async isGitRepository(): Promise<boolean> {
        if (!this.workspaceRoot) {
            return false;
        }

        try {
            await execAsync('git rev-parse --git-dir', { cwd: this.workspaceRoot });
            return true;
        } catch {
            return false;
        }
    }

    public async getPendingFiles(): Promise<GitFile[]> {
        if (!this.workspaceRoot) {
            throw new Error('No workspace folder open');
        }

        const isGitRepo = await this.isGitRepository();
        if (!isGitRepo) {
            throw new Error('Current workspace is not a Git repository');
        }

        const files: GitFile[] = [];

        try {
            // Get staged files
            const { stdout: stagedOutput } = await execAsync(
                'git diff --cached --name-status',
                { cwd: this.workspaceRoot }
            );
            
            if (stagedOutput.trim()) {
                const stagedFiles = this.parseGitStatus(stagedOutput, 'staged');
                files.push(...stagedFiles);
            }

            // Get unstaged files
            const { stdout: unstagedOutput } = await execAsync(
                'git diff --name-status',
                { cwd: this.workspaceRoot }
            );
            
            if (unstagedOutput.trim()) {
                const unstagedFiles = this.parseGitStatus(unstagedOutput, 'unstaged');
                files.push(...unstagedFiles);
            }

            // Get untracked files
            const { stdout: untrackedOutput } = await execAsync(
                'git ls-files --others --exclude-standard',
                { cwd: this.workspaceRoot }
            );
            
            if (untrackedOutput.trim()) {
                const untrackedFiles = untrackedOutput
                    .split('\n')
                    .filter(line => line.trim())
                    .map(filePath => ({
                        path: path.join(this.workspaceRoot!, filePath.trim()),
                        status: 'untracked' as const,
                        changeType: 'added' as const,
                        checked: true
                    }));
                files.push(...untrackedFiles);
            }

            return files;
        } catch (error) {
            throw new Error(`Failed to get pending files: ${error}`);
        }
    }

    private parseGitStatus(output: string, status: 'staged' | 'unstaged'): GitFile[] {
        const files: GitFile[] = [];
        const lines = output.split('\n').filter(line => line.trim());

        for (const line of lines) {
            const match = line.match(/^([AMDRCU])(\d*)\s+(.+)$/);
            if (match) {
                const changeTypeCode = match[1];
                const filePath = match[3];
                
                let changeType: GitFile['changeType'];
                switch (changeTypeCode) {
                    case 'A':
                        changeType = 'added';
                        break;
                    case 'M':
                        changeType = 'modified';
                        break;
                    case 'D':
                        changeType = 'deleted';
                        break;
                    case 'R':
                        changeType = 'renamed';
                        break;
                    default:
                        changeType = 'modified';
                }

                files.push({
                    path: path.join(this.workspaceRoot!, filePath),
                    status,
                    changeType,
                    checked: true
                });
            }
        }

        return files;
    }

    public async getFileDiff(filePath: string): Promise<string> {
        if (!this.workspaceRoot) {
            throw new Error('No workspace folder open');
        }

        try {
            const relativePath = path.relative(this.workspaceRoot, filePath);
            const { stdout } = await execAsync(
                `git diff HEAD -- "${relativePath}"`,
                { cwd: this.workspaceRoot }
            );
            return stdout;
        } catch (error) {
            return '';
        }
    }

    public filterJavaFiles(files: GitFile[]): GitFile[] {
        return files.filter(file => file.path.endsWith('.java'));
    }
}
