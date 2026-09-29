/**
 * 数据库层 + 业务逻辑自检。
 *
 * 主进程里除了窗口创建和 IPC 注册之外的部分都不依赖 Electron，
 * 所以可以用纯 Node 直接跑一遍，把 schema、迁移、任务单号校验、
 * 状态机、日志时间轴全部验证掉。
 *
 * 用法：npm run selftest
 * 实现方式：先用 esbuild 把本文件打成 CJS（解析 @shared 别名），再用 node 执行。
 */

import { mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDbPath, initDatabase } from '../src/main/db/connection'
import { SCHEMA_VERSION } from '../src/main/db/migrate'
import * as svc from '../src/main/services/project.service'
import { listLogs } from '../src/main/db/repositories/log.repo'
import { countByStatus, list } from '../src/main/db/repositories/project.repo'
import * as attachRepo from '../src/main/db/repositories/attachment.repo'
import { listAlertCandidates } from '../src/main/db/repositories/alert.repo'
import { normalizeTaskNo } from '../src/shared/taskNo'
import { buildProjectAlert, countByLevel, evaluateAlerts, type AlertThresholds, type AlertEvalInput } from '../src/shared/alerts'
import {
  formatAvgDays,
  formatRate,
  mergeTrend,
  monthKeys,
  statusLabelOf,
  STATUS_CHART_ORDER
} from '../src/shared/stats'
import { getStatsOverview } from '../src/main/services/stats.service'
import { buildProjectWorkbook } from '../src/main/services/excel.service'
import {
  backupIncludes,
  createBackup,
  defaultBackupFileName,
  initBackup,
  inspectBackup,
  restoreBackup
} from '../src/main/services/backup.service'
import { setSetting, getSetting } from '../src/main/db/repositories/setting.repo'
import type { Attachment } from '../src/shared/types'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`)
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`)
}

const dataDir = mkdtempSync(join(tmpdir(), 'fwjc-selftest-'))
console.log(`临时数据目录：${dataDir}`)

// ─────────────────────────────────────────
section('1. 初始化与迁移')

const r1 = initDatabase(dataDir)
check('数据库文件已创建', existsSync(r1.file), r1.file)
check('迁移从 v0 一路升到最新版', r1.migration.from === 0 && r1.migration.to === SCHEMA_VERSION, r1.migration)

// 重复初始化应当幂等（user_version 已是最新，不再重复建表）
const r2 = initDatabase(dataDir)
check(
  '重复初始化幂等（不再重跑迁移）',
  r2.migration.from === SCHEMA_VERSION && r2.migration.to === SCHEMA_VERSION,
  r2.migration
)

// ─────────────────────────────────────────
section('2. 任务单号格式与规范化')

check('小写+连字符原样通过', normalizeTaskNo('lz-00007') === 'lz-00007', normalizeTaskNo('lz-00007'))
check('大写自动转小写', normalizeTaskNo('LZ-00007') === 'lz-00007', normalizeTaskNo('LZ-00007'))
check('漏打连字符自动补上', normalizeTaskNo('lz00007') === 'lz-00007', normalizeTaskNo('lz00007'))
check('含空格自动清理', normalizeTaskNo(' lz 00007 ') === 'lz-00007', normalizeTaskNo(' lz 00007 '))
check('全角横线归一化', normalizeTaskNo('lz－00007') === 'lz-00007', normalizeTaskNo('lz－00007'))

// ─────────────────────────────────────────
section('3. 新建项目与唯一性校验')

const c1 = svc.createProject({ task_no: 'lz-00001', name: '幸福小区3号楼安全鉴定', client_name: '某某置业' })
check('新建成功', c1.ok === true, c1.message)
check('初始状态为已接单', c1.data?.status === 'received', c1.data?.status)
check('接单日期自动填今天', !!c1.data?.receive_date, c1.data?.receive_date)

const c1dup = svc.createProject({ task_no: 'lz-00001', name: '重复', client_name: 'X' })
check('重号被拦截', c1dup.ok === false, c1dup.message)
check('重号提示里带上了占用者名称', !!c1dup.message?.includes('幸福小区3号楼安全鉴定'), c1dup.message)

