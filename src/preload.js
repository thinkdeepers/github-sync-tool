const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  login: (token) => ipcRenderer.invoke('login', token),
  logout: () => ipcRenderer.invoke('logout'),
  listRepos: () => ipcRenderer.invoke('list-repos'),
  listBranches: (fullName) => ipcRenderer.invoke('list-branches', fullName),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  addMapping: (payload) => ipcRenderer.invoke('add-mapping', payload),
  removeMapping: (id) => ipcRenderer.invoke('remove-mapping', id),
  toggleMapping: (id, enabled) => ipcRenderer.invoke('toggle-mapping', id, enabled),
  syncNow: (id) => ipcRenderer.invoke('sync-now', id),
  resolveConflict: (id, strategy) => ipcRenderer.invoke('resolve-conflict', id, strategy),
  openFolder: (id) => ipcRenderer.invoke('open-folder', id),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  openTokenPage: () => ipcRenderer.invoke('open-token-page'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
});
