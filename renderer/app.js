const $ = (id) => document.getElementById(id);

let state = { user: null, mappings: [], logs: [], settings: {} };
let repos = [];
let wizard = { repo: null, branch: null, createBranch: false, folder: null };

// ---------------- 渲染 ----------------
const STATUS_TEXT = {
  ok: '✓ 已同步', syncing: '同步中...', init: '初始化中...',
  idle: '等待中', paused: '已暂停', error: '出错', conflict: '⚠ 冲突待处理',
};

function render() {
  const loggedIn = !!state.user;
  $('view-login').classList.toggle('hidden', loggedIn);
  $('view-main').classList.toggle('hidden', !loggedIn);
  if (!loggedIn) return;

  $('user-label').textContent = state.user.name || state.user.login;
  $('poll-label').textContent = `云端检查间隔 ${state.settings.pollIntervalSec || 30}s`;

  const list = $('task-list');
  list.innerHTML = '';
  $('empty-hint').classList.toggle('hidden', state.mappings.length > 0);

  for (const m of state.mappings) {
    const el = document.createElement('div');
    el.className = 'task';
    const last = m.lastSync ? `上次同步 ${new Date(m.lastSync).toLocaleString('zh-CN')}` : '尚未同步';
    el.innerHTML = `
      <div class="info">
        <div class="title">${esc(m.repoFullName)}<span class="branch-tag">⎇ ${esc(m.branch)}</span></div>
        <div class="path">📁 ${esc(m.folder)}</div>
        <div class="last">${last}${m.error ? ' · ' + esc(m.error) : ''}</div>
        ${m.status === 'conflict' ? `
        <div class="conflict-bar">
          <span>本地与云端修改了同一文件，保留哪边的版本？</span>
          <button class="ghost small" data-act="res-local" data-id="${m.id}">以本地为准</button>
          <button class="ghost small" data-act="res-remote" data-id="${m.id}">以云端为准</button>
        </div>` : ''}
      </div>
      <span class="badge ${m.status}">${STATUS_TEXT[m.status] || m.status}</span>
      <div class="ops">
        <button class="ghost small" data-act="sync" data-id="${m.id}">立即同步</button>
        <button class="ghost small" data-act="open" data-id="${m.id}">打开文件夹</button>
        <button class="ghost small" data-act="toggle" data-id="${m.id}">${m.enabled ? '暂停' : '启用'}</button>
        <button class="ghost small" data-act="del" data-id="${m.id}">删除</button>
      </div>`;
    list.appendChild(el);
  }

  const logBox = $('log-box');
  logBox.innerHTML = state.logs.map(l => `<div>${esc(l)}</div>`).join('');
  logBox.scrollTop = logBox.scrollHeight;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- 登录 ----------------
$('btn-login').onclick = async () => {
  $('login-err').textContent = '';
  $('btn-login').disabled = true;
  try {
    await window.api.login($('token-input').value);
    $('token-input').value = '';
  } catch (e) {
    $('login-err').textContent = /401/.test(e.message) ? 'Token 无效，请检查后重试' : '登录失败: ' + e.message;
  } finally {
    $('btn-login').disabled = false;
  }
};
$('token-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-login').click(); });
$('btn-token-help').onclick = () => window.api.openTokenPage();
$('btn-logout').onclick = () => window.api.logout();

// ---------------- 任务操作 ----------------
$('task-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'sync') window.api.syncNow(id);
  if (act === 'open') window.api.openFolder(id);
  if (act === 'toggle') {
    const m = state.mappings.find(x => x.id === id);
    window.api.toggleMapping(id, !m.enabled);
  }
  if (act === 'del' && confirm('删除该同步任务？（本地文件不会被删除）')) window.api.removeMapping(id);
  if (act === 'res-local') window.api.resolveConflict(id, 'local');
  if (act === 'res-remote') window.api.resolveConflict(id, 'remote');
});

// ---------------- 新建向导 ----------------
function showStep(n) {
  $('wz-step1').classList.toggle('hidden', n !== 1);
  $('wz-step2').classList.toggle('hidden', n !== 2);
  $('wz-step3').classList.toggle('hidden', n !== 3);
  $('wizard-title').textContent =
    n === 1 ? '新建同步 · 第 1 步：选择仓库' :
    n === 2 ? '新建同步 · 第 2 步：选择分支' :
              '新建同步 · 第 3 步：选择本地文件夹';
}

