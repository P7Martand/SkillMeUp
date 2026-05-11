import * as vscode from 'vscode';
import { log, logError } from '../util/logger';

export interface WorkspaceSignals {
  files: string[];                  // relative POSIX paths, capped for perf
  dependencies: Set<string>;        // npm + python package names
  hasNodeProject: boolean;
  hasPythonProject: boolean;
  languages: Set<string>;           // e.g. "typescript", "python"
  readme: string;                   // concatenated README content, lowercase
  flags: {
    hasNotebooks: boolean;
    hasPdf: boolean;
    hasPlaywright: boolean;
    hasDocker: boolean;
    hasGitHubActions: boolean;
  };
}

const MAX_FILES = 2000;

export async function scanWorkspace(): Promise<WorkspaceSignals> {
  const empty: WorkspaceSignals = {
    files: [],
    dependencies: new Set(),
    hasNodeProject: false,
    hasPythonProject: false,
    languages: new Set(),
    readme: '',
    flags: {
      hasNotebooks: false,
      hasPdf: false,
      hasPlaywright: false,
      hasDocker: false,
      hasGitHubActions: false
    }
  };
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return empty;

  const signals = empty;

  // List files (capped). Exclude common heavy folders.
  const uris = await vscode.workspace.findFiles('**/*', '**/{node_modules,out,dist,.git,.next,.venv,venv,__pycache__,target,build}/**', MAX_FILES);
  for (const uri of uris) {
    const rel = vscode.workspace.asRelativePath(uri, false);
    signals.files.push(rel);
  }

  // Flags from filenames
  for (const f of signals.files) {
    const lower = f.toLowerCase();
    if (lower.endsWith('.ipynb')) signals.flags.hasNotebooks = true;
    if (lower.endsWith('.pdf')) signals.flags.hasPdf = true;
    if (/playwright\.config\.(js|ts|mjs|cjs)$/.test(lower)) signals.flags.hasPlaywright = true;
    if (/(^|\/)dockerfile(\.[a-z0-9]+)?$/i.test(f) || lower.endsWith('docker-compose.yml')) signals.flags.hasDocker = true;
    if (/^\.github\/workflows\//.test(f)) signals.flags.hasGitHubActions = true;
    const ext = lower.slice(lower.lastIndexOf('.') + 1);
    if (ext === 'ts' || ext === 'tsx') signals.languages.add('typescript');
    if (ext === 'js' || ext === 'jsx') signals.languages.add('javascript');
    if (ext === 'py') signals.languages.add('python');
    if (ext === 'go') signals.languages.add('go');
    if (ext === 'rs') signals.languages.add('rust');
    if (ext === 'java') signals.languages.add('java');
    if (ext === 'rb') signals.languages.add('ruby');
  }

  // package.json
  await readJsonFiles('**/package.json', '**/node_modules/**', (json) => {
    signals.hasNodeProject = true;
    collectDeps(json?.dependencies, signals.dependencies);
    collectDeps(json?.devDependencies, signals.dependencies);
    collectDeps(json?.peerDependencies, signals.dependencies);
  });

  // pyproject.toml and requirements.txt
  await readTextFiles('**/pyproject.toml', '**/{.venv,venv}/**', (text) => {
    signals.hasPythonProject = true;
    for (const m of text.matchAll(/^\s*"?([a-zA-Z0-9_.\-]+)"?\s*=\s*"/gm)) {
      const dep = m[1].toLowerCase();
      if (dep.length > 1 && dep !== 'python') signals.dependencies.add(dep);
    }
    for (const m of text.matchAll(/(?:^|\n)\s*"([a-zA-Z0-9_.\-]+)\s*[<>=~!]/g)) {
      signals.dependencies.add(m[1].toLowerCase());
    }
  });
  await readTextFiles('**/requirements*.txt', '**/{.venv,venv}/**', (text) => {
    signals.hasPythonProject = true;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([a-zA-Z0-9_.\-]+)/);
      if (m && !m[1].startsWith('#')) signals.dependencies.add(m[1].toLowerCase());
    }
  });

  // README
  const readmes = await vscode.workspace.findFiles('{README.md,README.MD,Readme.md,readme.md}', null, 3);
  let readmeText = '';
  for (const r of readmes) {
    try {
      const buf = await vscode.workspace.fs.readFile(r);
      readmeText += '\n' + new TextDecoder().decode(buf);
    } catch (e) {
      logError(`read ${r.fsPath}`, e);
    }
  }
  signals.readme = readmeText.toLowerCase();

  log(`scan: ${signals.files.length} files, ${signals.dependencies.size} deps, langs=${[...signals.languages].join(',')}`);
  return signals;
}

function collectDeps(obj: unknown, into: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) into.add(k.toLowerCase());
}

async function readJsonFiles(glob: string, exclude: string, cb: (json: any) => void): Promise<void> {
  const uris = await vscode.workspace.findFiles(glob, exclude, 5);
  for (const u of uris) {
    try {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
      cb(JSON.parse(text));
    } catch (e) {
      logError(`readJson ${u.fsPath}`, e);
    }
  }
}

async function readTextFiles(glob: string, exclude: string, cb: (text: string) => void): Promise<void> {
  const uris = await vscode.workspace.findFiles(glob, exclude, 5);
  for (const u of uris) {
    try {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
      cb(text);
    } catch (e) {
      logError(`readText ${u.fsPath}`, e);
    }
  }
}