const c1norm = svc.createProject({ task_no: 'LZ00002', name: '阳光花园1号楼', client_name: '甲单位' })
check('大小写+缺连字符自动修正后入库', c1norm.data?.task_no === 'lz-00002', c1norm.data?.task_no)

const bad = svc.createProject({ task_no: 'abc-123', name: 'X', client_name: 'Y' })
check('格式不合法被拦截', bad.ok === false, bad.message)

const warn = svc.createProject({ task_no: 'xz-00003', name: '前缀不一致的项目', client_name: '乙单位' })
check('前缀不一致只软提醒不拦截', warn.ok === true && (warn.warnings?.length ?? 0) > 0, warn.warnings)

const noName = svc.createProject({ task_no: 'lz-00004', name: '  ', client_name: '丙单位' })
check('项目名称必填', noName.ok === false, noName.message)

// ─────────────────────────────────────────
section('4. 状态机：完整走一遍主流程（含"部分完成"）')

const id = c1.data!.id

function to(target: Parameters<typeof svc.changeStatus>[1], payload = {}): ReturnType<typeof svc.changeStatus> {
  return svc.changeStatus(id, target, payload)
}

check('已接单 → 已联系委托方', to('contacted', { contact_note: '电话联系张工' }).ok)
check('已联系 → 已定检测日期', to('scheduled', { plan_test_date: '2026-10-08' }).ok)

// 非法流转：尚未进场就想直接整理记录
const illegal = to('organizing')
check('非法流转被拒绝（已定日期 → 整理记录中）', illegal.ok === false, illegal.message)

check('已定日期 → 检测中', to('testing', { actual_test_date: '2026-10-08' }).ok)
check('进场次数记为 1', svc.getProject(id)?.test_round === 1, svc.getProject(id)?.test_round)

// 部分完成 → 回到已定检测日期，状态标记为 partial
const partial = to('scheduled', { test_remark: '2层以上需搭架后补测', plan_test_date: '2026-10-15' })
check('部分完成可回到已定检测日期', partial.ok === true, partial.message)
check('检测状态标记为 partial', svc.getProject(id)?.test_status === 'partial', svc.getProject(id)?.test_status)
check(
  '部分完成原因已保存',
  svc.getProject(id)?.test_remark?.includes('搭架') === true,
  svc.getProject(id)?.test_remark
)

// 部分完成时不填原因必须被拦
const noReason = svc.changeStatus(id, 'testing', { actual_test_date: '2026-10-15' })
check('部分完成后再进场成功', noReason.ok === true, noReason.message)
const partialNoReason = svc.changeStatus(id, 'scheduled', {})
check('部分完成不填原因被拦截', partialNoReason.ok === false, partialNoReason.message)

check('进场次数记为 2', svc.getProject(id)?.test_round === 2, svc.getProject(id)?.test_round)
check('检测中 → 整理记录中（全部完成）', to('organizing', { test_remark: '全部抽检完成' }).ok)
check('检测状态变为 done', svc.getProject(id)?.test_status === 'done', svc.getProject(id)?.test_status)
check('整理记录 → 出具报告中', to('reporting', { organize_note: '数据已录入' }).ok)
check('报告状态变为 drafting', svc.getProject(id)?.report_status === 'drafting', svc.getProject(id)?.report_status)

const noReportNo = to('report_issued', {})
check('登记报告时不填编号被拦截', noReportNo.ok === false, noReportNo.message)

check(
  '出具报告中 → 报告已出',
  to('report_issued', { report_no: '房鉴字LZ【2026】第0398号', report_issue_date: '2026-10-20' }).ok
)
check('报告状态变为 issued', svc.getProject(id)?.report_status === 'issued', svc.getProject(id)?.report_status)
check('报告已出 → 已归档', to('closed').ok === true)
check('归档时间已写入', !!svc.getProject(id)?.closed_at, svc.getProject(id)?.closed_at)

const afterClose = to('testing')
check('终态不能再往前推进', afterClose.ok === false, afterClose.message)

// ─────────────────────────────────────────
section('5. 暂缓与取消')

