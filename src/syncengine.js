// 双向同步引擎：
// 本地方向：chokidar 监听文件变动 → 防抖 → 自动 commit + push
// 云端方向：定时 fetch → 有新提交则 merge 到本地
// 冲突：中止合并，任务进入"冲突"状态等用户选择（以本地为准 / 以云端为准）
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const { run, must, authUrl } = require('./gitops');

const GIT_DIR_RE = /(^|[/\\])\.git([/\\]|$)/;

class SyncTask {
  constructor(data, ctx) {
    // data: {id, repoFullName, cloneUrl, branch, folder, enabled}
    Object.assign(this, data);
    this.ctx = ctx; // {getToken, getIdentity, onUpdate, log, getPollInterval}
    this.status = data.enabled ? 'idle' : 'paused';
    this.lastSync = null;
    this.error = null;
    this._chain = Promise.resolve();
    this._debounce = null;
    this._watcher = null;
    this._timer = null;
  }

  view() {
    const { id, repoFullName, branch, folder, enabled, status, lastSync, error } = this;
    return { id, repoFullName, branch, folder, enabled, status, lastSync, error };
  }

  log(msg) { this.ctx.log(`[${this.repoFullName}#${this.branch}] ${msg}`); }
  setStatus(s, err = null) { this.status = s; this.error = err; this.ctx.onUpdate(); }

  opts() {
    return { cwd: this.folder, token: this.ctx.getToken(), identity: this.ctx.getIdentity() };
  }

  // ---------- 初始化：把本地文件夹和远程分支关联起来 ----------
  async initialize({ createBranch = false, baseBranch = null } = {}) {
    this.setStatus('init');
    const token = this.ctx.getToken();
    const url = authUrl(this.cloneUrl);
    const exists = fs.existsSync(this.folder);
    const entries = exists ? fs.readdirSync(this.folder) : [];
    const isRepo = exists && fs.existsSync(path.join(this.folder, '.git'));

    try {
      if (isRepo) {
        // 已是 git 仓库：校验远程并切到目标分支
        this.log('检测到已有 Git 仓库，直接关联');
        await must(['remote', 'set-url', 'origin', url], this.opts(), '设置远程地址');
        const f = await run(['fetch', 'origin', `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`], this.opts());
        if (f.code === 0) {
          const co = await run(['checkout', this.branch], this.opts());
          if (co.code !== 0) {
            await must(['checkout', '-b', this.branch, `origin/${this.branch}`], this.opts(), '切换分支');
          }
        } else if (createBranch) {
          await must(['checkout', '-b', this.branch], this.opts(), '创建分支');
          await must(['push', '-u', 'origin', this.branch], this.opts(), '推送新分支');
        } else {
          throw new Error(`远程分支 ${this.branch} 不存在`);
        }
      } else if (!exists || entries.length === 0) {
        // 空文件夹：直接克隆
        fs.mkdirSync(this.folder, { recursive: true });
        if (createBranch) {
          this.log(`克隆 ${baseBranch} 并创建新分支 ${this.branch}`);
          await must(['clone', '--branch', baseBranch, url, '.'], this.opts(), '克隆仓库');
          await must(['checkout', '-b', this.branch], this.opts(), '创建分支');
          await must(['push', '-u', 'origin', this.branch], this.opts(), '推送新分支');
        } else {
          this.log(`克隆分支 ${this.branch}`);
          await must(['clone', '--branch', this.branch, '--single-branch', url, '.'], this.opts(), '克隆仓库');
        }
      } else {
        // 非空且不是仓库：初始化并把本地文件合并进分支（冲突以本地为准）
        this.log('非空文件夹：初始化仓库并合并远程内容（冲突以本地文件为准）');
        await must(['init', '-b', this.branch], this.opts(), '初始化仓库');
        await must(['remote', 'add', 'origin', url], this.opts(), '添加远程');
        await must(['add', '-A'], this.opts(), '暂存本地文件');
        await must(['commit', '-m', '本地初始文件'], this.opts(), '提交本地文件');
        const f = await run(['fetch', 'origin', `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`], this.opts());
        if (f.code === 0) {
          await must(['merge', `origin/${this.branch}`, '--allow-unrelated-histories', '-X', 'ours', '--no-edit'], this.opts(), '合并远程内容');
        } else if (!createBranch) {
          throw new Error(`远程分支 ${this.branch} 不存在`);
        }
        await must(['push', '-u', 'origin', this.branch], this.opts(), '推送');
      }
      this.log('初始化完成');
      this.lastSync = new Date().toISOString();
      this.setStatus('ok');
      return true;
    } catch (e) {
      this.log(`初始化失败: ${e.message}`);
      this.setStatus('error', e.message);
      throw e;
    }
  }

