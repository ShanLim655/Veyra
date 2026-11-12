const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('veyraUpdate', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('veyra:update-state', listener);
    return () => ipcRenderer.removeListener('veyra:update-state', listener);
  },
  choose: (action) => ipcRenderer.send('veyra:update-action', action),
});
