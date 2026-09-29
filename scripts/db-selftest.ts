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

import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDbPath, initDatabase } from '../src/main/db/connection'
import * as svc from '../src/main/services/project.service'
import { listLogs } from '../src/main/db/repositories/log.repo'
import { countByStatus, list } from '../src/main/db/repositories/project.repo'
import { normalizeTaskNo } from '../src/shared/taskNo'

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
check('迁移从 v0 升到 v1', r1.migration.from === 0 && r1.migration.to === 1, r1.migration)

// 重复初始化应当幂等（user_version 已是 1，不再重复建表）
const r2 = initDatabase(dataDir)
check('重复初始化幂等（不再重跑迁移）', r2.migration.from === 1 && r2.migration.to === 1, r2.migration)

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
check('部分完成原因已保存', svc.getProject(id)?.test_remark?.includes('搭架'), svc.getProject(id)?.test_remark)

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
check('报告已出 → 已归档', to('closed').ok)
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
closeDatabase()

// ─────────────────────────────────────────
section('结果')
console.log(`  通过 ${passed} 项，失败 ${failed} 项`)
console.log(`  数据库文件：${dbPath}`)

// 清理临时目录（失败时保留，便于排查）
if (failed === 0) {
  rmSync(dataDir, { recursive: true, force: true })
  console.log('  临时数据已清理')
} else {
  console.log(`  存在失败项，临时目录保留：${dataDir}`)
}

process.exit(failed === 0 ? 0 : 1)
