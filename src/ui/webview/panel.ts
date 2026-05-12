import * as vscode from 'vscode';
import { CatalogItem, Recommendation, Catalog } from '../../sources/types';
import { Installer } from '../../install/installer';
import { log } from '../../util/logger';
import { searchGitHubForSkills, RateLimitError } from '../../util/githubSearch';

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
    } else if (msg?.type === 'search-github') {
      const query = (msg.query as string | undefined)?.trim();
      if (!query) return;
      try {
        const results = await searchGitHubForSkills(query);
        this.panel.webview.postMessage({ type: 'github-results', results });
      } catch (e) {
        const errMsg = e instanceof RateLimitError
          ? e.message
          : `GitHub search failed: ${(e as Error).message}`;
        this.panel.webview.postMessage({ type: 'github-error', message: errMsg });
      }
    } else if (msg?.type === 'add-github-source') {
      const url = msg.url as string;
      if (url) await vscode.commands.executeCommand('skillmeup.addSource', url, 'repo');
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
    <input id="search" type="text" placeholder="Filter by name or description…" />
  </div>
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
  suggested: Array<{ item: CatalogItem; reasons: string[] }>;
  others: CatalogItem[];
} {
  const seen = new Set<string>();
  const suggested = data.recommendations.map((r) => {
    seen.add(r.item.id);
    return { item: r.item, reasons: r.reasons };
  });
  const others = [...data.catalog.skills, ...data.catalog.plugins].filter((i) => !seen.has(i.id));
  return { suggested, others };
}

function nonceStr(): string {
  let t = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length));
  return t;
}
