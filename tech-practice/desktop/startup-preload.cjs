const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('startup', Object.freeze({
  snapshot: () => ipcRenderer.invoke('startup:snapshot'),
  subscribe: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('startup:progress', handler);
    return () => ipcRenderer.removeListener('startup:progress', handler);
  },
  exit: () => ipcRenderer.send('startup:exit'),
  retry: () => ipcRenderer.send('startup:retry')
}));
