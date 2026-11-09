const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('practice', Object.freeze({
  startupReady: () => ipcRenderer.send('practice:ready'),
  startupFailed: message => ipcRenderer.send('practice:startup-failed', String(message).slice(0, 500)),
  call: async (method, payload = {}) => {
    const result = await ipcRenderer.invoke('practice:api', method, payload);
    if (!result.ok) { const error = new Error(result.error.message); error.code = result.error.code; error.details = result.error.details; throw error; }
    return result.value;
  }
}));