$('btn-add').onclick = async () => {
  wizard = { repo: null, branch: null, createBranch: false, folder: null };
  $('wizard').classList.remove('hidden');
  $('wizard-err').textContent = '';
  $('folder-display').value = '';
  $('repo-filter').value = '';
  showStep(1);
  $('repo-list').innerHTML = '<div class="muted pad">加载中...</div>';
  try {
    repos = await window.api.listRepos();
    renderRepoList('');
  } catch (e) {
    $('repo-list').innerHTML = `<div class="err pad">加载仓库失败: ${esc(e.message)}</div>`;
  }
};
$('wizard-close').onclick = () => $('wizard').classList.add('hidden');

function renderRepoList(filter) {
  const box = $('repo-list');
  const items = repos.filter(r => r.fullName.toLowerCase().includes(filter.toLowerCase()));
  box.innerHTML = items.length ? '' : '<div class="muted pad">没有匹配的仓库</div>';
  for (const r of items) {
    const div = document.createElement('div');
    div.className = 'pick-item';
    div.innerHTML = `<div class="name">${esc(r.fullName)} ${r.private ? '🔒' : ''}</div>
                     <div class="desc">${esc(r.description || '无描述')}</div>`;
    div.onclick = () => pickRepo(r);
    box.appendChild(div);
  }
}
$('repo-filter').addEventListener('input', e => renderRepoList(e.target.value));

async function pickRepo(repo) {
  wizard.repo = repo;
  showStep(2);
  $('chosen-repo').textContent = `已选仓库：${repo.fullName}（默认分支 ${repo.defaultBranch}）`;
  $('new-branch-name').value = '';
  $('branch-list').innerHTML = '<div class="muted pad">加载中...</div>';
  try {
    const branches = await window.api.listBranches(repo.fullName);
    const box = $('branch-list');
    box.innerHTML = '';
    for (const b of branches) {
      const div = document.createElement('div');
      div.className = 'pick-item';
      div.innerHTML = `<div class="name">⎇ ${esc(b)}</div>`;
      div.onclick = () => pickBranch(b, false);
      box.appendChild(div);
    }
  } catch (e) {
    $('branch-list').innerHTML = `<div class="err pad">加载分支失败: ${esc(e.message)}</div>`;
  }
}

$('btn-new-branch').onclick = () => {
  const name = $('new-branch-name').value.trim();
  if (!name) return;
  pickBranch(name, true);
};

function pickBranch(branch, isNew) {
  wizard.branch = branch;
  wizard.createBranch = isNew;
  showStep(3);
  $('chosen-summary').textContent =
    `${wizard.repo.fullName} 的分支「${branch}」${isNew ? '（新建）' : ''} ⇄ 本地文件夹`;
}

$('btn-pick-folder').onclick = async () => {
  const folder = await window.api.pickFolder();
  if (folder) { wizard.folder = folder; $('folder-display').value = folder; }
};

$('btn-create').onclick = async () => {
  $('wizard-err').textContent = '';
  if (!wizard.folder) { $('wizard-err').textContent = '请先选择本地文件夹'; return; }
  $('btn-create').disabled = true;
  $('btn-create').textContent = '初始化中，请稍候...';
  try {
    await window.api.addMapping({
      repoFullName: wizard.repo.fullName,
      cloneUrl: wizard.repo.cloneUrl,
      branch: wizard.branch,
      folder: wizard.folder,
      createBranch: wizard.createBranch,
      baseBranch: wizard.repo.defaultBranch,
    });
    $('wizard').classList.add('hidden');
  } catch (e) {
    $('wizard-err').textContent = e.message.replace(/^Error invoking remote method '.*?': (Error: )?/, '');
  } finally {
    $('btn-create').disabled = false;
    $('btn-create').textContent = '开始同步';
  }
};

// ---------------- 启动 ----------------
window.api.onState(s => { state = s; render(); });
window.api.getState().then(s => { state = s; render(); });