const c2 = svc.createProject({ task_no: 'lz-00010', name: '暂缓测试项目', client_name: '丁单位' })
const id2 = c2.data!.id
check('暂缓成功并记住原状态', svc.changeStatus(id2, 'paused', { pause_reason: '客户要求延期' }).ok)
check('暂缓前状态被记录', svc.getProject(id2)?.paused_from_status === 'received', svc.getProject(id2)?.paused_from_status)
check(
  '暂缓中可直接恢复回原状态',
  svc.changeStatus(id2, 'received', {}).ok,
  svc.getProject(id2)?.status
)
const cancelNoReason = svc.changeStatus(id2, 'cancelled', {})
check('取消不填原因被拦截', cancelNoReason.ok === false, cancelNoReason.message)
check('取消成功', svc.changeStatus(id2, 'cancelled', { cancel_reason: '已另行委托' }).ok)

// ─────────────────────────────────────────
section('6. 操作日志（时间轴）')

const logs = listLogs(id)
check('日志有记录', logs.length > 0, logs.length)
check(
  '日志里有"部分完成"那条',
  logs.some((l) => (l.content ?? '').includes('部分完成')),
  logs.map((l) => l.content).slice(0, 3)
)
check('日志记录了状态流转前后', logs.some((l) => l.from_status === 'testing' && l.to_status === 'scheduled'))
check('日志记录了操作人', logs.every((l) => !!l.operator), logs[0]?.operator)
check('日志按时间倒序', logs.length < 2 || logs[0].occurred_at >= logs[logs.length - 1].occurred_at)

// ─────────────────────────────────────────
section('7. 列表查询与统计')

const all = list({ page: 1, pageSize: 20, status: 'all' })
check('列表能取到全部项目', all.total >= 4, all.total)

const byKw = list({ keyword: '阳光', page: 1, pageSize: 20 })
check('关键字能搜到项目名称', byKw.total === 1 && byKw.rows[0].task_no === 'lz-00002', byKw.total)

const byTaskNo = list({ keyword: 'lz-00001', page: 1, pageSize: 20 })
check('关键字能搜到任务单号', byTaskNo.total === 1, byTaskNo.total)

const paged = list({ page: 1, pageSize: 2, status: 'all' })
check('分页 pageSize 生效', paged.rows.length === 2, paged.rows.length)

const counts = countByStatus()
check('状态统计包含已归档', (counts['closed'] ?? 0) >= 1, counts)
check('状态统计包含已取消', (counts['cancelled'] ?? 0) >= 1, counts)

// ─────────────────────────────────────────
section('8. 编辑与再次持久化')

const up = svc.updateProject(id, { handler: '单飞', building_area: 3200.5, remark: '补充备注' })
check('编辑成功', up.ok === true, up.message)
check('字段已更新', svc.getProject(id)?.handler === '单飞' && svc.getProject(id)?.building_area === 3200.5)

const upDup = svc.updateProject(id2, { task_no: 'lz-00001' })
check('编辑时改成他人在用的任务单号被拦截', upDup.ok === false, upDup.message)

const dbPath = getDbPath()
// 先在关闭前记下日志条数：关闭前后的对比要基于同一时刻的快照
const logCountBeforeClose = listLogs(id).length
closeDatabase()
check(
  '关闭后再打开，数据仍在且日志未丢',
  (() => {
    initDatabase(dataDir)
    const again = svc.getProject(id)
    return (
      again?.handler === '单飞' &&
      again?.status === 'closed' &&
      listLogs(id).length === logCountBeforeClose
    )
  })()
)

// ─────────────────────────────────────────
section('9. 待办预警规则（今日固定为 2026-10-20）')

const TODAY = '2026-10-20'
// 阈值取数据库种子里的默认值，和 SEED_V1_SETTINGS 保持一致
const TH: AlertThresholds = {
  receive_contact_days: 3,
  test_upcoming_days: 2,
  report_due_warn_days: 3,
  stale_days: 7,
  partial_followup_days: 5
}

/** 造一条判定输入；用"今天"作为默认 updated_at，避免兜底规则意外命中 */
function input(patch: Partial<AlertEvalInput>): AlertEvalInput {
  return {
    status: 'received',
    test_status: 'none',
    receive_date: null,
    plan_test_date: null,
    report_due_date: null,
    report_issue_date: null,
    updated_at: `${TODAY} 09:00:00`,
    ...patch
  }
}

const hitRules = (a: ReturnType<typeof evaluateAlerts>): string => a.map((h) => `${h.rule}:${h.level}`).join(',')

