import * as vscode from 'vscode';
import * as path from 'path';

export class JavaCodeCheckerPanel {
    public static currentPanel: JavaCodeCheckerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
        
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                    case 'openFile':
                        this.openFile(message.filePath, message.line);
                        return;
                    case 'runCheck':
                        vscode.commands.executeCommand('javaCodeChecker.runCheck', message.filePaths);
                        return;
                    case 'runSpotBugs':
                        vscode.commands.executeCommand('javaCodeChecker.runSpotBugs', message.filePaths);
                        return;
                    case 'runCheckStyle':
                        vscode.commands.executeCommand('javaCodeChecker.runCheckStyle', message.filePaths);
                        return;
                    case 'refreshFiles':
                        vscode.commands.executeCommand('javaCodeChecker.refreshFiles');
                        return;
                    case 'openConfig':
                        vscode.commands.executeCommand('javaCodeChecker.openConfig');
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri): JavaCodeCheckerPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (JavaCodeCheckerPanel.currentPanel) {
            JavaCodeCheckerPanel.currentPanel._panel.reveal(column);
            return JavaCodeCheckerPanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'javaCodeChecker',
            'Java Code Checker',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        JavaCodeCheckerPanel.currentPanel = new JavaCodeCheckerPanel(panel, extensionUri);
        return JavaCodeCheckerPanel.currentPanel;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
        JavaCodeCheckerPanel.currentPanel = new JavaCodeCheckerPanel(panel, extensionUri);
    }

    public postMessage(message: any): void {
        this._panel.webview.postMessage(message);
    }

    private async openFile(filePath: string, line?: number): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            const editor = await vscode.window.showTextDocument(document);
            
            if (line !== undefined && line > 0) {
                const position = new vscode.Position(line - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    }

    public dispose(): void {
        JavaCodeCheckerPanel.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>PMD Checker</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
        }

        .header-actions {
            display: flex;
            gap: 10px;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-danger {
            background-color: #dc3545;
            color: white;
        }

        .btn-danger:hover {
            background-color: #c82333;
        }

        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        .panel {
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }

        .panel-header {
            background-color: var(--vscode-panelSectionHeader-background);
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .panel-header h2 {
            font-size: 14px;
            font-weight: 600;
        }

        .panel-actions {
            display: flex;
            gap: 8px;
        }

        .panel-content {
            padding: 16px;
            max-height: 500px;
            overflow-y: auto;
        }

        .file-list {
            list-style: none;
        }

        .file-item {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
            margin-bottom: 4px;
        }

        .file-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .file-item input[type="checkbox"] {
            margin-right: 10px;
        }

        .file-item .file-icon {
            margin-right: 8px;
            font-size: 16px;
        }

        .file-item .file-name {
            flex: 1;
            font-size: 13px;
        }

        .file-item .file-status {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .file-item.unchecked {
            opacity: 0.6;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .results-summary {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 20px;
        }

        .summary-card {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 16px;
            border-radius: 6px;
            text-align: center;
        }

        .summary-card .number {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .summary-card .label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .summary-card.error .number {
            color: var(--vscode-errorForeground);
        }

        .summary-card.warning .number {
            color: var(--vscode-editorWarning-foreground);
        }

        .summary-card.success .number {
            color: var(--vscode-testing-iconPassed);
        }

        .summary-card.security .number {
            color: #d32f2f;
        }

        .violation-item {
            padding: 12px;
            border-left: 3px solid var(--vscode-errorForeground);
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            margin-bottom: 8px;
            border-radius: 0 4px 4px 0;
        }

        .violation-item.warning {
            border-left-color: var(--vscode-editorWarning-foreground);
        }

        .violation-item.info {
            border-left-color: var(--vscode-editorInfo-foreground);
        }

        .violation-item.security {
            border-left-color: #d32f2f;
            background-color: #ffebee;
        }

        .violation-file {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }

        .violation-message {
            font-size: 13px;
            margin-bottom: 4px;
        }

        .violation-rule {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .progress-bar {
            width: 100%;
            height: 4px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 2px;
            overflow: hidden;
            margin-top: 10px;
        }

        .progress-bar-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-foreground);
            transition: width 0.3s ease;
        }

        .config-section {
            margin-bottom: 20px;
        }

        .config-section h3 {
            font-size: 13px;
            margin-bottom: 8px;
            color: var(--vscode-descriptionForeground);
        }

        .config-value {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            padding: 8px 12px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
            word-break: break-all;
        }

        .status-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 16px;
            background-color: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            font-size: 12px;
            border-radius: 4px;
            margin-top: 20px;
        }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 15px;
        }

        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            font-size: 13px;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }

        .tab:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .tab.active {
            border-bottom-color: var(--vscode-focusBorder);
            font-weight: 600;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .tab-buttons {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }

        .tab-btn {
            padding: 8px 16px;
            border: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }

        .tab-btn.active {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Code Checker</h1>
            <div class="header-actions">
                <button class="btn btn-secondary" onclick="refreshFiles()">
                    <span>🔄</span> Refresh
                </button>
                <button class="btn btn-secondary" onclick="openConfig()">
                    <span>⚙️</span> Config
                </button>
                <button class="btn btn-primary" onclick="runCheck()">
                    <span>▶️</span> PMD
                </button>
                <button class="btn btn-danger" onclick="runSpotBugs()">
                    <span>🐛</span> SpotBugs
                </button>
                <button class="btn btn-secondary" onclick="runCheckStyle()">
                    <span>✅</span> CheckStyle
                </button>
            </div>
        </div>

        <div class="main-content">
            <div class="panel">
                <div class="panel-header">
                    <h2>📁 Pending Files</h2>
                    <div class="panel-actions">
                        <button class="btn btn-secondary" onclick="selectAll()">Select All</button>
                        <button class="btn btn-secondary" onclick="deselectAll()">Deselect All</button>
                    </div>
                </div>
                <div class="panel-content" id="fileList">
                    <div class="empty-state">
                        <div class="empty-state-icon">📂</div>
                        <p>Loading pending files...</p>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <h2>📊 Check Results</h2>
                </div>
                <div class="panel-content" id="resultsPanel">
                    <div class="tabs">
                        <button class="tab active" onclick="switchTab('pmd')" id="tab-pmd">PMD</button>
                        <button class="tab" onclick="switchTab('spotbugs')" id="tab-spotbugs">SpotBugs</button>
                        <button class="tab" onclick="switchTab('checkstyle')" id="tab-checkstyle">CheckStyle</button>
                    </div>
                    <div id="pmd-content" class="tab-content active">
                        <div class="empty-state">
                            <div class="empty-state-icon">📋</div>
                            <p>Run PMD check to see results</p>
                        </div>
                    </div>
                    <div id="spotbugs-content" class="tab-content">
                        <div class="empty-state">
                            <div class="empty-state-icon">🐛</div>
                            <p>Run SpotBugs check to see results</p>
                        </div>
                    </div>
                    <div id="checkstyle-content" class="tab-content">
                        <div class="empty-state">
                            <div class="empty-state-icon">✅</div>
                            <p>Run CheckStyle check to see results</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="status-bar" id="statusBar">
            <span id="statusText">Ready</span>
            <span id="fileCount">0 files</span>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // State
        let files = [];
        let checkResults = null;
        let spotbugsResults = null;
        let checkstyleResults = null;
        let currentTab = 'pmd';

        // Initialize
        refreshFiles();

        function refreshFiles() {
            vscode.postMessage({ command: 'refreshFiles' });
            updateStatus('Loading files...', '');
        }

        function runCheck() {
            const checkedFiles = files.filter(f => f.checked);
            if (checkedFiles.length === 0) {
                alert('Please select at least one file to check');
                return;
            }
            vscode.postMessage({ command: 'runCheck', filePaths: checkedFiles.map(f => f.path) });
            updateStatus('Running PMD check...', '');
        }

        function runSpotBugs() {
            const checkedFiles = files.filter(f => f.checked);
            if (checkedFiles.length === 0) {
                alert('Please select at least one file to check');
                return;
            }
            vscode.postMessage({ command: 'runSpotBugs', filePaths: checkedFiles.map(f => f.path) });
            updateStatus('Running SpotBugs check...', '');
        }

        function runCheckStyle() {
            const checkedFiles = files.filter(f => f.checked);
            if (checkedFiles.length === 0) {
                alert('Please select at least one file to check');
                return;
            }
            vscode.postMessage({ command: 'runCheckStyle', filePaths: checkedFiles.map(f => f.path) });
            updateStatus('Running CheckStyle check...', '');
        }

        function openConfig() {
            vscode.postMessage({ command: 'openConfig' });
        }

        function selectAll() {
            files.forEach(f => f.checked = true);
            renderFileList();
            updateFileCount();
        }

        function deselectAll() {
            files.forEach(f => f.checked = false);
            renderFileList();
            updateFileCount();
        }

        function toggleFile(index) {
            files[index].checked = !files[index].checked;
            renderFileList();
            updateFileCount();
        }

        function openFile(filePath, line) {
            vscode.postMessage({ command: 'openFile', filePath, line });
        }

        function switchTab(tabName) {
            currentTab = tabName;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.add('active');
            document.getElementById(tabName + '-content').classList.add('active');
        }

        function updateStatus(text, count) {
            document.getElementById('statusText').textContent = text;
            if (count !== '') {
                document.getElementById('fileCount').textContent = count;
            }
        }

        function updateFileCount() {
            const checkedCount = files.filter(f => f.checked).length;
            document.getElementById('fileCount').textContent = 
                checkedCount + ' / ' + files.length + ' files selected';
        }

        function renderFileList() {
            const container = document.getElementById('fileList');
            
            if (files.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📂</div>
                        <p>No pending Java files found</p>
                        <p style="font-size: 12px; margin-top: 8px;">Make sure you have Java files in your Git working directory</p>
                    </div>
                \`;
                return;
            }

            const listHtml = files.map((file, index) => \`
                <li class="file-item \${file.checked ? '' : 'unchecked'}" onclick="toggleFile(\${index})">
                    <input type="checkbox" \${file.checked ? 'checked' : ''} onclick="event.stopPropagation(); toggleFile(\${index})">
                    <span class="file-icon">📄</span>
                    <span class="file-name">\${file.name}</span>
                    <span class="file-status">\${file.status}</span>
                </li>
            \`).join('');

            container.innerHTML = '<ul class="file-list">' + listHtml + '</ul>';
            updateFileCount();
        }

        function renderResults(results) {
            const container = document.getElementById('pmd-content');
            
            if (!results || results.violations.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">✅</div>
                        <p>No issues found!</p>
                        <p style="font-size: 12px; margin-top: 8px;">Your code looks great</p>
                    </div>
                \`;
                return;
            }

            const errors = results.violations.filter(v => v.priority <= 2).length;
            const warnings = results.violations.filter(v => v.priority === 3).length;
            const infos = results.violations.filter(v => v.priority >= 4).length;

            const summaryHtml = \`
                <div class="results-summary">
                    <div class="summary-card error">
                        <div class="number">\${errors}</div>
                        <div class="label">Errors</div>
                    </div>
                    <div class="summary-card warning">
                        <div class="number">\${warnings}</div>
                        <div class="label">Warnings</div>
                    </div>
                    <div class="summary-card info">
                        <div class="number">\${infos}</div>
                        <div class="label">Infos</div>
                    </div>
                    <div class="summary-card success">
                        <div class="number">\${results.filesProcessed}</div>
                        <div class="label">Files</div>
                    </div>
                </div>
            \`;

            const violationsHtml = results.violations.slice(0, 50).map(v => {
                const priorityClass = v.priority <= 2 ? '' : v.priority === 3 ? 'warning' : 'info';
                return \`
                    <div class="violation-item \${priorityClass}" onclick="openFile('\${v.filePath}', \${v.line})">
                        <div class="violation-file">\${v.filePath.split('/').pop()}:\${v.line}</div>
                        <div class="violation-message">\${v.message}</div>
                        <div class="violation-rule">\${v.rule} (Priority \${v.priority})</div>
                    </div>
                \`;
            }).join('');

            container.innerHTML = summaryHtml + violationsHtml;
        }

        function renderSpotBugsResults(results) {
            const container = document.getElementById('spotbugs-content');
            
            if (!results || !results.bugs || results.bugs.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">✅</div>
                        <p>No issues found!</p>
                        <p style="font-size: 12px; margin-top: 8px;">Your code looks great</p>
                    </div>
                \`;
                return;
            }

            const securityBugs = results.bugs.filter(b => b.category === 'SECURITY');
            const highPriority = results.bugs.filter(b => b.priority === 1).length;
            const mediumPriority = results.bugs.filter(b => b.priority === 2).length;
            const lowPriority = results.bugs.filter(b => b.priority >= 3).length;

            const summaryHtml = \`
                <div class="results-summary">
                    <div class="summary-card security">
                        <div class="number">\${securityBugs.length}</div>
                        <div class="label">Security</div>
                    </div>
                    <div class="summary-card error">
                        <div class="number">\${highPriority}</div>
                        <div class="label">High</div>
                    </div>
                    <div class="summary-card warning">
                        <div class="number">\${mediumPriority}</div>
                        <div class="label">Medium</div>
                    </div>
                    <div class="summary-card success">
                        <div class="number">\${results.filesProcessed}</div>
                        <div class="label">Files</div>
                    </div>
                </div>
            \`;

            let bugsHtml = '';

            if (securityBugs.length > 0) {
                bugsHtml += '<h3 style="margin: 15px 0 10px; color: #d32f2f;">🔒 Security Issues</h3>';
                securityBugs.slice(0, 30).forEach(b => {
                    const priorityClass = b.priority === 1 ? 'security' : b.priority === 2 ? 'warning' : '';
                    const displayPath = b.relativePath || b.filePath;
                    bugsHtml += \`
                        <div class="violation-item \${priorityClass}" onclick="openFile('\${b.filePath}', \${b.line})">
                            <div class="violation-file">\${displayPath} : 第 \${b.line} 行</div>
                            <div class="violation-message">\${b.message}</div>
                            <div class="violation-rule">\${b.type} (Priority \${b.priority})</div>
                        </div>
                    \`;
                });
            }

            const otherBugs = results.bugs.filter(b => b.category !== 'SECURITY');
            if (otherBugs.length > 0) {
                bugsHtml += '<h3 style="margin: 15px 0 10px;">🐛 Code Issues</h3>';
                otherBugs.slice(0, 30).forEach(b => {
                    const priorityClass = b.priority === 1 ? '' : b.priority === 2 ? 'warning' : 'info';
                    const displayPath = b.relativePath || b.filePath;
                    bugsHtml += \`
                        <div class="violation-item \${priorityClass}" onclick="openFile('\${b.filePath}', \${b.line})">
                            <div class="violation-file">\${displayPath} : 第 \${b.line} 行</div>
                            <div class="violation-message">\${b.message}</div>
                            <div class="violation-rule">\${b.type} [\${b.category}] (Priority \${b.priority})</div>
                        </div>
                    \`;
                });
            }

            container.innerHTML = summaryHtml + bugsHtml;
        }

        function renderCheckStyleResults(results) {
            const container = document.getElementById('checkstyle-content');

            if (!results || !results.violations || results.violations.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">✅</div>
                        <p>No issues found!</p>
                        <p style="font-size: 12px; margin-top: 8px;">Your code looks great</p>
                    </div>
                \`;
                return;
            }

            const errors = results.violations.filter(v => v.severity === 'error').length;
            const warnings = results.violations.filter(v => v.severity === 'warning').length;
            const infos = results.violations.filter(v => v.severity === 'ignore').length;

            const summaryHtml = \`
                <div class="results-summary">
                    <div class="summary-card error">
                        <div class="number">\${errors}</div>
                        <div class="label">Errors</div>
                    </div>
                    <div class="summary-card warning">
                        <div class="number">\${warnings}</div>
                        <div class="label">Warnings</div>
                    </div>
                    <div class="summary-card success">
                        <div class="number">\${results.filesProcessed}</div>
                        <div class="label">Files</div>
                    </div>
                </div>
            \`;

            const violationsHtml = results.violations.slice(0, 50).map(v => {
                const severityClass = v.severity === 'error' ? '' : v.severity === 'warning' ? 'warning' : 'info';
                const displayPath = v.filePath.split('/').pop() || v.filePath.split('\\\\').pop();
                return \`
                    <div class="violation-item \${severityClass}" onclick="openFile('\${v.filePath}', \${v.line})">
                        <div class="violation-file">\${displayPath}:\${v.line}:\${v.column}</div>
                        <div class="violation-message">\${v.message}</div>
                        <div class="violation-rule">\${v.source} (\${v.severity})</div>
                    </div>
                \`;
            }).join('');

            container.innerHTML = summaryHtml + violationsHtml;
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'files':
                    files = message.files.map(f => ({
                        ...f,
                        name: f.path.split('/').pop() || f.path.split('\\\\').pop()
                    }));
                    renderFileList();
                    updateStatus('Ready', '');
                    break;
                case 'results':
                    checkResults = message.results;
                    renderResults(checkResults);
                    switchTab('pmd');
                    updateStatus('PMD check completed', '');
                    break;
                case 'spotbugsResults':
                    spotbugsResults = message.results;
                    renderSpotBugsResults(spotbugsResults);
                    switchTab('spotbugs');
                    updateStatus('SpotBugs check completed', '');
                    break;
                case 'checkstyleResults':
                    checkstyleResults = message.results;
                    renderCheckStyleResults(checkstyleResults);
                    switchTab('checkstyle');
                    updateStatus('CheckStyle check completed', '');
                    break;
                case 'status':
                    updateStatus(message.text, '');
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
