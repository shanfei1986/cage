import AdmZip from 'adm-zip'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { nowLocal } from '@shared/datetime'
import { closeDatabase, getDb, getDbPath, initDatabase } from '../db/connection'

/**
 * 数据备份与恢复。
 *
 * 为什么整包做成一个 zip 而不是"导出数据库文件 + 让用户自己拷照片"：
 * 照片在 userData/attachments 下，跟 .db 是两个地方，分头备份迟早会漏一边，
 * 最后就是数据恢复了、照片全丢。打成一个包，用户只需记住一个文件。
 *
 * 快照怎么做：用 SQLite 的 `VACUUM INTO`，而不是直接拷贝 fwjc.db。
 * 库开着 WAL 时最新写入可能还躺在 -wal 里，单拷主库会丢最近的数据；
 * VACUUM INTO 由 SQLite 自己保证产出一个事务一致、已合并 WAL 的完整库。
 *
 * ⚠️ 恢复是这里唯一会删文件的动作，所以顺序被刻意排成：
 *   解压到暂存 → 校验确实是 SQLite 库 → 给现状存一份"后悔药"
 *   → 最后才关库、删旧文件、换新的。
 * 任何一步失败都能原地退回，不会出现"库删了、新的没换上"的空窗。
 */

/** 备份包内的固定路径 */
const ZIP_DB_ENTRY = 'data/fwjc.db'
const ZIP_MANIFEST_ENTRY = 'manifest.json'
const ZIP_ATTACH_DIR = 'attachments'
const SQLITE_MAGIC = 'SQLite format 3\u0000'

let dataDirPath = ''
let attachmentsDirPath = ''

/** 在 app.whenReady() 内、数据库初始化之后调用一次 */
export function initBackup(databaseFilePath: string, attachmentsDir: string): void {
  dataDirPath = dirname(databaseFilePath)
  attachmentsDirPath = attachmentsDir
}

function requireInit(): { dataDir: string; attachDir: string } {
  if (!dataDirPath) throw new Error('备份服务尚未初始化')
  return { dataDir: dataDirPath, attachDir: attachmentsDirPath }
}

/** 递归统计目录下的文件数与总字节数 */
function walkFiles(dir: string): { count: number; bytes: number } {
  let count = 0
  let bytes = 0
  if (!existsSync(dir)) return { count, bytes }
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    for (const name of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, name.name)
      if (name.isDirectory()) stack.push(p)
      else if (name.isFile()) {
        count++
        try {
          bytes += statSync(p).size
        } catch {
          /* 单个文件统计不到就跳过，不因为一个坏文件让整次备份失败 */
        }
      }
    }
  }
  return { count, bytes }
}

/** 用户能看懂的"这个包里有什么"，直接展示在设置页 */
export function backupIncludes(): string[] {
  return [
    '全部项目数据（任务信息、阶段、报告编号、操作记录）',
    '字典与设置（业务类型、提醒阈值、单位名称）',
    '现场照片原图',
    '备份清单（生成时间与版本，便于核对）'
  ]
}

export interface BackupResult {
  path: string
  bytes: number
  dbBytes: number
  photoCount: number
}

/**
 * 生成备份包。target 由调用方决定（界面上是系统保存框选的路径）。
 */