// ① 接单未联系
const r1a = evaluateAlerts(input({ receive_date: '2026-10-10' }), TH, TODAY)
check('接单 10 天未联系 → 超期', r1a.length === 1 && r1a[0].level === 'overdue' && r1a[0].days === 10, hitRules(r1a))
const r1b = evaluateAlerts(input({ receive_date: '2026-10-17' }), TH, TODAY)
check('接单恰好 3 天（=阈值）→ 今天到期', r1b.length === 1 && r1b[0].level === 'today', hitRules(r1b))
check('接单 2 天 → 不提醒', evaluateAlerts(input({ receive_date: '2026-10-18' }), TH, TODAY).length === 0)
check('接单日期为空 → 不提醒', evaluateAlerts(input({ receive_date: null }), TH, TODAY).length === 0)
check(
  '已联系委托方 → 接单规则不再命中',
  evaluateAlerts(input({ status: 'contacted', receive_date: '2026-09-01' }), TH, TODAY).length === 0
)

// 终态与暂缓
check('已归档 → 全部不提醒', evaluateAlerts(input({ status: 'closed', receive_date: '2026-09-01' }), TH, TODAY).length === 0)
check('已取消 → 全部不提醒', evaluateAlerts(input({ status: 'cancelled', receive_date: '2026-09-01' }), TH, TODAY).length === 0)
check('已暂缓 → 全部不提醒', evaluateAlerts(input({ status: 'paused', receive_date: '2026-09-01' }), TH, TODAY).length === 0)

// ② 约定检测日期
const r2today = evaluateAlerts(input({ status: 'scheduled', plan_test_date: TODAY }), TH, TODAY)
check('约定今天进场 → 今天到期', r2today.length === 1 && r2today[0].level === 'today', hitRules(r2today))
const r2past = evaluateAlerts(input({ status: 'scheduled', plan_test_date: '2026-10-18' }), TH, TODAY)
check('约定日期已过 2 天 → 超期且 days=2', r2past.length === 1 && r2past[0].level === 'overdue' && r2past[0].days === 2, hitRules(r2past))
const r2soon = evaluateAlerts(input({ status: 'scheduled', plan_test_date: '2026-10-22' }), TH, TODAY)
check('还有 2 天（=阈值）→ 临近', r2soon.length === 1 && r2soon[0].level === 'soon', hitRules(r2soon))
check(
  '还有 3 天（>阈值）→ 不提醒',
  evaluateAlerts(input({ status: 'scheduled', plan_test_date: '2026-10-23' }), TH, TODAY).length === 0
)
check(
  '约定日期为空 → 不提醒',
  evaluateAlerts(input({ status: 'scheduled', plan_test_date: null }), TH, TODAY).length === 0
)

// ③ 报告应出
const r3today = evaluateAlerts(input({ status: 'reporting', report_due_date: TODAY }), TH, TODAY)
check('报告今天该出 → 今天到期', r3today.length === 1 && r3today[0].level === 'today', hitRules(r3today))
const r3past = evaluateAlerts(input({ status: 'organizing', report_due_date: '2026-10-17' }), TH, TODAY)
check('报告已超期 3 天 → 超期', r3past.length === 1 && r3past[0].level === 'overdue' && r3past[0].days === 3, hitRules(r3past))
check(
  '报告已出具 → 不再提醒报告应出',
  evaluateAlerts(
    input({ status: 'report_issued', report_due_date: '2026-10-01', report_issue_date: '2026-10-19' }),
    TH,
    TODAY
  ).length === 0
)

// ④ 部分完成待跟进 & ⑤ 停滞兜底
const r5 = evaluateAlerts(
  input({ status: 'scheduled', test_status: 'partial', updated_at: '2026-10-12 09:00:00' }),
  TH,
  TODAY
)
check(
  '部分完成 8 天未再进场 → 只报"部分完成"，不再叠一条"停滞"',
  r5.length === 1 && r5[0].rule === 'partial_followup' && r5[0].level === 'overdue',
  hitRules(r5)
)
const r4 = evaluateAlerts(
  input({ status: 'organizing', test_status: 'done', updated_at: '2026-10-12 09:00:00' }),
  TH,
  TODAY
)
check('无其他命中且 8 天没动 → 停滞兜底命中', r4.length === 1 && r4[0].rule === 'stale', hitRules(r4))

