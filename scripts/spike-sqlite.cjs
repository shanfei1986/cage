/**
 * 一次性验证脚本：确认当前 Electron 内置的 Node 是否支持 node:sqlite。
 * 用法：npx electron scripts/spike-sqlite.cjs
 * 这是 M1 的第一件事 —— 它决定数据库走哪条路线（见计划的 R2）。
 */
const { app } = require('electron')

app.whenReady().then(() => {
  const out = {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, num REAL, ts TEXT)')
    db.prepare('INSERT INTO t (name, num, ts) VALUES (?, ?, ?)').run('测试项目', 12.5, '2026-09-29')
    const row = db.prepare('SELECT * FROM t').get()
    db.exec("UPDATE t SET name = '改过了' WHERE id = 1")
    const after = db.prepare('SELECT * FROM t').get()
    db.close()
    console.log('SPIKE_OK ' + JSON.stringify({ ...out, row, after }))
  } catch (e) {
    console.log('SPIKE_FAIL ' + JSON.stringify({ ...out, error: String((e && e.message) || e) }))
  }
  app.quit()
})
