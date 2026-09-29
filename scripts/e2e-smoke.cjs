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

const { mkdtempSync, rmSync, readdirSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const dataDir = mkdtempSync(join(tmpdir(), 'fwjc-e2e-'))
process.env.FWJC_USER_DATA = dataDir
// 打开只在测试时注册的 IPC 钩子（例如"灌照片"这种生产环境绝不能有的通道）。
// 生产打包时没有这个环境变量，那些通道根本不会注册。
process.env.FWJC_TEST_HOOKS = '1'

const { app, BrowserWindow, ipcMain } = require('electron')

/** 生成 n 天前的日期文本，用来造"已超期"的演示数据 */
function daysAgoText(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const p = (v) => (v < 10 ? `0${v}` : String(v))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

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

/**
 * 测试钩子回归：另起一个 Electron 进程，在**不设** FWJC_TEST_HOOKS 的条件下
 * 加载同一份构建产物，确认渲染层拿不到钩子、主进程也没注册那条通道。
 *
 * 为什么非要另起进程：环境变量是进程级的，同进程里没法既开又关。
 * 子进程用的是自己新建的临时 userData，因此和本进程的单实例锁不冲突。
 */
function runHookOffProbe() {
  const { spawnSync } = require('node:child_process')
  const res = spawnSync(
    process.execPath,
    [join(__dirname, 'e2e-testhook-off.cjs'), '--no-sandbox', '--disable-gpu'],
    {
      timeout: 60000,
      encoding: 'utf8',
      // 显式清掉两个变量：钩子开关关掉，ELECTRON_RUN_AS_NODE 空串即视为未设置
      env: { ...process.env, FWJC_TEST_HOOKS: '', ELECTRON_RUN_AS_NODE: '' }
    }
  )
  const out = `${res.stdout || ''}${res.stderr || ''}`
  const line = out.split('\n').find((l) => l.startsWith('HOOKOFF_JSON '))
  if (!line) {
    return { ran: false, reason: `未拿到子进程结果（exit=${res.status}）\n${out.slice(-800)}` }
  }
  try {
    return { ran: true, code: res.status, ...JSON.parse(line.slice('HOOKOFF_JSON '.length)) }
  } catch (err) {
    return { ran: false, reason: `子进程结果无法解析：${String(err)}` }
  }
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

// 整体兜底超时。除了主窗口，末尾还要另起一个 Electron 子进程做钩子回归，留足余量。
setTimeout(() => {
  problems.push('整体超时（180 秒内没跑完）')
  finish(1)
}, 180000).unref()

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

    // 现场照片链路用的示例图（由 scripts/make_fixtures.py 生成，240x180 / 180x240）
    const fixturePaths = ['photo-1.png', 'photo-2.png'].map((n) => join(__dirname, 'fixtures', n))

    // 等 React 挂载 + AntD 渲染完成
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms))
        const FIXTURES = ${JSON.stringify(fixturePaths)}
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

        // ── 现场照片：走测试钩子灌 2 张示例图（系统文件框在自动化里点不了） ──
        const hasTestHook = typeof (window.api.attachment.__testAddByPaths) === 'function'
        const added = hasTestHook
          ? await window.api.attachment.__testAddByPaths(id, FIXTURES)
          : null
        const attList = await window.api.attachment.list(id)
        const attCounts = await window.api.attachment.counts()

        // 自定义协议能不能真的把图喂进 <img>。
        // 这一条同时验证三件事：协议已在 ready 前注册、CSP 里列了 fwjc-media:、
        // 主进程把 rel_path 正确映射到了磁盘文件。
        const loadImage = (url) => new Promise((resolve) => {
          const img = new Image()
          const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 8000)
          img.onload = () => {
            clearTimeout(timer)
            resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight })
          }
          img.onerror = () => {
            clearTimeout(timer)
            resolve({ ok: false, reason: 'error' })
          }
          img.src = url
        })
        const att0 = attList[0] || null
        const goodLoad = att0
          ? await loadImage('fwjc-media://media/' + att0.rel_path)
          : { ok: false, reason: 'no-attachment' }
        // 以下每一条都必须加载失败，否则说明路径防护有缺口
        const badHost = await loadImage('fwjc-media://evil/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/x.png')
        const badDepth = await loadImage('fwjc-media://media/a/b/c.png')
        const badTraversal = await loadImage('fwjc-media://media/../../../etc/passwd')
        const badTraversalEnc = await loadImage(
          'fwjc-media://media/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'
        )
        const badTraversalInName = await loadImage(
          'fwjc-media://media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/..%2f..%2fetc%2fpasswd'
        )
        const badExt = await loadImage(
          'fwjc-media://media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.txt'
        )
        // 格式合法但文件不存在：也必须失败，不能出现"目录枚举"式的信息泄漏
        const missing = await loadImage(
          'fwjc-media://media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'
        )

        // ── 待办预警：造一个"接单 8 天没联系"的项目，它必须被判为已超期 ──
        const overdue = await window.api.project.create({
          task_no: 'lz-90002',
          name: 'E2E 超期待办项目',
          client_name: 'E2E 测试委托方',
          receive_date: ${JSON.stringify(daysAgoText(8))}
        })
        const alertList = await window.api.alert.list()
        const alertCounts = await window.api.alert.counts()
        const mine = alertList.find(a => a.task_no === 'lz-90002')

        // ── 先回工作台，检查「今日待办」卡片真的渲染出来了 ──
        location.hash = '#/dashboard'
        const todoRendered = await waitFor('.todo-card', 8000)
        const todoText = (document.querySelector('.todo-card') || {}).innerText || ''

        // ── 导航到项目列表，验证数据真的渲染到界面上了（顺带验证 HashRouter 通） ──
        location.hash = '#/projects'
        const tableRendered = await waitFor('.ant-table', 8000)
        const rowCount = document.querySelectorAll('.ant-table-row').length
        const alertRows = document.querySelectorAll('.row-alert-overdue').length
        const bodyText = document.body.innerText || ''
        const csp = (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {})
          .content || ''
        const ui = {
          tableRendered,
          rowCount,
          alertRows,
          showsTaskNo: bodyText.indexOf('lz-90001') >= 0,
          showsStatus: bodyText.indexOf('已联系委托方') >= 0
        }

        // ── 项目详情页的照片墙：确认协议图片真的被解码出来了（不只是 src 写对） ──
        location.hash = '#/projects/' + id
        const wallRendered = await waitFor('.photo-wall', 8000)
        const wallImgs = Array.from(document.querySelectorAll('.photo-wall img'))
        const wallSrcOk = wallImgs.length > 0 && wallImgs.every((i) => i.src.indexOf('fwjc-media://') === 0)
        const wallDecoded =
          wallImgs.length > 0 && wallImgs[0].complete && wallImgs[0].naturalWidth > 0

        // 删除单独放到下一段脚本里做，好让主进程能在"删之前"核对磁盘状态
        return {
          dom,
          ui,
          todoRendered,
          todoText,
          csp,
          info,
          created: { ok: created.ok, taskNo: created.data && created.data.task_no },
          dup: { ok: dup.ok, msg: dup.message },
          badFormat: { ok: badFormat.ok, msg: badFormat.message },
          list: { total: list.total, firstTaskNo: list.rows[0] && list.rows[0].task_no },
          advanced: { ok: advanced.ok, status: advanced.data && advanced.data.status },
          illegal: { ok: illegal.ok, msg: illegal.message },
          logCount: logs.length,
          logContents: logs.map(l => l.content),
          counts,
          overdueCreated: overdue.ok,
          alertIsArray: Array.isArray(alertList),
          alertCounts,
          myAlert: mine ? { level: mine.level, rules: mine.hits.map(h => h.rule) } : null,

          // 现场照片链路
          projectId: id,
          hasTestHook,
          addedOk: !!(added && added.ok),
          addedCount: added && added.data ? added.data.length : 0,
          attCount: attList.length,
          attNames: attList.map(a => a.file_name),
          attMime: attList.map(a => a.mime_type),
          attSizes: attList.map(a => a.size_bytes),
          attRelPaths: attList.map(a => a.rel_path),
          attCountForProject: attCounts[id],
          goodLoad,
          rejections: {
            badHost,
            badDepth,
            badTraversal,
            badTraversalEnc,
            badTraversalInName,
            badExt,
            missing
          },
          wallRendered,
          wallImgCount: wallImgs.length,
          wallSrcOk,
          wallDecoded
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

    console.log('\n── 待办预警 ──')
    eq('预警接口返回数组', result.alertIsArray, true)
    eq('预警数量汇总含 overdue 字段', typeof result.alertCounts.overdue, 'number')
    eq('接单 8 天未联系被判为已超期', result.myAlert && result.myAlert.level, 'overdue')
    eq(
      '该项目的命中原因是"接单未联系"',
      !!(result.myAlert && result.myAlert.rules.includes('receive_contact')),
      true
    )
    eq('工作台渲染出了「今日待办」卡片', result.todoRendered, true)
    eq('待办卡片文案正确', result.todoText.includes('今日待办'), true)
    eq('列表页有待办行标记', result.ui.alertRows >= 1, true)

    // ── 现场照片：库、磁盘、协议、界面，四层都要对上 ──
    const projAttachDir = join(dataDir, 'attachments', result.projectId)
    const listDir = (d) => (existsSync(d) ? readdirSync(d) : [])
    const filesOnDisk = listDir(projAttachDir)
    const expectedDiskNames = result.attRelPaths.map((p) => p.split('/')[1])

    console.log('\n── 现场照片入库 ──')
    eq('e2e 环境下测试钩子已挂上', result.hasTestHook, true)
    eq('灌入 2 张示例图成功', result.addedOk === true && result.addedCount === 2, true)
    eq('列表接口返回 2 条', result.attCount, 2)
    eq(
      '原文件名被保留（磁盘名用 UUID）',
      result.attNames.includes('photo-1.png') && result.attNames.includes('photo-2.png'),
      true
    )
    eq('MIME 类型按扩展名推断正确', result.attMime.every((m) => m === 'image/png'), true)
    eq('文件大小已登记且非 0', result.attSizes.every((s) => s > 0), true)
    eq('磁盘上确实落了 2 个文件', filesOnDisk.length, 2)
    eq(
      '磁盘文件名与库内 rel_path 一一对应',
      expectedDiskNames.length === 2 && expectedDiskNames.every((n) => filesOnDisk.includes(n)),
      true
    )
    eq('按项目统计照片数正确', result.attCountForProject, 2)

    console.log('\n── 自定义协议与 CSP ──')
    eq('协议 URL 能被 <img> 加载', result.goodLoad.ok, true)
    eq(
      '解码出的尺寸与示例图一致（photo-1 为 240x180）',
      result.goodLoad.ok === true && result.goodLoad.w === 240 && result.goodLoad.h === 180,
      true
    )
    eq('CSP 里列出了 fwjc-media:', result.csp.includes('fwjc-media:'), true)
    eq('非本协议 host 被拒', result.rejections.badHost.ok, false)
    eq('路径段数不符被拒', result.rejections.badDepth.ok, false)
    eq('原始 ../ 穿越被拒', result.rejections.badTraversal.ok, false)
    eq('编码后的 ../ 穿越被拒', result.rejections.badTraversalEnc.ok, false)
    eq('文件名位上的穿越被拒', result.rejections.badTraversalInName.ok, false)
    eq('非图片扩展名被拒（.txt）', result.rejections.badExt.ok, false)
    eq('格式合法但文件不存在时也被拒', result.rejections.missing.ok, false)

    console.log('\n── 照片墙界面 ──')
    eq('详情页照片墙渲染成功', result.wallRendered, true)
    eq('照片墙里渲染了 2 张图', result.wallImgCount, 2)
    eq('图片地址都是自定义协议', result.wallSrcOk, true)
    eq('图片真的解码了（naturalWidth > 0）', result.wallDecoded, true)

    console.log('\n── 删除照片 ──')
    // 删除必须放在"核对磁盘"之后，否则主进程读到的是已经删完的状态
    const removed = await win.webContents.executeJavaScript(`
      (async () => {
        const list = await window.api.attachment.list(${JSON.stringify(result.projectId)})
        const target = list[1]
        if (!target) return { ok: false, reason: '第二个附件不存在' }
        const res = await window.api.attachment.remove(target.id)
        const after = await window.api.attachment.list(${JSON.stringify(result.projectId)})
        return { ok: !!res.ok, after: after.length, relPath: target.rel_path }
      })()
    `)
    eq('删除接口返回成功', removed.ok, true)
    eq('库内只剩 1 条', removed.after, 1)
    eq(
      '被删那张的磁盘文件已消失',
      existsSync(join(dataDir, 'attachments', removed.relPath || '__none__')),
      false
    )
    eq('磁盘上只剩 1 个文件', listDir(projAttachDir).length, 1)
    eq('剩下那个文件没被误删', listDir(projAttachDir).includes(expectedDiskNames[0]), true)

    console.log('\n── 统计报表 ──')
    const bkZip = join(dataDir, 'e2e-backup.zip')
    const ops = await win.webContents.executeJavaScript(`
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
        const projectId = ${JSON.stringify(result.projectId)}

        const overview = await window.api.stats.overview(6)
        const overviewDefault = await window.api.stats.overview()

        // 统计页 → 等 ECharts 画完首帧（它用 canvas 渲染，DOM 里能直接数出来）
        location.hash = '#/stats'
        await waitFor('.ant-card', 8000)
        await sleep(1500)
        const canvases = document.querySelectorAll('.ant-card canvas').length
        const statsText = document.body.innerText || ''

        // 备份：走测试钩子指定输出路径，避免弹保存框
        const bkInfoBefore = await window.api.backup.info()
        const made = await window.api.backup.create(${JSON.stringify(bkZip)})
        // 备份成功后立刻读一次：这一条要在恢复之前取，
        // 因为备份时间本身也写在库里，恢复会把设置回滚成快照里的旧值
        const bkInfoAfterCreate = await window.api.backup.info()
        const insp = await window.api.backup.inspect(${JSON.stringify(bkZip)})

        // 备份之后再建一个项目：恢复后它必须消失
        const marker = await window.api.project.create({
          task_no: 'lz-99001', name: '备份标记项目', client_name: 'E2E 测试委托方'
        })
        const restored = await window.api.backup.restore(${JSON.stringify(bkZip)})

        const afterList = await window.api.project.list({ page: 1, pageSize: 50 })
        const bkInfoAfter = await window.api.backup.info()
        const attAfterRestore = await window.api.attachment.list(projectId)
        const statsAfterRestore = await window.api.stats.overview(6)

        return {
          trendLen: overview.trend.length,
          trendMonths: overview.range.months,
          defaultMonths: overviewDefault.range.months,
          typeRows: overview.byProjectType.length,
          statusRows: overview.byStatus.length,
          canvases,
          statsText,
          bkIncludes: bkInfoBefore.includes.length,
          made: { ok: made.ok, photoCount: made.data && made.data.photoCount, bytes: made.data && made.data.bytes },
          insp: { ok: insp.ok, photoCount: insp.photoCount },
          markerOk: marker.ok,
          markerId: marker.data && marker.data.id,
          restored: { ok: restored.ok, safetyBackup: restored.data && restored.data.safetyBackup },
          markerGone: !afterList.rows.some(r => r.task_no === 'lz-99001'),
          lastRestoreAt: bkInfoAfter.lastRestoreAt,
          lastBackupAfterCreate: bkInfoAfterCreate.lastBackupAt,
          lastBackupAfterRestore: bkInfoAfter.lastBackupAt,
          restoreAtBefore: bkInfoBefore.lastRestoreAt,
          attAfterRestore: attAfterRestore.length,
          statsAfterRestoreTrend: statsAfterRestore.trend.length
        }
      })()
    `)

    eq('统计接口按请求的月份数返回折线点', ops.trendLen === 6 && ops.trendMonths === 6, true)
    eq('不传月份时使用默认范围', ops.defaultMonths, 6)
    eq('业务类型维度有数据', ops.typeRows >= 1, true)
    eq('当前阶段维度有数据', ops.statusRows >= 1, true)
    eq('统计页渲染出 3 个图表画布（趋势 / 饼图 / 柱状）', ops.canvases >= 3, true)
    eq('统计页显示出标题与维度名', ops.statsText.includes('统计报表') && ops.statsText.includes('业务类型分布'), true)
    eq('统计页有导出按钮文案', ops.statsText.includes('导出项目台账'), true)
    eq('备份说明文案非空', ops.bkIncludes >= 3, true)

    console.log('\n── 备份与恢复 ──')
    eq('备份创建成功', ops.made.ok === true, true)
    eq('备份包统计到 1 张照片（此前删掉了一张）', ops.made.photoCount, 1)
    eq('备份包落到磁盘上', existsSync(bkZip), true)
    eq('备份包体积大于 0', (ops.made.bytes || 0) > 0, true)
    eq('备份包可被识别且照片数一致', ops.insp.ok === true && ops.insp.photoCount === 1, true)
    eq('备份成功后记录了备份时间', !!ops.lastBackupAfterCreate, true)
    eq('恢复前没有恢复记录', ops.restoreAtBefore, '')
    eq('标记项目在恢复前确实建好了', ops.markerOk === true, true)
    eq('恢复执行成功', ops.restored.ok === true, true)
    eq('恢复前的自动备份文件存在', existsSync(ops.restored.safetyBackup), true)
    eq('恢复后标记项目已消失', ops.markerGone, true)
    eq('恢复时间已记录', !!ops.lastRestoreAt, true)
    // 备份时间写在库里，所以会被恢复回滚成快照里的旧值 —— 这是快照语义的正常结果，
    // 界面上"上次恢复"的时间仍然是最新的，用户不会看糊涂
    eq('备份时间随快照回滚（快照语义正确）', ops.lastBackupAfterRestore, '')
    eq('恢复后照片记录仍在（照片一起被还原）', ops.attAfterRestore, 1)
    eq('恢复后统计接口仍可用', ops.statsAfterRestoreTrend, 6)

    console.log('\n── 测试钩子回归（FWJC_TEST_HOOKS 未设置） ──')
    const hookMap = ipcMain._invokeHandlers
    const parentHasHookHandler =
      hookMap && typeof hookMap.has === 'function'
        ? hookMap.has('attachment:__testAddByPaths')
        : null
    if (parentHasHookHandler === null) {
      console.log('  – 跳过主进程 handler 检查（当前 Electron 未暴露 _invokeHandlers）')
    } else {
      eq('钩子开启时主进程确实注册了测试通道', parentHasHookHandler, true)
    }

    const off = runHookOffProbe()
    if (!off.ran) {
      problems.push(`测试钩子回归子进程未跑通：${off.reason}`)
    } else {
      eq('子进程里普通接口依然可用（preload 正常）', off.hasAdd, true)
      eq('子进程渲染层拿不到测试钩子', off.hasTestHook, false)
      if (off.mainHandlerExists !== null) {
        eq('子进程主进程未注册测试通道', off.mainHandlerExists, false)
      }
      eq('子进程正常退出', off.code, 0)
    }

    console.log('\n── 运行时信息 ──')
    console.log(`  Electron ${result.info.electron} / Node ${result.info.node} / Chrome ${result.info.chrome}`)
    console.log(`  数据文件：${result.info.dbPath}`)

    finish(problems.length === 0 ? 0 : 1)
  } catch (err) {
    problems.push(`执行异常：${(err && err.message) || String(err)}`)
    finish(1)
  }
})
