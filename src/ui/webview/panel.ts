import * as vscode from 'vscode';
import { CatalogItem, Recommendation, Catalog } from '../../sources/types';
import { Installer } from '../../install/installer';
import { log } from '../../util/logger';
import { search, SearchFilters } from '../../search/searchEngine';
import { CATEGORIES } from '../../shared/indexTypes';

export interface PanelData {
  recommendations: Recommendation[];
  catalog: Catalog;
}

export class InstallPanel {
  private static current: InstallPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, data: PanelData, installer: Installer): InstallPanel {
    if (InstallPanel.current) {
      InstallPanel.current.panel.reveal(vscode.ViewColumn.Active);
      InstallPanel.current.update(data);
      return InstallPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'skillmeupInstall',
      'SkillMeUp · Install',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'media')]
      }
    );
    InstallPanel.current = new InstallPanel(context, panel, installer, data);
    return InstallPanel.current;
  }

  static updateIfOpen(data: PanelData): void {
    InstallPanel.current?.update(data);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private readonly installer: Installer,
    initialData: PanelData
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml();
    this.update(initialData);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  update(data: PanelData): void {
    this.lastItems = [...data.catalog.skills, ...data.catalog.plugins];
    this.panel.webview.postMessage({ type: 'state', data: serialize(data) });
  }

  private async handleMessage(msg: any): Promise<void> {
    if (msg?.type === 'install') {
      const ids: string[] = msg.ids ?? [];
      log(`webview install request: ${ids.length} items`);
      const items = this.lastItems.filter((i) => ids.includes(i.id));
      const results = await this.installer.installMany(items);
      this.panel.webview.postMessage({ type: 'install:done', results });
      const installed = results.filter((r) => r.status === 'installed').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const reveal = 'Reveal in Explorer';
      const action = await vscode.window.showInformationMessage(
        `SkillMeUp: ${installed} installed, ${failed} failed.`,
        ...(installed ? [reveal] : [])
      );
      if (action === reveal) {
        const first = results.find((r) => r.status === 'installed' && r.destination);
        if (first?.destination) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(first.destination));
        }
      }
    } else if (msg?.type === 'open-github') {
      const url = msg.url as string;
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (msg?.type === 'add-source') {
      await vscode.commands.executeCommand('skillmeup.addSource');
    } else if (msg?.type === 'refresh') {
      await vscode.commands.executeCommand('skillmeup.refresh');
    } else if (msg?.type === 'search') {
      const query = (msg.query as string | undefined) ?? '';
      const filters = (msg.filters as SearchFilters | undefined) ?? {};
      const results = search(this.lastItems, query, filters);
      this.panel.webview.postMessage({
        type: 'results',
        ids: results.map((r) => r.item.id)
      });
    }
  }

  private lastItems: CatalogItem[] = [];

  private renderHtml(): string {
    const webview = this.panel.webview;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'media');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'));
    const nonce = nonceStr();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;" />
  <link rel="stylesheet" href="${css}" />
  <title>SkillMeUp</title>
</head>
<body>
  <header>
    <h1>SkillMeUp</h1>
    <div class="actions">
      <button id="add-source" class="ghost" title="Add a source from a GitHub URL">+ Source</button>
      <button id="refresh" class="ghost" title="Refresh catalog">Refresh</button>
    </div>
  </header>
  <div class="searchbar">
    <input id="search" type="text" placeholder="Search skills & plugins…" />
  </div>
  <div id="filters" class="filters"></div>
  <main id="content">
    <p class="muted">Loading…</p>
  </main>
  <footer>
    <span id="summary" class="muted"></span>
    <div class="footer-actions">
      <button id="cancel" class="ghost">Cancel</button>
      <button id="install" class="primary" disabled>Install 0</button>
    </div>
  </footer>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  dispose(): void {
    InstallPanel.current = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }
}

function serialize(data: PanelData): {
  items: CatalogItem[];
  suggestedIds: string[];
  reasons: Record<string, string[]>;
  facets: { categories: string[]; counts: { skills: number; plugins: number; verified: number; community: number } };
} {
  const items = [...data.catalog.skills, ...data.catalog.plugins];
  const reasons: Record<string, string[]> = {};
  const suggestedIds: string[] = [];
  for (const r of data.recommendations) {
    suggestedIds.push(r.item.id);
    reasons[r.item.id] = r.reasons;
  }
  const present = new Set(items.map((i) => i.category).filter(Boolean) as string[]);
  return {
    items,
    suggestedIds,
    reasons,
    facets: {
      categories: CATEGORIES.filter((c) => present.has(c)),
      counts: {
        skills: data.catalog.skills.length,
        plugins: data.catalog.plugins.length,
        verified: items.filter((i) => i.tier === 'verified').length,
        community: items.filter((i) => i.tier === 'community').length
      }
    }
  };
}

function nonceStr(): string {
  let t = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
  return t;
}
