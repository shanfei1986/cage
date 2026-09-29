/**
 * 测试钩子的「关闭态」回归。
 *
 * 由 e2e-smoke.cjs 以子进程方式拉起，**不设** FWJC_TEST_HOOKS，
 * 加载同一份构建产物，检查两件事：
 *   1. 渲染层 window.api.attachment.__testAddByPaths 必须是 undefined
 *      —— 这是生产环境用户真实拿到的界面能力；
 *   2. 主进程也没有注册 attachment:__testAddByPaths 这条通道
 *      —— 少一边就等于把"读任意路径文件"送给页面脚本，所以两边都要守。
 *
 * 结果以单行 `HOOKOFF_JSON {...}` 输出，父进程负责解析与断言。
 */

const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// 独立的临时数据目录：既要隔离数据，也让单实例锁与父进程互不干扰
const dataDir = mkdtempSync(join(tmpdir(), 'fwjc-hookoff-'))
process.env.FWJC_USER_DATA = dataDir
delete process.env.FWJC_TEST_HOOKS

const electronModule = require('electron')

// 先确认自己真的跑在 Electron 里，而不是被 ELECTRON_RUN_AS_NODE 退化成了纯 Node。
// 退化时 require('electron') 只返回一个可执行文件路径字符串，紧接着加载主进程产物会以
// 「找不到模块」之类的形式崩掉，病因极难看出来（这个坑只在 windows-latest 上暴露过）。
// 注意：Windows 上把变量赋成空串**不等于**清掉它，必须整个 delete。
if (typeof electronModule !== 'object' || electronModule === null || !electronModule.app) {
  console.log(
    `HOOKOFF_JSON ${JSON.stringify({
      invalid: true,
      note:
        '子进程退化成了纯 Node 模式（ELECTRON_RUN_AS_NODE 没被清干净），本次回归结论无效。' +
        'Windows 上空串不等于未设置，必须整个删掉这个变量。',
      ELECTRON_RUN_AS_NODE: String(process.env.ELECTRON_RUN_AS_NODE),
      execPath: process.execPath
    })}`
  )
  process.exit(1)
}

const { app, BrowserWindow, ipcMain } = electronModule

// 加载真正的应用主进程（与 e2e-smoke 用的是同一份产物）
require(join(__dirname, '..', 'out', 'main', 'index.js'))

const CHANNEL = 'attachment:__testAddByPaths'
let finished = false

function finish(payload) {
  if (finished) return
  finished = true
  const body = { hasApi: false, hasAdd: false, hasTestHook: true, mainHandlerExists: null, note: '' }
  Object.assign(body, payload)
  console.log(`HOOKOFF_JSON ${JSON.stringify(body)}`)
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* 清理失败无所谓 */
  }
  app.quit()
}

setTimeout(() => finish({ note: '超时，未能完成检查' }), 45000).unref()

function waitForWindow(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) return resolve(wins[0])
      if (Date.now() - started > timeoutMs) return reject(new Error('等待窗口超时'))
      setTimeout(tick, 150)
    }
    tick()
  })
}

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow()
    if (win.webContents.isLoading()) {
      await new Promise((r) => win.webContents.once('did-finish-load', r))
    }

    const seen = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms))
        const t0 = Date.now()
        while (!window.api && Date.now() - t0 < 8000) await sleep(100)
        const a = window.api && window.api.attachment
        return {
          hasApi: !!window.api,
          hasAdd: !!(a && typeof a.add === 'function'),
          hasTestHook: !!(a && typeof a.__testAddByPaths === 'function')
        }
      })()
    `)

    // 私有字段：不同 Electron 版本可能改名，取不到就报 null，由父进程决定跳过断言
    const map = ipcMain._invokeHandlers
    const mainHandlerExists =
      map && typeof map.has === 'function' ? map.has(CHANNEL) : null

    finish({ ...seen, mainHandlerExists })
  } catch (err) {
    finish({ note: `执行异常：${(err && err.message) || String(err)}` })
  }
})
