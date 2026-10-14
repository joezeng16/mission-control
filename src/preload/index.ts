import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Bounds, McApi, ScanProgress, TvInterval, TvState } from '../shared/types'

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** The only bridge from the page to the main process (contextIsolation on, sandboxed page, no Node in the renderer). */
const mc: McApi = {
  scanner: {
    latest: () => ipcRenderer.invoke('scanner:latest'),
    run: () => ipcRenderer.invoke('scanner:run'),
    cancel: () => ipcRenderer.invoke('scanner:cancel'),
    onProgress: (cb: (p: ScanProgress) => void) => listen('scanner:progress', cb)
  },
  market: {
    quote: (t: string) => ipcRenderer.invoke('market:quote', t),
    expirations: (t: string) => ipcRenderer.invoke('market:expirations', t),
    chain: (t: string, e: string) => ipcRenderer.invoke('market:chain', t, e)
  },
  tv: {
    setBounds: (b: Bounds | null) => ipcRenderer.send('tv:bounds', b),
    show: (ticker: string, interval: TvInterval) => ipcRenderer.send('tv:show', ticker, interval),
    back: () => ipcRenderer.send('tv:back'),
    reload: () => ipcRenderer.send('tv:reload'),
    openExternal: () => ipcRenderer.send('tv:external'),
    signIn: () => ipcRenderer.send('tv:signin'),
    onState: (cb: (s: TvState) => void) => listen('tv:state', cb)
  }
}

contextBridge.exposeInMainWorld('mc', mc)
