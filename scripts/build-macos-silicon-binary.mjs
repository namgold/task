import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { inject } from 'postject';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'release');
const bundlePath = path.join(outDir, 'task.bundle.cjs');
const seaConfigPath = path.join(outDir, 'task.sea.json');
const blobPath = path.join(outDir, 'task.blob');
const binaryPath = path.join(outDir, 'task-darwin-arm64');

await fs.mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'src/cli.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'bundle',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

await fs.writeFile(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true
    },
    null,
    2
  ),
  'utf8'
);

await execFileAsync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
  cwd: rootDir,
  env: {
    ...process.env,
    NODE_DISABLE_COLORS: '1'
  }
});

const nodeBinary = process.execPath;
await fs.rm(binaryPath, { force: true, recursive: true });
await fs.copyFile(nodeBinary, binaryPath);
await inject(binaryPath, 'NODE_SEA_BLOB', await fs.readFile(blobPath), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
});
await fs.chmod(binaryPath, 0o755);

console.log(binaryPath);
