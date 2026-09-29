/**
 * 生成界面截图（自动灌入演示数据）。
 *
 * 用法：npm run screenshots   （会先构建）
 * 产物：docs/screenshots/*.png
 *
 * 演示数据只写进临时目录，不会污染真实数据。
 * 打开测试钩子是为了能绕过系统文件选择框把示例照片灌进去 ——
 * 照片墙那张截图必须真的有图，否则就是一张空状态。
 */

const { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots')
const FIXTURES = ['photo-1.png', 'photo-2.png', 'photo-3.png'].map((n) =>
  join(__dirname, 'fixtures', n)
)
const dataDir = mkdtempSync(join(tmpdir(), 'fwjc-shot-'))
process.env.FWJC_USER_DATA = dataDir
process.env.FWJC_TEST_HOOKS = '1'

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
    // 先清掉上一次的产物：截图改名或删掉后，不清理就会在仓库里留下孤儿文件
    for (const f of readdirSync(OUT_DIR)) {
      if (/\.png$/i.test(f)) rmSync(join(OUT_DIR, f), { force: true })
    }
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
        /** 相对今天的日期偏移，用于散布到过去几个月 */
        const day = (offset) => {
          const d = new Date()
          d.setDate(d.getDate() + offset)
          const q = (v) => (v < 10 ? '0' + v : String(v))
          return d.getFullYear() + '-' + q(d.getMonth() + 1) + '-' + q(d.getDate())
        }

        const idA = await mk({ task_no: 'lz-00007', name: '幸福小区3号楼房屋安全鉴定', client_name: '中山市某某置业有限公司', client_contact: '张工', client_phone: '13800138000', project_address: '中山市石岐区兴中道 12 号', project_type: 'security', test_category: 'concrete', source: 'phone', handler: '单飞', testers: '单飞、陈工', building_count: 1, building_area: 3260, floors: '地上6层/地下1层', struct_type: '框架结构', expect_finish_date: '2026-10-25' })
        const idB = await mk({ task_no: 'lz-00008', name: '阳光花园二期 5 号楼抗震鉴定', client_name: '某某房地产开发有限公司', client_contact: '李经理', client_phone: '13900139000', project_address: '中山市东区博爱路 88 号', project_type: 'seismic', test_category: 'masonry', source: 'visit', handler: '单飞', testers: '单飞', building_count: 1, building_area: 5120, floors: '地上9层', struct_type: '砌体结构' })
        const idC = await mk({ task_no: 'lz-00009', name: '某厂房火灾后结构损伤鉴定', client_name: '某某五金制品厂', project_type: 'fire', test_category: 'steel', source: 'government', handler: '陈工', testers: '陈工、李工' })
        const idD = await mk({ task_no: 'lz-00010', name: '中山路 45 号商铺施工前周边现状检测', client_name: '中山市某某建设投资公司', client_contact: '王主任', project_type: 'construction', test_category: 'deformation', source: 'cooperation', handler: '单飞', testers: '单飞、李工' })
        const idE = await mk({ task_no: 'lz-00011', name: '某老旧住宅楼危险性（危房）鉴定', client_name: '石岐区某某社区居民委员会', project_type: 'danger', test_category: 'crack', source: 'court', receive_date: day(-9) })

        await p.changeStatus(idB, 'contacted', { contact_note: '电话联系李经理，已发送资料清单，对方确认下周可进场' })
        await p.changeStatus(idC, 'contacted', { contact_note: '与厂方安全负责人对接，约定本周五勘察' })
        await p.changeStatus(idC, 'scheduled', { plan_test_date: day(3) })

        // D：停在"检测中"，用来演示"全部完成 / 部分完成"这个核心交互
        await p.changeStatus(idD, 'contacted', { contact_note: '联系王主任，确认现场已清场' })
        await p.changeStatus(idD, 'scheduled', { plan_test_date: day(-1) })
        await p.changeStatus(idD, 'testing', { actual_test_date: day(-1) })

        // A：走完整流程并留下"部分完成"记录
        await p.changeStatus(idA, 'contacted', { contact_note: '电话联系张工，对方提供图纸一套' })
        await p.changeStatus(idA, 'scheduled', { plan_test_date: day(-12), report_due_date: day(-2) })
        await p.changeStatus(idA, 'testing', { actual_test_date: day(-12) })
        await p.changeStatus(idA, 'scheduled', { test_remark: '2 层以上需搭设脚手架，本次仅完成 1 层抽检', plan_test_date: day(-5) })
        await p.changeStatus(idA, 'testing', { actual_test_date: day(-5) })
        await p.changeStatus(idA, 'organizing', { test_remark: '已完成全部抽检项目，回弹数据与碳化深度已录入' })
        await p.changeStatus(idA, 'reporting', { organize_note: '正文已排版，附图 12 张，进入内部审核' })

        // E 停在"已接单"、接单日期压了 9 天 —— 工作台"今日待办"里要有一条真实超期项

        // ── 历史项目：把统计报表的折线和饼图填满 ──
        // 末位是报告实际出具日的偏移；应出日期固定为接单日 +30 天。
        // 其中两条刻意晚于应出日期，好让「报告超期率」有非零样本可看。
        const HISTORY = [
          ['lz-00021', '某小学教学楼房屋安全鉴定', '中山市某某小学', 'security', 'concrete', 'phone', '单飞', -170, -150],
          ['lz-00022', '某商住楼可靠性鉴定', '某某实业有限公司', 'reliability', 'concrete', 'cooperation', '陈工', -152, -128],
          ['lz-00023', '某住宅楼抗震鉴定', '某某置业', 'seismic', 'masonry', 'visit', '单飞', -134, -110],
          ['lz-00024', '某车间火灾后鉴定', '某某塑胶厂', 'fire', 'steel', 'government', '李工', -120, -88],
          ['lz-00025', '某沿街商铺施工前现状检测', '某某建设投资', 'construction', 'deformation', 'cooperation', '单飞', -104, -82],
          ['lz-00026', '某宿舍楼危险性鉴定', '某某社区居委会', 'danger', 'crack', 'court', '陈工', -88, -66],
          ['lz-00027', '某厂房安全鉴定', '某某五金制品厂', 'security', 'steel', 'phone', '李工', -74, -52],
          ['lz-00028', '某幼儿园房屋安全鉴定', '某某幼儿园', 'security', 'masonry', 'visit', '单飞', -60, -40],
          ['lz-00029', '某办公楼可靠性鉴定', '某某物业管理', 'reliability', 'concrete', 'phone', '陈工', -45, -11],
          ['lz-00030', '某住宅小区 8 号楼抗震鉴定', '某某置业', 'seismic', 'concrete', 'cooperation', '单飞', -32, -14],
          ['lz-00031', '某市场钢结构安全鉴定', '某某市场管理', 'security', 'steel', 'government', '李工', -20, -4],
          ['lz-00032', '某中学体育馆危险性鉴定', '中山市某某中学', 'danger', 'steel', 'visit', '陈工', -11, -1]
        ]
        for (let i = 0; i < HISTORY.length; i++) {
          const [taskNo, name, client, type, cat, src, handler, recvOff, issueOff] = HISTORY[i]
          const pid = await mk({
            task_no: taskNo, name, client_name: client,
            project_type: type, test_category: cat, source: src, handler,
            testers: handler + '、单飞',
            receive_date: day(recvOff)
          })
          await p.changeStatus(pid, 'contacted', { contact_note: '电话联系委托方，确认鉴定范围与要求' })
          await p.changeStatus(pid, 'scheduled', { plan_test_date: day(recvOff + 4), report_due_date: day(recvOff + 30) })
          await p.changeStatus(pid, 'testing', { actual_test_date: day(recvOff + 5) })
          await p.changeStatus(pid, 'organizing', { test_remark: '现场检测项目全部完成' })
          await p.changeStatus(pid, 'reporting', { organize_note: '数据整理完毕，进入报告编制' })
          await p.changeStatus(pid, 'report_issued', {
            report_no: '房鉴字LZ【2026】第0' + (400 + i) + '号',
            report_issue_date: day(issueOff)
          })
          // 只把其中一部分归档：真实使用中归档总是滞后的
          if (i % 3 === 0) await p.changeStatus(pid, 'closed')
        }

        // ── 现场照片：走测试钩子灌 3 张示例图 ──
        let photoMsg = ''
        if (window.api.attachment.__testAddByPaths) {
          const r = await window.api.attachment.__testAddByPaths(idA, ${JSON.stringify(FIXTURES)})
          photoMsg = r && r.message ? r.message : ''
        }

        return { idA, idD, idE, photoMsg }
      })()
    `)
    console.log(`演示数据已生成（${seeded.photoMsg || '未添加照片'}）`)

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

    /**
     * 按卡片标题把某块内容滚到视口中间。
     * 用卡片标题而不是 CSS 选择器：卡片位置会随上面的内容多少而变，
     * 标题是唯一稳定的锚点。
     */
    const scrollToCard = async (title) => {
      const ok = await js(`
        (() => {
          const el = [...document.querySelectorAll('.ant-card')].find(
            (c) => (c.innerText || '').trim().startsWith(${JSON.stringify(title)})
          )
          if (!el) return false
          el.scrollIntoView({ block: 'center' })
          return true
        })()
      `)
      await sleep(700)
      return ok
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

    // ── 本期新增功能的截图 ──

    // 07 工作台「今日待办」
    await goto('/dashboard', 2400)
    if (!(await scrollToCard('今日待办'))) throw new Error('找不到「今日待办」卡片')
    await shot('07-工作台-今日待办.png')

    // 08 统计报表（上半部分：关键数字 + 按月趋势）
    await goto('/stats', 2600)
    // ECharts 是异步首帧渲染的，等画布真正出来再拍，否则会拍到空白
    for (let i = 0; i < 40; i++) {
      const n = await js("document.querySelectorAll('.ant-card canvas').length")
      if (n >= 3) break
      await sleep(250)
    }
    await sleep(900)
    await shot('08-统计报表.png')

    // 09 统计报表（下半部分：业务类型分布 + 当前阶段分布）
    if (!(await scrollToCard('业务类型分布'))) throw new Error('找不到「业务类型分布」卡片')
    await shot('09-统计报表-分布图.png')

    // 10 项目详情「现场照片」照片墙
    await goto(`/projects/${seeded.idA}`, 2600)
    if (!(await scrollToCard('现场照片'))) throw new Error('找不到现场照片墙')
    await shot('10-项目详情-照片墙.png')

    // 11 设置页「数据备份与恢复」
    await goto('/settings', 2000)
    if (!(await scrollToCard('数据备份与恢复'))) throw new Error('找不到「数据备份与恢复」卡片')
    await shot('11-设置-数据备份.png')

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
