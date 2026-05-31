import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface PMDConfig {
    rulesetPath: string;
    pmdPath: string;
    outputFormat: 'json' | 'xml' | 'text';
    outputPath: string;
    autoCheckOnSave: boolean;
    fileExtensions: string[];
}

export interface SpotBugsConfig {
    spotbugsPath: string;
    spotbugsOutputPath: string;
    enableFindSecBugs: boolean;
    spotbugsMinPriority: 'high' | 'medium' | 'low';
}

export interface CheckStyleConfig {
    checkstylePath: string;
    checkstyleConfigPath: string;
    checkstyleSuppressionsPath: string;
    checkstyleOutputPath: string;
}

export class ConfigService {
    private static instance: ConfigService;
    private configChangeEmitter = new vscode.EventEmitter<void>();
    public readonly onConfigChange = this.configChangeEmitter.event;

    private constructor() {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('javaCodeChecker')) {
                this.configChangeEmitter.fire();
            }
        });
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public getConfig(): PMDConfig {
        const config = vscode.workspace.getConfiguration('javaCodeChecker');
        return {
            rulesetPath: config.get<string>('rulesetPath', ''),
            pmdPath: config.get<string>('pmdPath', 'pmd'),
            outputFormat: config.get<'json' | 'xml' | 'text'>('outputFormat', 'json'),
            outputPath: config.get<string>('outputPath', 'pmd-report.md'),
            autoCheckOnSave: config.get<boolean>('autoCheckOnSave', false),
            fileExtensions: config.get<string[]>('fileExtensions', ['java'])
        };
    }

    public getSpotBugsConfig(): SpotBugsConfig {
        const config = vscode.workspace.getConfiguration('javaCodeChecker');
        return {
            spotbugsPath: config.get<string>('spotbugsPath', ''),
            spotbugsOutputPath: config.get<string>('spotbugsOutputPath', 'spotbugs-report.md'),
            enableFindSecBugs: config.get<boolean>('enableFindSecBugs', true),
            spotbugsMinPriority: config.get<'high' | 'medium' | 'low'>('spotbugsMinPriority', 'medium')
        };
    }

    public getCheckStyleConfig(): CheckStyleConfig {
        const config = vscode.workspace.getConfiguration('javaCodeChecker');
        return {
            checkstylePath: config.get<string>('checkstylePath', ''),
            checkstyleConfigPath: config.get<string>('checkstyleConfigPath', '/sun_checks.xml'),
            checkstyleSuppressionsPath: config.get<string>('checkstyleSuppressionsPath', ''),
            checkstyleOutputPath: config.get<string>('checkstyleOutputPath', 'checkstyle-report.md')
        };
    }

    public async updateConfig(key: keyof PMDConfig, value: any): Promise<void> {
        const config = vscode.workspace.getConfiguration('javaCodeChecker');
        await config.update(key, value, true);
    }

    public async validateRulesetPath(rulesetPath: string): Promise<{ valid: boolean; message?: string }> {
        if (!rulesetPath) {
            return { valid: false, message: 'Ruleset path is empty' };
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return { valid: false, message: 'No workspace folder open' };
        }

        let fullPath = rulesetPath;
        if (!path.isAbsolute(rulesetPath)) {
            fullPath = path.join(workspaceFolders[0].uri.fsPath, rulesetPath);
        }

        try {
            const stats = await fs.promises.stat(fullPath);
            if (!stats.isFile()) {
                return { valid: false, message: 'Ruleset path is not a file' };
            }

            const content = await fs.promises.readFile(fullPath, 'utf-8');
            if (!this.isValidRulesetContent(content)) {
                return { valid: false, message: 'Invalid PMD ruleset XML format' };
            }

            return { valid: true };
        } catch (error) {
            return { valid: false, message: `Cannot read ruleset file: ${error}` };
        }
    }

    private isValidRulesetContent(content: string): boolean {
        const hasRulesetTag = content.includes('<ruleset') || content.includes('<ruleset ');
        const hasXmlDeclaration = content.includes('<?xml');
        return hasRulesetTag;
    }

    public getDefaultRulesetContent(): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<ruleset name="default-ruleset"
         xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0 https://pmd.sourceforge.io/ruleset_2_0_0.xsd">
    <description>Default PMD Ruleset</description>
    
    <!-- Best Practices -->
    <rule ref="category/java/bestpractices.xml">
        <exclude name="SystemPrintln"/>
    </rule>
    
    <!-- Code Style -->
    <rule ref="category/java/codestyle.xml">
        <exclude name="ShortVariable"/>
        <exclude name="LongVariable"/>
    </rule>
    
    <!-- Design -->
    <rule ref="category/java/design.xml">
        <exclude name="LawOfDemeter"/>
    </rule>
    
    <!-- Error Prone -->
    <rule ref="category/java/errorprone.xml"/>
    
    <!-- Performance -->
    <rule ref="category/java/performance.xml"/>
    
    <!-- Security -->
    <rule ref="category/java/security.xml"/>
