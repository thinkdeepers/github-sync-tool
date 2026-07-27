// 本地模拟 GitHub API，用于端到端测试（配合环境变量 GITHUB_API_BASE 使用）
// 用法: node test/mock-github.js [端口] [裸仓库路径]
const http = require('http');
const { execSync } = require('child_process');

const PORT = Number(process.argv[2]) || 3999;
const BARE = process.argv[3] || '/tmp/fake-remote.git';

function branches() {
  try {
    const out = execSync(`git --git-dir="${BARE}" for-each-ref --format="%(refname:short)" refs/heads`, { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return ['main'];
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Content-Type', 'application/json');
  const page = new URLSearchParams(req.url.split('?')[1] || '').get('page') || '1';

  if (url === '/user') {
    res.end(JSON.stringify({ login: 'testuser', name: '测试用户', email: null }));
  } else if (url === '/user/repos') {
    res.end(JSON.stringify(page === '1' ? [{
      full_name: 'testuser/AI-pet-demo',
      clone_url: `file://${BARE}`,
      default_branch: 'main',
      private: true,
      description: '端到端测试仓库（本地模拟）',
    }] : []));
  } else if (url === '/repos/testuser/AI-pet-demo/branches') {
    res.end(JSON.stringify(page === '1' ? branches().map(name => ({ name })) : []));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Not Found' }));
  }
});

server.listen(PORT, () => console.log(`mock GitHub API on :${PORT}, bare repo: ${BARE}`));