// 多条并存
const multi = buildProjectAlert(
  { id: 'p1', task_no: 'lz-00099', name: '多原因项目', ...input({ status: 'scheduled', plan_test_date: '2026-10-18', report_due_date: '2026-10-19' }) },
  TH,
  TODAY
)
check(
  '同时命中进场超期与报告超期 → 两条原因、取最严重级别',
  multi !== null && multi.hits.length === 2 && multi.level === 'overdue',
  multi?.hits.map((h) => h.rule)
)
check('无命中时不产出待办项', buildProjectAlert({ id: 'p2', task_no: 'lz-00100', name: 'x', ...input({}) }, TH, TODAY) === null)

const countsDemo = countByLevel([
  { project_id: 'a', task_no: 't1', name: 'a', level: 'overdue', hits: [] },
  { project_id: 'b', task_no: 't2', name: 'b', level: 'soon', hits: [] },
  { project_id: 'c', task_no: 't3', name: 'c', level: 'overdue', hits: [] }
])
check(
  '待办数量汇总正确',
  countsDemo.overdue === 2 && countsDemo.soon === 1 && countsDemo.today === 0 && countsDemo.total === 3,
  countsDemo
)

// 真实数据走一遍：新建的项目应当能被评估（这条同时验证 alert.repo 的字段名没写错）
const cAlert = svc.createProject({ task_no: 'lz-00021', name: '待办评估用项目', client_name: '戊单位' })
const candidates = listAlertCandidates()
check(
  '预警候选查询能取到刚建的项目',
  candidates.some((c) => c.id === cAlert.data?.id),
  candidates.length
)

// ─────────────────────────────────────────
section('10. 附件表与级联删除')

const cAttach = svc.createProject({ task_no: 'lz-00022', name: '附件测试项目', client_name: '己单位' })
const attachProjectId = cAttach.data!.id

function makeAttachment(n: number): Attachment {
  const id = `11111111-2222-3333-4444-55555555555${n}`
  return {
    id,
    project_id: attachProjectId,
    file_name: `现场照片${n}.jpg`,
    stored_name: `${id}.jpg`,
    rel_path: `${attachProjectId}/${id}.jpg`,
    ext: 'jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024 * n,
    width: null,
    height: null,
    taken_at: null,
    sort: attachRepo.nextSort(attachProjectId),
    created_at: `${TODAY} 10:0${n}:00`
  }
}

attachRepo.insert(makeAttachment(1))
attachRepo.insert(makeAttachment(2))
check('插入 2 条附件后按项目能查到 2 条', attachRepo.listByProject(attachProjectId).length === 2)
check('附件计数正确', attachRepo.countByProject(attachProjectId) === 2)
check('排序号递增', attachRepo.listByProject(attachProjectId)[1].sort > attachRepo.listByProject(attachProjectId)[0].sort)
check('按相对路径能反查到记录', attachRepo.findByRelPath(makeAttachment(1).rel_path)?.file_name === '现场照片1.jpg')
check('重复 rel_path 会被拒绝（UNIQUE 生效）', (() => {
  try {
    attachRepo.insert({ ...makeAttachment(3), rel_path: makeAttachment(1).rel_path })
    return false
  } catch {
    return true
  }
})())

// 级联删除：删项目时附件记录应一并消失（依赖 PRAGMA foreign_keys = ON）
svc.removeProject(attachProjectId)
check('删除项目后附件记录一并清除（CASCADE 生效）', attachRepo.countByProject(attachProjectId) === 0)
check('删除项目后按项目查附件返回空数组', attachRepo.listByProject(attachProjectId).length === 0)

// ─────────────────────────────────────────
section('11. 统计报表：纯函数')

check('月份键个数正确', monthKeys(6, '2026-10-20').length === 6, monthKeys(6, '2026-10-20'))
check(
  '月份键连续且以当月结尾',
  monthKeys(6, '2026-10-20').join(',') === '2026-05,2026-06,2026-07,2026-08,2026-09,2026-10',
  monthKeys(6, '2026-10-20')
)
check(
  '跨年补月份不越界（1 月往前推 3 个月）',
  monthKeys(3, '2026-01-15').join(',') === '2025-11,2025-12,2026-01',
  monthKeys(3, '2026-01-15')
)
check('月份数被夹到 1~36', monthKeys(0, '2026-10-20').length === 1 && monthKeys(999, '2026-10-20').length === 36)
check(
  '传入非法日期时退化为当前年（不抛异常）',
  monthKeys(1, 'not-a-date').length === 1
)

