// 配置持久化：token(加密) + 同步任务列表 + 设置
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'config.json');

const defaults = {
  tokenEnc: null,      // base64(加密后token)
  tokenPlain: null,    // 系统不支持加密时的降级存储
  mappings: [],        // {id, repoFullName, cloneUrl, branch, folder, enabled}
  settings: { pollIntervalSec: 30 },
};

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return { ...defaults, ...data, settings: { ...defaults.settings, ...(data.settings || {}) } };
  } catch {
    return { ...defaults };
  }
}

function save(cfg) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cfg, null, 2), 'utf8');
}

function setToken(cfg, token) {
  if (token == null) {
    cfg.tokenEnc = null;
    cfg.tokenPlain = null;
  } else if (safeStorage.isEncryptionAvailable()) {
    cfg.tokenEnc = safeStorage.encryptString(token).toString('base64');
    cfg.tokenPlain = null;
  } else {
    cfg.tokenEnc = null;
    cfg.tokenPlain = token;
  }
  save(cfg);
}

function getToken(cfg) {
  try {
    if (cfg.tokenEnc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(cfg.tokenEnc, 'base64'));
    }
  } catch { /* 解密失败按未登录处理 */ }
  return cfg.tokenPlain || null;
}

module.exports = { load, save, setToken, getToken };
