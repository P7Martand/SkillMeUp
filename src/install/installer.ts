import * as vscode from 'vscode';
import * as os from 'os';
import { downloadRaw, getRepoTreeRecursive, TreeEntry, RepoRef } from '../util/githubFetcher';
import { CatalogItem } from '../sources/types';
import { log, logError } from '../util/logger';

export interface InstallResult {
  item: CatalogItem;
  status: 'installed' | 'skipped' | 'failed';
  destination?: string;
  message?: string;
}

export class Installer {
  async installMany(items: CatalogItem[]): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    let overwriteAll = false;
    let skipAll = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'SkillMeUp: Installing',
        cancellable: true
      },
      async (progress, token) => {
        const total = items.length;
        for (let i = 0; i < items.length; i++) {
          if (token.isCancellationRequested) {
            results.push({ item: items[i], status: 'skipped', message: 'cancelled' });
            continue;
          }
          const item = items[i];
          progress.report({
            message: `${i + 1}/${total} · ${item.name}`,
            increment: 100 / total
          });
          try {
            const dest = await this.destinationFor(item);
            const exists = await pathExists(dest);
            if (exists && !overwriteAll && !skipAll) {
              const choice = await vscode.window.showWarningMessage(
                `${item.name} already exists at ${vscode.workspace.asRelativePath(dest)}. Overwrite?`,
                { modal: true },
                'Overwrite',
                'Overwrite all',
                'Skip',
                'Skip all'
              );
              if (choice === 'Overwrite all') overwriteAll = true;
              if (choice === 'Skip all') skipAll = true;
              if (choice === 'Skip' || choice === 'Skip all' || choice === undefined) {
                results.push({ item, status: 'skipped', destination: dest.fsPath, message: 'destination exists' });
                continue;
              }
            } else if (exists && skipAll) {
              results.push({ item, status: 'skipped', destination: dest.fsPath, message: 'destination exists' });
              continue;
            }
            if (exists) {
              await vscode.workspace.fs.delete(dest, { recursive: true, useTrash: false });
            }
            await this.downloadFolder(item, dest);
            results.push({ item, status: 'installed', destination: dest.fsPath });
            log(`installed ${item.kind} ${item.name} → ${dest.fsPath}`);
          } catch (e) {
            logError(`install ${item.id}`, e);
            results.push({ item, status: 'failed', message: (e as Error).message });
          }
        }
      }
    );
    return results;
  }

  private async destinationFor(item: CatalogItem): Promise<vscode.Uri> {
    const scope = vscode.workspace.getConfiguration('skillmeup').get<string>('installScope', 'project');
    const subfolder = item.kind === 'skill' ? 'skills' : 'plugins';
    const safeName = sanitize(item.name);
    if (scope === 'user') {
      const home = vscode.Uri.file(os.homedir());
      return vscode.Uri.joinPath(home, '.claude', subfolder, safeName);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('Open a workspace folder before installing into a project.');
    }
    return vscode.Uri.joinPath(folder.uri, '.claude', subfolder, safeName);
  }

  private async downloadFolder(item: CatalogItem, dest: vscode.Uri): Promise<void> {
    const [owner, repoName] = item.sourceRepo.split('/');
    const ref: RepoRef = { owner, repo: repoName, ref: item.ref };

    // One API call gets the whole recursive tree. Everything after this uses
    // raw.githubusercontent.com which doesn't count against the API rate limit.
    const tree = await getRepoTreeRecursive(ref);
    if (tree.truncated) {
      log(`warning: git tree truncated for ${item.sourceRepo}@${item.ref} — large repo, some files may be missing`);
    }

    const prefix = item.pathInRepo ? item.pathInRepo.replace(/\/+$/, '') + '/' : '';
    const files: TreeEntry[] = tree.tree.filter(
      (e) => e.type === 'blob' && (prefix === '' || e.path === prefix.slice(0, -1) || e.path.startsWith(prefix))
    );

    if (files.length === 0) {
      throw new Error(`No files found at ${item.sourceRepo}/${item.pathInRepo}@${item.ref}`);
    }

    await vscode.workspace.fs.createDirectory(dest);
    for (const f of files) {
      const rel = prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
      if (!rel) continue;
      const buf = await downloadRaw(ref, f.path);
      const fileUri = vscode.Uri.joinPath(dest, rel);
      const parent = vscode.Uri.joinPath(fileUri, '..');
      await vscode.workspace.fs.createDirectory(parent);
      await vscode.workspace.fs.writeFile(fileUri, buf);
    }
  }
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}