  // ---------- 同步循环（串行化，双向） ----------
  requestSync(reason) {
    if (!this.enabled || this.status === 'conflict' || this.status === 'init') return;
    this._chain = this._chain.then(() => this._cycle(reason)).catch(() => {});
    return this._chain;
  }

  async _cycle(reason) {
    if (!this.enabled || this.status === 'conflict') return;
    this.setStatus('syncing');
    try {
      // 1. 本地变动 → 提交
      await run(['add', '-A'], this.opts());
      const staged = await run(['diff', '--cached', '--quiet'], this.opts());
      if (staged.code === 1) {
        const msg = `自动同步: ${new Date().toLocaleString('zh-CN')}`;
        await must(['commit', '-m', msg], this.opts(), '提交本地变动');
        this.log(`已提交本地变动（${reason}）`);
      }

      // 2. 拉取远程
      const f = await run(['fetch', 'origin', `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`], this.opts());
      const remoteExists = f.code === 0;

      if (remoteExists) {
        const cnt = await must(['rev-list', '--left-right', '--count', `HEAD...origin/${this.branch}`], this.opts(), '比较进度');
        let [ahead, behind] = cnt.out.split(/\s+/).map(Number);

        // 3. 云端有新提交 → 合并到本地
        if (behind > 0) {
          const m = await run(['merge', `origin/${this.branch}`, '--no-edit'], this.opts());
          if (m.code !== 0) {
            await run(['merge', '--abort'], this.opts());
            this.log('本地与云端修改了同一文件，产生冲突，请在界面上选择保留哪边');
            this.setStatus('conflict', '本地与云端修改冲突');
            return;
          }
          this.log(`已拉取云端 ${behind} 个新提交到本地`);
          const cnt2 = await must(['rev-list', '--left-right', '--count', `HEAD...origin/${this.branch}`], this.opts(), '比较进度');
          [ahead] = cnt2.out.split(/\s+/).map(Number);
        }

        // 4. 本地领先 → 推送
        if (ahead > 0) {
          const p = await run(['push', 'origin', `HEAD:${this.branch}`], this.opts());
          if (p.code !== 0) throw new Error(`推送失败: ${p.err}`);
          this.log(`已推送 ${ahead} 个提交到云端`);
        }
      } else {
        // 远程分支不存在（可能被删）：重新推送创建
        const p = await run(['push', '-u', 'origin', this.branch], this.opts());
        if (p.code !== 0) throw new Error(`推送失败: ${p.err}`);
        this.log('远程分支不存在，已重新创建并推送');
      }

      this.lastSync = new Date().toISOString();
      this.setStatus('ok');
    } catch (e) {
      this.log(`同步出错: ${e.message}`);
      this.setStatus('error', e.message);
    }
  }

  // ---------- 冲突处理 ----------
  async resolveConflict(strategy) {
    // strategy: 'local' 以本地为准 | 'remote' 以云端为准
    this.setStatus('syncing');
    this._chain = this._chain.then(async () => {
      try {
        const x = strategy === 'local' ? 'ours' : 'theirs';
        await must(['merge', `origin/${this.branch}`, '-X', x, '--no-edit'], this.opts(), '合并');
        await must(['push', 'origin', `HEAD:${this.branch}`], this.opts(), '推送');
        this.log(`冲突已解决（以${strategy === 'local' ? '本地' : '云端'}为准）`);
        this.lastSync = new Date().toISOString();
        this.setStatus('ok');
      } catch (e) {
        this.log(`冲突解决失败: ${e.message}`);
        this.setStatus('error', e.message);
      }
    });
    return this._chain;
  }

  // ---------- 监听与定时 ----------
  start() {
    if (!this.enabled) return;
    this.stop();
    this._watcher = chokidar.watch(this.folder, {
      ignored: GIT_DIR_RE,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
    });
    this._watcher.on('all', () => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this.requestSync('本地文件变动'), 2500);
    });
    const interval = Math.max(5, this.ctx.getPollInterval()) * 1000;
    this._timer = setInterval(() => this.requestSync('定时检查云端'), interval);
    this.log('同步已启动（监听本地变动 + 定时检查云端）');
    this.requestSync('启动检查');
  }

  stop() {
    if (this._watcher) { this._watcher.close(); this._watcher = null; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    clearTimeout(this._debounce);
  }
}

class SyncEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.tasks = new Map();
  }

  addTask(data) {
    const task = new SyncTask(data, this.ctx);
    this.tasks.set(data.id, task);
    return task;
  }

  removeTask(id) {
    const t = this.tasks.get(id);
    if (t) { t.stop(); this.tasks.delete(id); }
  }

  get(id) { return this.tasks.get(id); }
  views() { return [...this.tasks.values()].map(t => t.view()); }
  stopAll() { for (const t of this.tasks.values()) t.stop(); }
  restartAll() { for (const t of this.tasks.values()) if (t.enabled) t.start(); }
}

module.exports = { SyncEngine };
