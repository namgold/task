import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { buildBashCompletionScript, buildFishCompletionScript, buildZshCompletionScript } from './completion.js';

type CompletionTarget = {
  filePath: string;
  content: string;
};

if (isExecutedDirectly()) {
  await main();
}

export async function main(): Promise<void> {
  await installCompletions([
    {
      filePath: path.join(getXdgDataHome(), 'bash-completion', 'completions', 'task'),
      content: buildBashCompletionScript()
    },
    {
      filePath: path.join(getFishConfigHome(), 'completions', 'task.fish'),
      content: buildFishCompletionScript()
    },
    {
      filePath: path.join(getXdgDataHome(), 'zsh', 'site-functions', '_task'),
      content: buildZshCompletionScript()
    },
    {
      filePath: path.join(os.homedir(), '.zsh', 'completion', '_task'),
      content: buildZshCompletionScript()
    }
  ]);
}

export async function installCompletions(entries: CompletionTarget[]): Promise<void> {
  for (const entry of entries) {
    try {
      await writeFileIfChanged(entry.filePath, entry.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`task: warning: could not install completion to ${entry.filePath}: ${message}\n`);
    }
  }
}

async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    const current = await fs.readFile(filePath, 'utf8');
    if (current === content) {
      return;
    }
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }

  await fs.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function getFishConfigHome(): string {
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'fish');
}

function getXdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

function isExecutedDirectly(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;
}
