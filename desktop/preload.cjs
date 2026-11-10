const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('veyraDesktop', {
  openExternal: (url) => ipcRenderer.invoke('veyra:open-external', url),
  getSessionToken: () => ipcRenderer.invoke('veyra:get-session-token'),
  setSessionToken: (token) => ipcRenderer.invoke('veyra:set-session-token', token),
  clearSessionToken: () => ipcRenderer.invoke('veyra:clear-session-token'),
  onPairCallback: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('veyra:pair-callback', listener);
  },
});
