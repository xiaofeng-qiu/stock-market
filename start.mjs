// 一条命令同时启动前端与后端：node start.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const children = [];

function run(name, cwd, args) {
  const p = spawn(npmCmd, args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
  });
  p.on('exit', (code) => console.log(`[${name}] 退出 code=${code}`));
  children.push(p);
  return p;
}

console.log('启动 prediction-app（前端 http://127.0.0.1:4200  ·  后端 http://127.0.0.1:4300）');
run('server', path.join(root, 'server'), ['start']);
run('web', root, ['run', 'start']);

const shutdown = () => {
  children.forEach(p => { try { p.kill(); } catch { /* ignore */ } });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
