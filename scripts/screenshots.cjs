/**
 * 生成界面截图（自动灌入演示数据）。
 *
 * 用法：npm run screenshots   （会先构建）
 * 产物：docs/screenshots/*.png
 *
 * 演示数据只写进临时目录，不会污染真实数据。
 */

const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots')
const dataDir = mkdtempSync(join(tmpdir(), 'fwjc-shot-'))
process.env.FWJC_USER_DATA = dataDir

const { app, BrowserWindow } = require('electron')
require(join(__dirname, '..', 'out', 'main', 'index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    mkdirSync(OUT_DIR, { recursive: true })
    const win = await waitForWindow()
    if (win.webContents.isLoading()) {
      await new Promise((r) => win.webContents.once('did-finish-load', r))
    }
    await sleep(1500)

    const js = (code) => win.webContents.executeJavaScript(code)

    // ── 灌演示数据 ──
    const seeded = await js(`
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms))
        for (let i = 0; i < 80; i++) {
          if (window.api) break
          await sleep(100)
        }
        const p = window.api.project
        const mk = async (d) => {
          const r = await p.create(d)
          if (!r.ok) throw new Error(r.message)
          return r.data.id
        }

        const idA = await mk({ task_no: 'lz-00007', name: '幸福小区3号楼房屋安全鉴定', client_name: '中山市某某置业有限公司', client_contact: '张工', client_phone: '13800138000', project_address: '中山市石岐区兴中道 12 号', project_type: 'security', test_category: 'concrete', source: 'phone', handler: '单飞', building_count: 1, building_area: 3260, floors: '地上6层/地下1层', struct_type: '框架结构', expect_finish_date: '2026-10-25' })
        const idB = await mk({ task_no: 'lz-00008', name: '阳光花园二期 5 号楼抗震鉴定', client_name: '某某房地产开发有限公司', client_contact: '李经理', client_phone: '13900139000', project_address: '中山市东区博爱路 88 号', project_type: 'seismic', test_category: 'masonry', source: 'visit', handler: '单飞', building_count: 1, building_area: 5120, floors: '地上9层', struct_type: '砌体结构' })
        const idC = await mk({ task_no: 'lz-00009', name: '某厂房火灾后结构损伤鉴定', client_name: '某某五金制品厂', project_type: 'fire', test_category: 'steel', source: 'government', handler: '陈工' })
        const idD = await mk({ task_no: 'lz-00010', name: '中山路 45 号商铺施工前周边现状检测', client_name: '中山市某某建设投资公司', client_contact: '王主任', project_type: 'construction', test_category: 'deformation', source: 'cooperation', handler: '单飞' })
        await mk({ task_no: 'lz-00011', name: '某老旧住宅楼危险性（危房）鉴定', client_name: '石岐区某某社区居民委员会', project_type: 'danger', test_category: 'crack', source: 'court' })

        await p.changeStatus(idB, 'contacted', { contact_note: '电话联系李经理，已发送资料清单，对方确认下周可进场' })
        await p.changeStatus(idC, 'contacted', { contact_note: '与厂方安全负责人对接，约定本周五勘察' })
        await p.changeStatus(idC, 'scheduled', { plan_test_date: '2026-10-09' })

        // D：停在"检测中"，用来演示"全部完成 / 部分完成"这个核心交互
        await p.changeStatus(idD, 'contacted', { contact_note: '联系王主任，确认现场已清场' })
        await p.changeStatus(idD, 'scheduled', { plan_test_date: '2026-10-08' })
        await p.changeStatus(idD, 'testing', { actual_test_date: '2026-10-08' })

        // A：走完整流程并留下"部分完成"记录
        await p.changeStatus(idA, 'contacted', { contact_note: '电话联系张工，对方提供图纸一套' })
        await p.changeStatus(idA, 'scheduled', { plan_test_date: '2026-10-08', report_due_date: '2026-10-28' })
        await p.changeStatus(idA, 'testing', { actual_test_date: '2026-10-08' })
        await p.changeStatus(idA, 'scheduled', { test_remark: '2 层以上需搭设脚手架，本次仅完成 1 层抽检', plan_test_date: '2026-10-15' })
        await p.changeStatus(idA, 'testing', { actual_test_date: '2026-10-15' })
        await p.changeStatus(idA, 'organizing', { test_remark: '已完成全部抽检项目，回弹数据与碳化深度已录入' })
        await p.changeStatus(idA, 'reporting', { organize_note: '正文已排版，附图 12 张，进入内部审核' })

        return { idA, idB, idC, idD }
      })()
    `)
    console.log('演示数据已生成')

    const goto = async (route, waitMs = 1600) => {
      const current = await js('location.hash')
      if (current === `#${route}`) {
        const away = route === '/projects' ? '#/settings' : '#/projects'
        await js(`location.hash = '${away}'`)
        await sleep(500)
      }
      await js(`location.hash = '#${route}'`)
      await sleep(waitMs)
    }

    const shot = async (file) => {
      const img = await win.webContents.capturePage()
      writeFileSync(join(OUT_DIR, file), img.toPNG())
      console.log(`已截图 ${file}`)
    }

    /** 按可见文字点击按钮 */
    const clickByText = async (prefix, waitMs = 1200) => {
      const ok = await js(`
        (() => {
          const b = [...document.querySelectorAll('button')].find(
            (x) => (x.innerText || '').trim().startsWith(${JSON.stringify(prefix)})
          )
          if (!b) return false
          b.click()
          return true
        })()
      `)
      if (!ok) throw new Error(`找不到按钮：${prefix}`)
      await sleep(waitMs)
    }

    await goto('/dashboard', 2200)
    await shot('01-工作台.png')

    await goto('/projects', 2000)
    await shot('02-项目列表.png')

    // 新建项目弹窗
    await clickByText('新建项目', 1400)
    await shot('03-新建项目.png')
    await js("document.querySelector('.ant-modal-close')?.click()")
    await sleep(600)

    // 项目详情：详细状态（部分完成两次进场 + 报告编写中）
    await goto(`/projects/${seeded.idA}`, 2400)
    await shot('04-项目详情.png')

    // 推进弹窗：检测中 → 全部完成 / 部分完成（核心交互）
    await goto(`/projects/${seeded.idD}`, 2400)
    await clickByText('推进到', 1500)
    await shot('05-推进弹窗-检测结果.png')
    await js("document.querySelector('.ant-modal-close')?.click()")
    await sleep(600)

    await goto('/settings', 1800)
    await shot('06-设置.png')

    rmSync(dataDir, { recursive: true, force: true })
    console.log('完成')
    process.exitCode = 0
  } catch (err) {
    console.log('截图失败：' + ((err && err.message) || String(err)))
    console.log('临时数据保留：' + dataDir)
    process.exitCode = 1
  }
  app.quit()
})