const merged = mergeTrend(
  ['2026-08', '2026-09', '2026-10'],
  [
    { ym: '2026-08', c: 3 },
    { ym: '2026-10', c: 5 }
  ],
  [{ ym: '2026-09', c: 1 }]
)
check(
  '稀疏月份被补 0 而不是丢点',
  merged.length === 3 && merged[1].received === 0 && merged[1].issued === 1 && merged[2].received === 5,
  merged
)

check('平均天数无样本时显示"暂无数据"', formatAvgDays(null) === '暂无数据')
check('平均天数保留一位小数', formatAvgDays(12.34) === '12.3 天', formatAvgDays(12.34))
check('超期率无样本时显示破折号', formatRate(null) === '—')
check('超期率换算成百分比', formatRate(0.256) === '25.6%', formatRate(0.256))
check('阶段中文名可查', statusLabelOf('report_issued') === '报告已出')
check('未知阶段原样返回（界面不会空白）', statusLabelOf('weird') === 'weird')
check('阶段图表顺序覆盖全部 10 个状态', STATUS_CHART_ORDER.length === 10)

// ─────────────────────────────────────────
section('12. 统计报表：真实聚合')

// 造一个日期链完整的项目，让周期与超期率有确定样本
const cStat = svc.createProject({ task_no: 'lz-00030', name: '统计测试项目', client_name: '庚单位' })
const statId = cStat.data!.id
svc.updateProject(statId, {
  project_type: 'security',
  receive_date: '2026-01-10',
  actual_test_date: '2026-01-15',
  report_due_date: '2026-02-10',
  report_issue_date: '2026-02-20'
})
// 再造一个"报告应出日期已过、但还没出具"的在办项目
const cLate = svc.createProject({ task_no: 'lz-00031', name: '报告逾期在办项目', client_name: '辛单位' })
svc.updateProject(cLate.data!.id, { report_due_date: '2026-02-10' })

const overview = getStatsOverview(6)
check('时间范围回显正确', overview.range.months === 6 && /^\d{4}-\d{2}-01$/.test(overview.range.since), overview.range)
check('折线点数等于月份数', overview.trend.length === 6, overview.trend.length)

const dbTotal = list({ page: 1, pageSize: 1 }).total
const statusSum = overview.byStatus.reduce((a, b) => a + b.count, 0)
check('各阶段数量之和等于项目总数（聚合没有漏掉状态）', statusSum === dbTotal, { statusSum, dbTotal })

check(
  '业务类型分布按字典翻译成中文',
  overview.byProjectType.some((r) => r.code === 'security' && r.label === '房屋安全性鉴定' && r.count >= 1),
  overview.byProjectType
)
check(
  '未填业务类型的归到"未填写"而不是空字符串',
  overview.byProjectType.some((r) => r.code === null && r.label === '未填写'),
  overview.byProjectType.map((r) => r.label)
)

check('平均接单→进场天数算出来了', (overview.cycle.avgReceiveToTest ?? 0) > 0, overview.cycle.avgReceiveToTest)
check('平均接单→出报告天数算出来了', (overview.cycle.avgReceiveToReport ?? 0) > 0, overview.cycle.avgReceiveToReport)
check('超期分母只算"既填了应出日期又已出具"的样本', overview.cycle.reportIssuedWithDue === 1, overview.cycle.reportIssuedWithDue)
check('2026-02-20 出具 vs 应出 2026-02-10 → 判为超期', overview.cycle.reportOverdueIssued === 1, overview.cycle.reportOverdueIssued)
check('超期率因此为 100%', overview.cycle.reportOverdueRate === 1, overview.cycle.reportOverdueRate)
check('在办项目里识别出报告逾期的那个', overview.cycle.reportOverdueOpen >= 1, overview.cycle.reportOverdueOpen)

check('月份数被夹紧（传 999 不会扫十年）', getStatsOverview(999).range.months === 36)
check('传入非法月份数时回落默认值', getStatsOverview(Number.NaN).range.months === 6)

