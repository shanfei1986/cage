/**
 * 端到端冒烟测试。
 *
 * 直接加载构建产物 out/main/index.js（也就是真正的应用主进程），
 * 把数据目录指到临时目录，等窗口加载完成后从渲染进程里通过
 * window.api 真正走一遍「新建项目 → 查询列表 → 读时间轴」，
 * 同时检查界面是否真的渲染出来了（菜单、表格等 AntD 元素）。
 *
 * 用法：npm run e2e
 *       （脚本已带上 --no-sandbox --disable-gpu，在受限环境/无显示环境里也能跑）
 *
 * 这一步验证的是 Electron 运行时装配（窗口 + IPC + preload + 数据库 + 界面渲染）
 * 是否真的通了 —— 单靠类型检查和业务自检覆盖不到这一层。
 */

const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const dataDir = mkdtempSync(join(tmpdir(), 'fwjc-e2e-'))
process.env.FWJC_USER_DATA = dataDir

const { app, BrowserWindow } = require('electron')

// 加载真正的应用主进程（它会自己建窗口、注册 IPC、初始化数据库）
require(join(__dirname, '..', 'out', 'main', 'index.js'))

const problems = []
let finished = false

function finish(code) {
  if (finished) return
  finished = true
  if (problems.length > 0) {
    console.log('\n── 失败项 ──')
    for (const p of problems) console.log(`  ✗ ${p}`)
  }
  try {
    if (code === 0) rmSync(dataDir, { recursive: true, force: true })
    else console.log(`\nE2E 临时数据保留在：${dataDir}`)
  } catch {
    /* 清理失败无所谓 */
  }
  console.log(code === 0 ? '\nE2E_结果 全部通过' : `\nE2E_结果 存在 ${problems.length} 项问题`)
  process.exitCode = code
  app.quit()
}

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

