/**
 * 建表 DDL。
 *
 * 这里用 .ts 导出字符串而不是放 .sql 文件：electron-vite 打包主进程时，
 * 非 JS 资源需要额外配置拷贝，直接内联成字符串最省事、最不容易出错。
 */

export const SCHEMA_V1 = /* sql */ `
-- ─────────────────────────────────────────────
-- 项目主表
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project (
  id                  TEXT PRIMARY KEY,              -- crypto.randomUUID()，界面不显示
  task_no             TEXT NOT NULL UNIQUE,          -- 任务单号：2 个小写字母 + "-" + 5 位数字

  -- 任务信息
  name                TEXT NOT NULL,                 -- 项目名称
  client_name         TEXT NOT NULL,                 -- 委托方名称
  client_contact      TEXT,                          -- 委托方联系人
  client_phone        TEXT,                          -- 联系电话
  project_address     TEXT,                          -- 项目地址
  project_type        TEXT,                          -- 业务类型（字典 dict.project_type）
  test_category       TEXT,                          -- 检测类别（字典 dict.test_category）
  building_count      INTEGER,                       -- 栋数
  building_area       REAL,                          -- 建筑面积 m²
  floors              TEXT,                          -- 层数（允许"地上3层/地下1层"这类写法）
  struct_type         TEXT,                          -- 结构形式

  -- 人员
  source              TEXT,                          -- 任务来源（字典 dict.source）
  handler             TEXT,                          -- 负责人
  testers             TEXT,                          -- 检测人员

  -- 时间节点
  receive_date        TEXT,                          -- 接单日期
  expect_finish_date  TEXT,                          -- 委托方要求完成日期
  plan_test_date      TEXT,                          -- 约定检测日期
  actual_test_date    TEXT,                          -- 实际进场日期
  report_due_date     TEXT,                          -- 报告应出具日期（超期预警基准）
  report_issue_date   TEXT,                          -- 报告实际出具日期

  -- 阶段状态
  status              TEXT NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received','contacted','scheduled','testing',
                                          'organizing','reporting','report_issued','closed',
                                          'paused','cancelled')),
  test_status         TEXT NOT NULL DEFAULT 'none'
                        CHECK (test_status IN ('none','partial','done')),
  test_round          INTEGER NOT NULL DEFAULT 0,    -- 进场次数（支持"部分完成"多次进场）
  report_no           TEXT,                          -- 报告编号
  report_status       TEXT NOT NULL DEFAULT 'none'
                        CHECK (report_status IN ('none','drafting','issued','sent')),

  -- 备注与其他
  contact_note        TEXT,                          -- 联系委托方的记录
  test_remark         TEXT,                          -- 部分完成的原因 / 待补事项
  organize_note       TEXT,                          -- 整理记录的说明
  cancel_reason       TEXT,                          -- 取消原因
  pause_reason        TEXT,                          -- 暂缓原因
  paused_from_status  TEXT,                          -- 暂缓前的状态，用于"恢复"

  remark              TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at           TEXT                           -- 归档时间
);

CREATE INDEX IF NOT EXISTS idx_project_status      ON project(status);
CREATE INDEX IF NOT EXISTS idx_project_plan_date   ON project(plan_test_date);
CREATE INDEX IF NOT EXISTS idx_project_report_due  ON project(report_due_date);
CREATE INDEX IF NOT EXISTS idx_project_client      ON project(client_name);
CREATE INDEX IF NOT EXISTS idx_project_updated     ON project(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_receive     ON project(receive_date);

-- ─────────────────────────────────────────────
-- 操作日志 / 时间轴
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,                        -- create / status / update / remark / ...
  from_status  TEXT,
  to_status    TEXT,
  content      TEXT,                                 -- 人类可读的一句话描述
  payload      TEXT,                                 -- JSON，记录本次变更的字段明细
  operator     TEXT,                                 -- 操作人
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_log_project ON project_log(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_time    ON project_log(occurred_at DESC);

-- ─────────────────────────────────────────────
-- 字典表（业务类型 / 检测类别 / 任务来源等，用户可在设置页自己增删）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dict (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  type     TEXT NOT NULL,
  code     TEXT NOT NULL,
  label    TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  enabled  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(type, code)
);

CREATE INDEX IF NOT EXISTS idx_dict_type ON dict(type, sort);

-- ─────────────────────────────────────────────
-- 设置表
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`

/** v1 预置数据：默认设置项 + 常用字典 */
export const SEED_V1_SETTINGS: Array<[string, string]> = [
  ['org.name', ''],
  ['org.task_prefix', 'lz'],
  // 预警阈值（天）
  ['alert.test_upcoming_days', '2'],
  ['alert.report_due_warn_days', '3'],
  ['alert.stale_days', '7'],
  ['alert.receive_contact_days', '3'],
  ['alert.partial_followup_days', '5'],
  ['db.last_backup_at', '']
]

/** [type, code, label, sort] */
export const SEED_V1_DICT: Array<[string, string, string, number]> = [
  // 业务类型
  ['project_type', 'security', '房屋安全性鉴定', 10],
  ['project_type', 'reliability', '房屋可靠性鉴定', 20],
  ['project_type', 'danger', '房屋危险性（危房）鉴定', 30],
  ['project_type', 'seismic', '建筑抗震鉴定', 40],
  ['project_type', 'construction', '施工前周边房屋现状鉴定', 50],
  ['project_type', 'fire', '火灾后房屋鉴定', 60],
  ['project_type', 'other', '其他', 99],

  // 检测类别
  ['test_category', 'concrete', '混凝土结构', 10],
  ['test_category', 'masonry', '砌体结构', 20],
  ['test_category', 'steel', '钢结构', 30],
  ['test_category', 'timber', '木结构', 40],
  ['test_category', 'foundation', '地基基础', 50],
  ['test_category', 'deformation', '变形与倾斜', 60],
  ['test_category', 'crack', '裂缝与损伤', 70],
  ['test_category', 'material', '材料强度', 80],

  // 任务来源
  ['source', 'phone', '电话委托', 10],
  ['source', 'visit', '上门洽谈', 20],
  ['source', 'government', '政府部门委托', 30],
  ['source', 'cooperation', '合作单位转介', 40],
  ['source', 'court', '司法委托', 50],
  ['source', 'other', '其他', 99]
]