// 报告出具量必须按 report_issue_date 归月（而不是归档时间）——
// 也就是说把它挪到窗口之外，趋势里就应当查不到它
const wide = getStatsOverview(36)
check(
  '报告出具量按实际出具日期归月',
  wide.trend.some((t) => t.issued > 0),
  wide.trend.filter((t) => t.issued > 0)
)
check(
  '统计窗口外的事件不进折线（近 6 个月看不到 2026-02 出具的那份）',
  overview.trend.every((t) => t.ym >= overview.range.since.slice(0, 7)),
  overview.trend.map((t) => t.ym)
)

// ─────────────────────────────────────────
// 13、14 两节需要 await（exceljs 读工作簿是异步 API），而 esbuild 打成 CJS 时
// 不支持顶层 await，所以把它们连同末尾的汇总一起放进这个 async 块。
// 顺序依旧是"全部测完 → 汇总 → 退出"。
void (async () => {
section('13. 导出台账 Excel')

const exportRows = svc.listProjectsForExport({})
const labelMap: Record<string, string> = {
  security: '房屋安全性鉴定',
  reliability: '房屋可靠性鉴定',
  danger: '房屋危险性（危房）鉴定',
  seismic: '建筑抗震鉴定',
  construction: '施工前周边房屋现状鉴定',
  fire: '火灾后房屋鉴定',
  other: '其他'
}

const wb = await (async (): Promise<import('exceljs').Workbook> => {
  const buf = await buildProjectWorkbook(exportRows, {
    orgName: '广东测试鉴定有限公司',
    generatedAt: '2026-10-20 09:00:00',
    projectType: (c) => (c ? (labelMap[c] ?? c) : ''),
    testCategory: (c) => c ?? '',
    source: (c) => c ?? ''
  })
  const ExcelJS = (await import('exceljs')).default
  const book = new ExcelJS.Workbook()
  // exceljs 自带的 d.ts 里 Buffer 与 @types/node 的 Buffer 泛型对不上（TS 5.7+ 的
  // Buffer<ArrayBufferLike> 变更所致），运行时完全没问题，这里显式绕过类型检查
  await book.xlsx.load(buf as never)
  return book
})()

const ws = wb.worksheets[0]
const headerValues = (ws.getRow(3).values as unknown[]) ?? []
/** 按表头名找列号，而不是写死下标 —— 以后插入新列这条断言不会假失败 */
const colOf = (name: string): number => headerValues.indexOf(name)

check('工作簿有且只有一个工作表', wb.worksheets.length === 1, wb.worksheets.length)
check('工作表名为「项目台账」', ws.name === '项目台账', ws.name)
check('第 1 行是标题且含单位名称', String(ws.getRow(1).getCell(1).value ?? '').includes('广东测试鉴定有限公司'))
check('第 3 行是表头', String(ws.getRow(3).getCell(1).value ?? '') === '任务单号', ws.getRow(3).getCell(1).value)
check('表头含「检测人员」列（本期新增字段）', colOf('检测人员') > 0, headerValues.slice(1, 12))
check('数据行数与导出行数一致', ws.rowCount === exportRows.length + 3, { rowCount: ws.rowCount, exportRows: exportRows.length })

// 第 3 行是表头，所以第一条数据在第 4 行；这一条同时把"行序"钉住
check(
  '第 4 行对应导出的第一条记录',
  String(ws.getRow(4).getCell(colOf('任务单号')).value ?? '') === exportRows[0].task_no,
  { sheet: ws.getRow(4).getCell(colOf('任务单号')).value, rows: exportRows[0].task_no }
)

const statRow = exportRows.findIndex((r) => r.task_no === 'lz-00030')
check('导出的行里能找到刚建的项目', statRow >= 0, statRow)
check(
  '业务类型被翻译成中文而不是输出 code',
  String(ws.getRow(statRow + 4).getCell(colOf('业务类型')).value ?? '') === '房屋安全性鉴定',
  ws.getRow(statRow + 4).getCell(colOf('业务类型')).value
)

// ─────────────────────────────────────────
section('14. 备份与恢复')

const attachDir = join(dataDir, 'attachments')
const safetyDir = join(dataDir, 'backups')
mkdirSync(join(attachDir, 'p-demo'), { recursive: true })
writeFileSync(join(attachDir, 'p-demo', 'photo-a.jpg'), Buffer.alloc(2048, 7))
writeFileSync(join(attachDir, 'p-demo', 'photo-b.jpg'), Buffer.alloc(1024, 9))

initBackup(getDbPath(), attachDir)
check('备份内容说明非空（设置页要展示）', backupIncludes().length >= 3)
check('默认备份文件名带时间戳', /^检测项目数据备份-\d{8}-\d{4}\.zip$/.test(defaultBackupFileName()), defaultBackupFileName())

const zipPath = join(dataDir, 'backup-test.zip')
const made = createBackup(zipPath)
check('备份包已生成', existsSync(zipPath) && made.bytes > 0, made)
check('备份统计到 2 张照片', made.photoCount === 2, made.photoCount)
check('包里数据库快照非空', made.dbBytes > 0, made.dbBytes)

const insp = inspectBackup(zipPath)
check('备份包可被识别', insp.ok === true, insp)
check('清单里的照片数与实际一致', insp.photoCount === 2, insp.photoCount)
check('清单里有备份时间', !!insp.createdAt, insp.createdAt)
check(
  '拿一个假的 zip 会被识别为"不是本软件的备份包"',
  inspectBackup(join(dataDir, 'fwjc.db')).ok === false,
  inspectBackup(join(dataDir, 'fwjc.db'))
)

// 备份之后再改数据 —— 恢复后这些改动都该消失
const cAfter = svc.createProject({ task_no: 'lz-00099', name: '备份之后才建的项目', client_name: '壬单位' })
setSetting('org.name', '备份之后才改的名字')
writeFileSync(join(attachDir, 'p-demo', 'photo-later.jpg'), Buffer.alloc(64, 1))
check('备份后新增的项目确实存在', !!svc.getProject(cAfter.data!.id))

const restored = restoreBackup(zipPath, safetyDir)
check('恢复前自动备份的"后悔药"已生成', existsSync(restored.safetyBackup), restored.safetyBackup)
check('后悔药本身是合法备份包', inspectBackup(restored.safetyBackup).ok === true)

check('恢复后，备份之后新建的项目已消失', svc.getProject(cAfter.data!.id) === null)
check(
  '恢复后，备份之后改过的设置回退到旧值',
  getSetting('org.name') !== '备份之后才改的名字',
  getSetting('org.name')
)
check('恢复后，备份之后新增的照片文件已消失', !existsSync(join(attachDir, 'p-demo', 'photo-later.jpg')))
check('恢复后，原有照片仍在', existsSync(join(attachDir, 'p-demo', 'photo-a.jpg')) && existsSync(join(attachDir, 'p-demo', 'photo-b.jpg')))
check('恢复后照片目录里恰好 2 个文件', readdirSync(join(attachDir, 'p-demo')).length === 2)
check(
  '恢复后数据库可继续读写（连接已重新打开）',
  (() => {
    try {
      const c = svc.createProject({ task_no: 'lz-00077', name: '恢复后写入测试', client_name: '癸单位' })
      return c.ok === true && !!svc.getProject(c.data!.id)
    } catch {
      return false
    }
  })()
)
check('恢复后备份时已有的项目仍在', !!svc.getProject(statId))

// ─────────────────────────────────────────
closeDatabase()

// ─────────────────────────────────────────
section('结果')
console.log(`  通过 ${passed} 项，失败 ${failed} 项`)
console.log(`  数据库文件：${dbPath}`)

// 清理临时目录（失败时保留，便于排查）
//
// 这段必须包 try/catch：Windows 上文件句柄的释放比类 Unix 慢半拍，
// 刚 close 掉的 SQLite 库文件仍可能被占用，rmSync 会抛 EBUSY/EPERM。
// 清理失败只是留了点垃圾在临时目录，不该让整轮自检判失败。
if (failed === 0) {
  try {
    rmSync(dataDir, { recursive: true, force: true })
    console.log('  临时数据已清理')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  临时数据清理失败（不影响结果，可手动删除）：${msg}`)
  }
} else {
  console.log(`  存在失败项，临时目录保留：${dataDir}`)
}

process.exit(failed === 0 ? 0 : 1)
})().catch((err) => {
  console.error('\n自检脚本异常终止：', err)
  process.exit(1)
})