setTimeout(() => {
  problems.push('整体超时（60 秒内没跑完）')
  finish(1)
}, 60000).unref()

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow()
    console.log('E2E 窗口已创建')

    // 把渲染进程的报错抓出来（否则只能看到一个白屏）
    win.webContents.on('console-message', (...args) => {
      const d = args[1]
      const level = typeof d === 'object' && d ? d.level : args[1]
      const message = typeof d === 'object' && d ? d.message : args[2]
      if (String(level) === 'error' || String(level) === '3') {
        problems.push(`渲染进程报错：${message}`)
      }
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      problems.push(`渲染进程异常退出：${JSON.stringify(details)}`)
    })
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      problems.push(`页面加载失败：${code} ${desc}`)
    })

    if (win.webContents.isLoading()) {
      await new Promise((r) => win.webContents.once('did-finish-load', r))
    }
    console.log('E2E 页面加载完成')

    // 等 React 挂载 + AntD 渲染完成
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms))
        const waitFor = async (sel, ms) => {
          const t0 = Date.now()
          while (Date.now() - t0 < (ms || 8000)) {
            if (document.querySelector(sel)) return true
            await sleep(100)
          }
          return false
        }

        const dom = {
          root: !!document.querySelector('#root'),
          layout: await waitFor('.ant-layout', 10000),
          menuItems: document.querySelectorAll('.ant-menu-item').length,
          hasApi: typeof window.api === 'object' && window.api !== null,
          hasIpcRendererLeak: typeof window.require === 'function' || typeof window.ipcRenderer !== 'undefined'
        }

        const info = await window.api.app.info()
        const created = await window.api.project.create({
          task_no: 'lz-90001',
          name: 'E2E 冒烟测试项目',
          client_name: 'E2E 测试委托方',
          project_type: 'security'
        })
        const dup = await window.api.project.create({
          task_no: 'lz-90001',
          name: '重复的',
          client_name: 'X'
        })
        const badFormat = await window.api.project.create({
          task_no: 'zzz-1',
          name: '格式错',
          client_name: 'Y'
        })
        const list = await window.api.project.list({ page: 1, pageSize: 20 })
        const id = created.data && created.data.id
        const advanced = await window.api.project.changeStatus(id, 'contacted', { contact_note: 'E2E 联系记录' })
        const illegal = await window.api.project.changeStatus(id, 'closed', {})
        const logs = await window.api.project.logs(id)
        const counts = await window.api.project.countByStatus()

        // ── 导航到项目列表，验证数据真的渲染到界面上了（顺带验证 HashRouter 通） ──
        location.hash = '#/projects'
        const tableRendered = await waitFor('.ant-table', 8000)
        const rowCount = document.querySelectorAll('.ant-table-row').length
        const bodyText = document.body.innerText || ''
        const ui = {
          tableRendered,
          rowCount,
          showsTaskNo: bodyText.indexOf('lz-90001') >= 0,
          showsStatus: bodyText.indexOf('已联系委托方') >= 0
        }

        return {
          dom,
          ui,
          info,
          created: { ok: created.ok, taskNo: created.data && created.data.task_no },
          dup: { ok: dup.ok, msg: dup.message },
          badFormat: { ok: badFormat.ok, msg: badFormat.message },
          list: { total: list.total, firstTaskNo: list.rows[0] && list.rows[0].task_no },
          advanced: { ok: advanced.ok, status: advanced.data && advanced.data.status },
          illegal: { ok: illegal.ok, msg: illegal.message },
          logCount: logs.length,
          logContents: logs.map(l => l.content),
          counts
        }
      })()
    `)

    // ── 断言 ──
    const eq = (name, actual, expected) => {
      if (actual === expected) console.log(`  ✓ ${name}`)
      else problems.push(`${name}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
    }

    console.log('\n── 界面渲染 ──')
    eq('React 挂载点存在', result.dom.root, true)
    eq('AntD 布局渲染成功', result.dom.layout, true)
    eq('侧边菜单渲染成功（4 项）', result.dom.menuItems, 4)
    eq('路由跳转到项目列表成功', result.ui.tableRendered, true)
    eq('列表里渲染出了项目行', result.ui.rowCount >= 1, true)
    eq('界面上显示了刚建的任务单号', result.ui.showsTaskNo, true)
    eq('界面上显示了当前阶段', result.ui.showsStatus, true)

    console.log('\n── 安全基线 ──')
    eq('contextBridge 暴露了 api', result.dom.hasApi, true)
    eq('未向渲染进程泄漏 ipcRenderer / require', result.dom.hasIpcRendererLeak, false)

    console.log('\n── 数据库与 IPC ──')
    eq('node:sqlite 在当前 Electron 中可用', result.info.sqliteAvailable, true)
    eq('内置 Node 版本 ≥ 22.13', Number(result.info.node.split('.')[0]) >= 22, true)
    eq('数据文件落在指定目录', result.info.dbPath.startsWith(dataDir), true)

    console.log('\n── 业务链路 ──')
    eq('新建项目成功且任务单号已规范化', result.created.ok === true && result.created.taskNo === 'lz-90001', true)
    eq('重复任务单号被拦截', result.dup.ok, false)
    eq('格式非法的任务单号被拦截', result.badFormat.ok, false)
    eq('列表能查到刚建的项目', result.list.total >= 1 && result.list.firstTaskNo === 'lz-90001', true)
    eq('状态推进成功', result.advanced.ok === true && result.advanced.status === 'contacted', true)
    eq('非法状态跳转被拒绝', result.illegal.ok, false)
    eq('操作日志已写入（新建 + 联系）', result.logCount >= 2, true)
    eq('日志内容可读', (result.logContents || []).some((c) => (c || '').includes('E2E 联系记录')), true)
    eq('状态统计可用', (result.counts.contacted || 0) >= 1, true)

    console.log('\n── 运行时信息 ──')
    console.log(`  Electron ${result.info.electron} / Node ${result.info.node} / Chrome ${result.info.chrome}`)
    console.log(`  数据文件：${result.info.dbPath}`)

    finish(problems.length === 0 ? 0 : 1)
  } catch (err) {
    problems.push(`执行异常：${(err && err.message) || String(err)}`)
    finish(1)
  }
})
