import * as vscode from 'vscode';
import { TTLCache } from './util/cache';
import { log, logError, getLogger } from './util/logger';
import { SourceRegistry } from './sources/registry';
import { scanWorkspace } from './analysis/workspaceScanner';
import { recommend } from './analysis/recommender';
import { SkillsTreeProvider } from './ui/treeProvider';
import { InstallPanel } from './ui/webview/panel';
import { Installer } from './install/installer';
import { CatalogItem, SourceConfig } from './sources/types';
import { parseGitHubUrl } from './util/githubFetcher';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = getLogger();
  channel.show(true); // surface the output channel on first activation
  log('SkillMeUp activated — open the SkillMeUp icon in the Activity Bar (left sidebar).');
  vscode.window.setStatusBarMessage('$(star) SkillMeUp activated', 5000);

  // Pop a discoverability notification with a button that opens the view.
  // The Activity Bar icon can hide under the "…" overflow on small windows.
  vscode.window
    .showInformationMessage('SkillMeUp is active. Open the panel to see suggested skills.', 'Open SkillMeUp')
    .then((choice) => {
      if (choice === 'Open SkillMeUp') {
        vscode.commands.executeCommand('workbench.view.extension.skillmeup');
      }
    });

  const cache = new TTLCache(context.globalState);
  const registry = new SourceRegistry(cache);
  const installer = new Installer();

  // When a stale-cache background refresh finishes, push the fresh data to the UI.
  registry.onRefreshed = async (freshCatalog) => {
    const signals = await scanWorkspace();
    const maxN = vscode.workspace.getConfiguration('skillmeup').get<number>('maxSuggestions', 10);
    const recs = recommend(freshCatalog, signals, maxN);
    tree.setState({ catalog: freshCatalog, recommendations: recs, loading: false });
    InstallPanel.updateIfOpen({ catalog: freshCatalog, recommendations: recs });
    log('background refresh applied to UI');
  };
  const tree = new SkillsTreeProvider();
  const treeView = vscode.window.createTreeView('skillmeup.skills', { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(treeView);

  async function refreshCatalog(force = false): Promise<void> {
    tree.setState({ loading: true, error: undefined });
    try {
      const catalog = await registry.getCatalog(force);
      const signals = await scanWorkspace();
      const maxN = vscode.workspace.getConfiguration('skillmeup').get<number>('maxSuggestions', 10);
      const recs = recommend(catalog, signals, maxN);
      tree.setState({ catalog, recommendations: recs, loading: false });
      InstallPanel.updateIfOpen({ catalog, recommendations: recs });
      if (catalog.errors.length) {
        log(`catalog completed with ${catalog.errors.length} errors`);
      }
    } catch (e) {
      logError('refresh', e);
      tree.setState({ loading: false, error: (e as Error).message });
      vscode.window.showErrorMessage(`SkillMeUp: ${(e as Error).message}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('skillmeup.refresh', () => refreshCatalog(true))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('skillmeup.openInstallPanel', async () => {
      // Make sure we have something to show
      const catalog = await registry.getCatalog(false);
      const signals = await scanWorkspace();
      const maxN = vscode.workspace.getConfiguration('skillmeup').get<number>('maxSuggestions', 10);
      const recs = recommend(catalog, signals, maxN);
      tree.setState({ catalog, recommendations: recs, loading: false });
      InstallPanel.show(context, { catalog, recommendations: recs }, installer);
    })
  );

  context.subscriptions.push(
    // urlArg / kindArg allow callers (e.g. the webview GitHub search) to skip the prompts.
    vscode.commands.registerCommand('skillmeup.addSource', async (urlArg?: string, kindArg?: string) => {
      const url = urlArg ?? await vscode.window.showInputBox({
        title: 'SkillMeUp: Add Source',
        prompt: 'Paste a GitHub repository URL',
        placeHolder: 'https://github.com/owner/repo',
        validateInput: (v) => (parseGitHubUrl(v.trim()) ? null : 'Must be a github.com URL')
      });
      if (!url) return;
      const kind = kindArg
        ? { label: kindArg }
        : await vscode.window.showQuickPick(
            [
              { label: 'repo', description: 'Auto-detect: skill, plugin, or marketplace' },
              { label: 'marketplace', description: 'Repo containing .claude-plugin/marketplace.json' },
              { label: 'awesome-list', description: 'README-style index of multiple repos' }
            ],
            { title: 'How should this source be parsed?' }
          );
      if (!kind) return;
      await registry.addSource(url.trim(), kind.label as SourceConfig['kind']);
      await refreshCatalog(true);
      vscode.window.showInformationMessage(`SkillMeUp: added source ${url}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('skillmeup.installItem', async (arg: CatalogItem | { item?: CatalogItem }) => {
      const item = isCatalogItem(arg) ? arg : arg?.item;
      if (!item) return;
      const results = await installer.installMany([item]);
      const r = results[0];
      if (r.status === 'installed') {
        vscode.window.showInformationMessage(`SkillMeUp: installed ${item.name}`);
      } else if (r.status === 'failed') {
        vscode.window.showErrorMessage(`SkillMeUp: ${item.name} failed — ${r.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('skillmeup.viewDetails', (arg: CatalogItem | { item?: CatalogItem }) => {
      const item = isCatalogItem(arg) ? arg : arg?.item;
      if (!item) return;
      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`# ${item.name}\n\n_${item.kind}_  ·  [${item.sourceRepo}](${item.sourceUrl})\n\n`);
      if (item.description) md.appendMarkdown(`${item.description}\n\n`);
      if (item.kind === 'skill') {
        if (item.whenToUse) md.appendMarkdown(`**When to use:** ${item.whenToUse}\n\n`);
        if (item.paths?.length) md.appendMarkdown(`**Paths:** \`${item.paths.join('`, `')}\`\n\n`);
        if (item.allowedTools?.length) md.appendMarkdown(`**Allowed tools:** ${item.allowedTools.join(', ')}\n\n`);
      } else {
        if (item.version) md.appendMarkdown(`**Version:** ${item.version}\n\n`);
        if (item.author) md.appendMarkdown(`**Author:** ${item.author}\n\n`);
        if (item.skills?.length) md.appendMarkdown(`**Skills:** ${item.skills.join(', ')}\n\n`);
        if (item.commands?.length) md.appendMarkdown(`**Commands:** ${item.commands.join(', ')}\n\n`);
        if (item.agents?.length) md.appendMarkdown(`**Agents:** ${item.agents.join(', ')}\n\n`);
      }
      // Quick pop-up modal with an Install action.
      vscode.window
        .showInformationMessage(
          `${item.name} (${item.kind})\n\n${item.description ?? ''}`,
          { modal: true, detail: detailFor(item) },
          'Install',
          'Open on GitHub'
        )
        .then(async (choice) => {
          if (choice === 'Install') {
            await vscode.commands.executeCommand('skillmeup.installItem', item);
          } else if (choice === 'Open on GitHub') {
            await vscode.env.openExternal(vscode.Uri.parse(item.sourceUrl));
          }
        });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('skillmeup.openOnGitHub', async (arg: CatalogItem | { item?: CatalogItem }) => {
      const item = isCatalogItem(arg) ? arg : arg?.item;
      if (!item) return;
      await vscode.env.openExternal(vscode.Uri.parse(item.sourceUrl));
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('skillmeup.sources')) {
        refreshCatalog(true);
      } else if (e.affectsConfiguration('skillmeup.maxSuggestions')) {
        refreshCatalog(false);
      }
    })
  );

  // Initial load (cached).
  refreshCatalog(false);
}

export function deactivate(): void {
  log('SkillMeUp deactivating');
}

function isCatalogItem(v: unknown): v is CatalogItem {
  return !!v && typeof v === 'object' && 'kind' in (v as object) && 'sourceRepo' in (v as object);
}

function detailFor(item: CatalogItem): string {
  const parts: string[] = [];
  if (item.kind === 'skill') {
    if (item.whenToUse) parts.push(`When to use: ${item.whenToUse}`);
    if (item.paths?.length) parts.push(`Paths: ${item.paths.join(', ')}`);
  } else {
    if (item.version) parts.push(`Version: ${item.version}`);
    if (item.skills?.length) parts.push(`Skills: ${item.skills.join(', ')}`);
  }
  parts.push(`Source: ${item.sourceRepo}@${item.ref}`);
  return parts.join('\n');
}
