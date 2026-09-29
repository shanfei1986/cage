import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from './db/connection'
import { registerIpc } from './ipc'

/** Win 任务栏 / 通知归属用的应用 ID，与 electron-builder 的 appId 保持一致 */
const APP_ID = 'com.lezu.fwjc'

/**
 * 显式固定数据目录，不依赖 app name 的推断结果 —— 否则开发态和打包态
 * 可能因为 name/productName 不同而把数据存到两个地方，用户会以为"数据丢了"。
 * 开发态加 -dev 后缀，避免调试数据污染真实数据。
 */
function resolveUserDataDir(): void {
  // 测试钩子：指定 FWJC_USER_DATA 时用指定目录，便于自动化测试隔离数据
  const override = process.env['FWJC_USER_DATA']
  if (override) {
    app.setPath('userData', override)
    return
  }
  const dirName = app.isPackaged ? '检测项目管理系统' : '检测项目管理系统-dev'
  app.setPath('userData', join(app.getPath('appData'), dirName))
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: '检测项目管理系统',
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 安全基线：三个开关都不放开
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外链一律用系统浏览器打开，不在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

resolveUserDataDir()
app.setAppUserModelId(APP_ID)

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // node:sqlite 需要 Node >= 22.13（该版本起不再需要实验性开关）。
    // 这里只提醒，不阻断，方便排查环境问题。
    const nodeMajor = Number(process.versions.node.split('.')[0])
    const nodeMinor = Number(process.versions.node.split('.')[1] ?? 0)
    if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
      console.warn(`[warn] 当前 Node 版本 ${process.versions.node} 偏低，node:sqlite 可能不可用`)
    }

    try {
      const result = initDatabase(join(app.getPath('userData'), 'data'))
      console.log(
        `[db] 数据库就绪：${result.file}（schema v${result.migration.from} → v${result.migration.to}）`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox('数据库初始化失败', `软件无法启动。\n\n原因：${msg}`)
      app.quit()
      return
    }

    registerIpc()
    createWindow()
  })

  // 桌面工具：关掉窗口就退出（与 Windows 上的使用习惯一致）
  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    closeDatabase()
  })
}
