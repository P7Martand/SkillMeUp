import * as vscode from 'vscode';
import { Catalog, CatalogItem, Recommendation, SourceConfig } from '../sources/types';

type NodeKind = 'section' | 'item' | 'source' | 'empty';

export interface TreeNode {
  kind: NodeKind;
  label: string;
  description?: string;
  tooltip?: string | vscode.MarkdownString;
  children?: TreeNode[];
  item?: CatalogItem;
  source?: SourceConfig;
  contextValue?: string;
}

export interface TreeViewState {
  catalog: Catalog;
  recommendations: Recommendation[];
  loading: boolean;
  error?: string;
}

export class SkillsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: TreeViewState = {
    catalog: { skills: [], plugins: [], fetchedAt: 0, errors: [] },
    recommendations: [],
    loading: false
  };

  setState(next: Partial<TreeViewState>): void {
    this.state = { ...this.state, ...next };
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const collapsible =
      node.kind === 'section'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const ti = new vscode.TreeItem(node.label, collapsible);
    ti.description = node.description;
    ti.tooltip = node.tooltip;
    ti.contextValue = node.contextValue;

    if (node.kind === 'item' && node.item) {
      ti.iconPath = new vscode.ThemeIcon(node.item.kind === 'skill' ? 'symbol-event' : 'package');
      ti.command = {
        command: 'skillmeup.viewDetails',
        title: 'View details',
        arguments: [node.item]
      };
    } else if (node.kind === 'section') {
      ti.iconPath = new vscode.ThemeIcon('folder');
    } else if (node.kind === 'source') {
      ti.iconPath = new vscode.ThemeIcon('cloud');
    } else if (node.kind === 'empty') {
      ti.iconPath = new vscode.ThemeIcon('info');
    }
    return ti;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) return this.rootSections();
    if (node.children) return node.children;
    return [];
  }

  private rootSections(): TreeNode[] {
    if (this.state.loading) {
      return [{ kind: 'empty', label: 'Loading catalog…' }];
    }
    if (this.state.error) {
      return [{ kind: 'empty', label: `Error: ${this.state.error}` }];
    }
    const suggested: TreeNode = {
      kind: 'section',
      label: 'Suggested',
      description: `${this.state.recommendations.length}`,
      children:
        this.state.recommendations.length === 0
          ? [{ kind: 'empty', label: 'No suggestions yet — open a workspace and refresh.' }]
          : this.state.recommendations.map((r) => ({
              kind: 'item',
              label: r.item.name,
              description: `${r.item.kind}${r.reasons[0] ? ` · ${r.reasons[0]}` : ''}`,
              tooltip: this.tooltipFor(r.item, r.reasons),
              item: r.item,
              contextValue: r.item.kind
            }))
    };
    const allSkills: TreeNode = {
      kind: 'section',
      label: 'All Skills',
      description: `${this.state.catalog.skills.length}`,
      children:
        this.state.catalog.skills.length === 0
          ? [{ kind: 'empty', label: 'No skills loaded yet.' }]
          : this.state.catalog.skills.map((s) => ({
              kind: 'item',
              label: s.name,
              description: s.sourceRepo,
              tooltip: this.tooltipFor(s),
              item: s,
              contextValue: 'skill'
            }))
    };
    const allPlugins: TreeNode = {
      kind: 'section',
      label: 'All Plugins',
      description: `${this.state.catalog.plugins.length}`,
      children:
        this.state.catalog.plugins.length === 0
          ? [{ kind: 'empty', label: 'No plugins loaded yet.' }]
          : this.state.catalog.plugins.map((p) => ({
              kind: 'item',
              label: p.name,
              description: p.sourceRepo,
              tooltip: this.tooltipFor(p),
              item: p,
              contextValue: 'plugin'
            }))
    };
    const sources = vscode.workspace.getConfiguration('skillmeup').get<SourceConfig[]>('sources', []);
    const sourcesNode: TreeNode = {
      kind: 'section',
      label: 'Sources',
      description: `${sources.length}`,
      children: sources.map((s) => ({
        kind: 'source',
        label: s.url.replace(/^https?:\/\//, ''),
        description: s.kind,
        tooltip: s.url,
        source: s,
        contextValue: 'source'
      }))
    };
    return [suggested, allSkills, allPlugins, sourcesNode];
  }

  private tooltipFor(item: CatalogItem, reasons?: string[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**${item.name}** _(${item.kind})_\n\n`);
    if (item.description) md.appendMarkdown(`${item.description}\n\n`);
    if (item.kind === 'skill') {
      if (item.whenToUse) md.appendMarkdown(`_When to use:_ ${item.whenToUse}\n\n`);
      if (item.paths?.length) md.appendMarkdown(`_Paths:_ \`${item.paths.join('`, `')}\`\n\n`);
    } else {
      if (item.version) md.appendMarkdown(`_Version:_ ${item.version}\n\n`);
      if (item.author) md.appendMarkdown(`_Author:_ ${item.author}\n\n`);
      if (item.skills?.length) md.appendMarkdown(`_Skills:_ ${item.skills.join(', ')}\n\n`);
    }
    md.appendMarkdown(`_Source:_ ${item.sourceRepo}@${item.ref}\n`);
    if (reasons?.length) md.appendMarkdown(`\n**Why suggested:** ${reasons.join('; ')}`);
    return md;
  }
}