</ruleset>`;
    }

    public async createDefaultRuleset(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        const defaultPath = path.join(workspaceFolders[0].uri.fsPath, 'pmd-ruleset.xml');

        try {
            await fs.promises.writeFile(defaultPath, this.getDefaultRulesetContent(), 'utf-8');
            return defaultPath;
        } catch (error) {
            console.error('Failed to create default ruleset:', error);
            return undefined;
        }
    }

    public getDefaultCheckStyleConfigContent(): string {
        return `<?xml version="1.0"?>
<!DOCTYPE module PUBLIC
          "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN"
          "https://checkstyle.org/dtds/configuration_1_3.dtd">
<module name="Checker">
    <module name="TreeWalker">
        <!-- Naming Conventions -->
        <module name="ConstantName"/>
        <module name="LocalVariableName"/>
        <module name="MemberName"/>
        <module name="MethodName"/>
        <module name="PackageName"/>
        <module name="ParameterName"/>
        <module name="TypeName"/>

        <!-- Code Style -->
        <module name="AvoidStarImport"/>
        <module name="EmptyStatement"/>
        <module name="EqualsHashCode"/>
        <module name="IllegalImport"/>
        <module name="MissingSwitchDefault"/>
        <module name="ModifierOrder"/>
        <module name="RedundantModifier"/>
        <module name="SimplifyBooleanExpression"/>
        <module name="SimplifyBooleanReturn"/>
        <module name="StringLiteralEquality"/>
        <module name="NestedIfDepth">
            <property name="max" value="3"/>
        </module>
        <module name="NestedTryDepth">
            <property name="max" value="3"/>
        </module>
        <module name="NoFinalizer"/>
        <module name="SuperClone"/>
        <module name="SuperFinalize"/>
        <module name="PackageDeclaration"/>
        <module name="FallThrough"/>
        <module name="MultipleStringLiterals">
            <property name="allowedDuplicates" value="3"/>
        </module>

        <!-- Size Violations -->
        <module name="LineLength">
            <property name="max" value="120"/>
        </module>
        <module name="MethodLength">
            <property name="max" value="150"/>
        </module>
        <module name="ParameterNumber">
            <property name="max" value="7"/>
        </module>
        <module name="OuterTypeNumber"/>

        <!-- Whitespace -->
        <module name="EmptyForIteratorPad"/>
        <module name="MethodParamPad"/>
        <module name="NoWhitespaceAfter"/>
        <module name="NoWhitespaceBefore"/>
        <module name="OperatorWrap"/>
        <module name="ParenPad"/>
        <module name="TypecastParenPad"/>
        <module name="WhitespaceAfter"/>
        <module name="WhitespaceAround"/>

        <!-- Javadoc -->
        <module name="MissingJavadocMethod">
            <property name="scope" value="public"/>
            <property name="allowMissingPropertyJavadoc" value="true"/>
        </module>
        <module name="MissingJavadocType">
            <property name="scope" value="public"/>
        </module>
    </module>

    <!-- File-level checks -->
    <module name="FileLength">
        <property name="max" value="1000"/>
    </module>
    <module name="FileTabCharacter">
        <property name="eachLine" value="true"/>
    </module>
</module>`;
    }

    public async createDefaultCheckStyleConfig(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        const defaultPath = path.join(workspaceFolders[0].uri.fsPath, 'checkstyle-config.xml');

        try {
            await fs.promises.writeFile(defaultPath, this.getDefaultCheckStyleConfigContent(), 'utf-8');
            return defaultPath;
        } catch (error) {
            console.error('Failed to create default CheckStyle config:', error);
            return undefined;
        }
    }
}
