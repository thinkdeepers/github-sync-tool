// Git 命令封装：所有仓库操作都通过系统 git 执行。
// 认证方式：远程 URL 内置用户名 x-access-token（无密码），
// 密码通过 GIT_ASKPASS 脚本从环境变量 GIT_SYNC_TOKEN 读取，token 不落盘到 .git/config。
const { spawn } = require('child_process');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

let askpassPath = null;

function ensureAskpass() {
  if (askpassPath && fs.existsSync(askpassPath)) return askpassPath;
  const dir = app ? app.getPath('userData') : os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    askpassPath = path.join(dir, 'askpass.cmd');
    fs.writeFileSync(askpassPath, '@echo off\r\necho %GIT_SYNC_TOKEN%\r\n');
  } else {
    askpassPath = path.join(dir, 'askpass.sh');
    fs.writeFileSync(askpassPath, '#!/bin/sh\necho "$GIT_SYNC_TOKEN"\n');
    fs.chmodSync(askpassPath, 0o755);
  }
  return askpassPath;
}

// 把 https URL 注入用户名（token 经 askpass 提供）；file:// 等本地 URL 原样返回
function authUrl(cloneUrl) {
  try {
    const u = new URL(cloneUrl);
    if (u.protocol === 'https:') {
      u.username = 'x-access-token';
      return u.toString();
    }
  } catch { /* 非标准URL原样返回 */ }
  return cloneUrl;
}

function run(args, { cwd, token, identity } = {}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: ensureAskpass(),
      GIT_SYNC_TOKEN: token || '',
      // 避免走系统凭据管理器弹窗
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
    };
    const idArgs = identity
      ? ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`]
      : [];
    const child = spawn('git', [...idArgs, ...args], { cwd, env, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => resolve({ code: -1, out, err: String(e) }));
    child.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

async function must(args, opts, what) {
  const r = await run(args, opts);
  if (r.code !== 0) {
    throw new Error(`${what || 'git ' + args.join(' ')} 失败: ${r.err || r.out}`);
  }
  return r;
}

module.exports = { run, must, authUrl, ensureAskpass };
