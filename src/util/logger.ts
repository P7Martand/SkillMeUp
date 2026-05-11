import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('SkillMeUp');
  }
  return channel;
}

export function log(msg: string, ...rest: unknown[]): void {
  const c = getLogger();
  const tail = rest.length ? ' ' + rest.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join(' ') : '';
  c.appendLine(`[${new Date().toISOString()}] ${msg}${tail}`);
}

export function logError(prefix: string, err: unknown): void {
  const c = getLogger();
  const m = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  c.appendLine(`[${new Date().toISOString()}] ERROR ${prefix}: ${m}`);
}
