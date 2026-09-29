import { ipcMain } from 'electron'
import { getAllSettings, setSetting } from '../db/repositories/setting.repo'
import { getDictBundle, listDict } from '../db/repositories/dict.repo'

export function registerSettingIpc(): void {
  ipcMain.handle('setting:getAll', () => getAllSettings())
  ipcMain.handle('setting:set', (_e, key: string, value: string) => {
    setSetting(key, value)
    return true
  })
}

export function registerDictIpc(): void {
  ipcMain.handle('dict:bundle', (_e, types: string[]) => getDictBundle(types ?? []))
  ipcMain.handle('dict:list', (_e, type: string, onlyEnabled?: boolean) =>
    listDict(type, onlyEnabled !== false)
  )
}