export function createBackup(target: string): BackupResult {
  const { dataDir, attachDir } = requireInit()
  const liveDb = getDbPath()
  if (!liveDb || !existsSync(liveDb)) throw new Error('数据库文件不存在，无法备份')

  const staging = mkdtempSync(join(tmpdir(), 'fwjc-bak-'))
  const snapDb = join(staging, 'fwjc.db')

  try {
    // 参数绑定写目标路径，避免路径里有单引号时拼出坏 SQL。
    // VACUUM INTO 要求目标文件不存在 —— 暂存目录每次都是新的，天然满足。
    getDb().run('VACUUM INTO ?', snapDb)

    const photoStat = walkFiles(attachDir)
    const zip = new AdmZip()
    zip.addLocalFile(snapDb, 'data')
    // 保留 attachments/<project_id>/<uuid>.<ext> 的层级，恢复时直接铺回去
    if (photoStat.count > 0) zip.addLocalFolder(attachDir, ZIP_ATTACH_DIR)

    const dbBytes = statSync(snapDb).size
    zip.addFile(
      ZIP_MANIFEST_ENTRY,
      Buffer.from(
        JSON.stringify(
          {
            app: '检测项目管理系统',
            format: 1,
            createdAt: nowLocal(),
            dbFile: ZIP_DB_ENTRY,
            dbBytes,
            photoCount: photoStat.count,
            photoBytes: photoStat.bytes,
            sourceDataDir: dataDir
          },
          null,
          2
        ),
        'utf8'
      )
    )

    mkdirSync(dirname(target), { recursive: true })
    zip.writeZip(target)

    return { path: target, bytes: statSync(target).size, dbBytes, photoCount: photoStat.count }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export interface BackupInspection {
  ok: boolean
  message: string
  createdAt?: string
  photoCount?: number
  dbBytes?: number
}

/** 只读地看一眼这个 zip 是不是本软件的备份包 */
export function inspectBackup(zipPath: string): BackupInspection {
  try {
    if (!existsSync(zipPath)) return { ok: false, message: '文件不存在' }
    const zip = new AdmZip(zipPath)
    const dbEntry = zip.getEntry(ZIP_DB_ENTRY)
    if (!dbEntry) return { ok: false, message: '这不是本软件导出的备份包（缺少数据文件）' }

    let createdAt: string | undefined
    let photoCount: number | undefined
    const mfEntry = zip.getEntry(ZIP_MANIFEST_ENTRY)
    if (mfEntry) {
      try {
        const mf = JSON.parse(zip.readAsText(mfEntry)) as {
          createdAt?: string
          photoCount?: number
        }
        createdAt = mf.createdAt
        photoCount = mf.photoCount
      } catch {
        /* 清单坏了不影响恢复，只是少点提示信息 */
      }
    }
    return { ok: true, message: '备份包可读', createdAt, photoCount, dbBytes: dbEntry.header.size }
  } catch (err) {
    return {
      ok: false,
      message: `无法读取备份包：${err instanceof Error ? err.message : String(err)}`
    }
  }
}

export interface RestoreResult {
  photoCount: number
  dbBytes: number
  /** 恢复前自动存的那份"后悔药"路径 */
  safetyBackup: string
}

/**
 * 从备份包恢复。
 *
 * safetyDir：恢复前把当前数据整体备份到这里，这是本次操作唯一可回退的凭据，
 * 所以它失败就直接中止，绝不带着"没后悔药"的状态继续删数据。
 *
 * 刻意不碰 setting 表：函数中段数据库处于关闭状态，任何走仓储层的读写都会抛异常。
 * 写 db.last_restore_at 由调用方在成功返回之后做。
 */
export function restoreBackup(zipPath: string, safetyDir: string): RestoreResult {
  const { dataDir, attachDir } = requireInit()
  const liveDb = getDbPath()
  if (!liveDb) throw new Error('数据库尚未初始化，无法恢复')

  const inspected = inspectBackup(zipPath)
  if (!inspected.ok) throw new Error(inspected.message)

  const staging = mkdtempSync(join(tmpdir(), 'fwjc-rst-'))
  const oldAttachBackup = `${attachDir}.__old__`

  try {
    // 1) 先全部解压到暂存区，此时还没动任何现有数据
    new AdmZip(zipPath).extractAllTo(staging, true)

    const stagedDb = join(staging, 'data', 'fwjc.db')
    if (!existsSync(stagedDb)) throw new Error('备份包里没有数据文件')

    // 2) 校验它确实是 SQLite 库，别把随便一个 zip 覆盖上去
    const head = readFileSync(stagedDb).subarray(0, SQLITE_MAGIC.length).toString('binary')
    if (head !== SQLITE_MAGIC) throw new Error('备份包里的数据文件不是有效的 SQLite 数据库')

    const newPhotoStat = walkFiles(join(staging, ZIP_ATTACH_DIR))

    // 3) 给"现在"存一份后悔药；存不下就不许动数据
    mkdirSync(safetyDir, { recursive: true })
    const stamp = nowLocal().replace(/[-: ]/g, '')
    const safetyBackup = join(safetyDir, `恢复前自动备份-${stamp}.zip`)
    try {
      createBackup(safetyBackup)
    } catch (err) {
      throw new Error(
        `恢复前自动备份失败，已中止恢复（现有数据未改动）：${err instanceof Error ? err.message : String(err)}`
      )
    }

    // 4) 从这里开始才真正动现有数据
    closeDatabase()

    // 必须连 -wal / -shm 一起删：留着旧的 WAL 去配新库，SQLite 会直接报 malformed
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${liveDb}${suffix}`, { force: true })
    copyFileSync(stagedDb, liveDb)

    // 5) 照片目录整体换新：先把老目录改名挪开，出问题还能挪回来
    rmSync(oldAttachBackup, { recursive: true, force: true })
    const hadOldAttach = existsSync(attachDir)
    if (hadOldAttach) renameSync(attachDir, oldAttachBackup)

    try {
      mkdirSync(attachDir, { recursive: true })
      const stagedAttach = join(staging, ZIP_ATTACH_DIR)
      if (existsSync(stagedAttach)) {
        for (const name of readdirSync(stagedAttach)) {
          renameSync(join(stagedAttach, name), join(attachDir, name))
        }
      }
    } catch (err) {
      rmSync(attachDir, { recursive: true, force: true })
      if (hadOldAttach) renameSync(oldAttachBackup, attachDir)
      throw new Error(
        `现场照片恢复失败，已回退原有的照片目录：${err instanceof Error ? err.message : String(err)}`
      )
    }
    rmSync(oldAttachBackup, { recursive: true, force: true })

    // 6) 重新打开（会自动跑迁移，老版本的备份也能升到当前表结构）
    initDatabase(dataDir)

    return { photoCount: newPhotoStat.count, dbBytes: statSync(liveDb).size, safetyBackup }
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(oldAttachBackup, { recursive: true, force: true })
  }
}

/** 默认备份文件名：检测项目数据备份-20261020-1530.zip */
export function defaultBackupFileName(): string {
  const t = nowLocal().replace(/[-: ]/g, '')
  return `检测项目数据备份-${t.slice(0, 8)}-${t.slice(8, 12)}.zip`
}
