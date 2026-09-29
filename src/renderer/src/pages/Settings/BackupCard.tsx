import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Input,
  List,
  Modal,
  Space,
  Typography
} from 'antd'
import { CloudDownloadOutlined, ExportOutlined, WarningOutlined } from '@ant-design/icons'
import type { BackupInfo } from '@shared/types'
import api from '../../api'

/**
 * 数据备份与恢复。
 *
 * 恢复是这个软件里唯一"能弄丢数据"的操作，所以确认弹窗刻意做得啰嗦：
 * 必须手动输入「恢复」两个字才能点确定，不能一路回车点过去。
 * 同时在弹窗里明确写出"恢复前的数据会自动另存一份"，让用户敢按。
 */

const CONFIRM_WORD = '恢复'

export default function BackupCard(): React.JSX.Element {
  const { message } = App.useApp()
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [picked, setPicked] = useState<{
    path: string
    fileName?: string
    createdAt?: string
    photoCount?: number
    dbBytes?: number
  } | null>(null)
  const [typed, setTyped] = useState('')

  const load = useCallback(async () => {
    setInfo(await api.backup.info())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onBackup(): Promise<void> {
    setBackingUp(true)
    try {
      const res = await api.backup.create()
      if (!res.ok) {
        if (res.message !== '已取消备份') message.warning(res.message)
        return
      }
      message.success(res.message)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBackingUp(false)
    }
  }

  /** 先选文件并读一眼内容，把"哪天备的、有多少照片"摆给用户看，再让他确认 */
  async function onPickRestore(): Promise<void> {
    try {
      const res = await api.backup.inspect()
      if (!res.ok) {
        if (res.message !== '已取消') message.warning(res.message)
        return
      }
      setTyped('')
      setPicked({
        path: res.path ?? '',
        fileName: res.fileName,
        createdAt: res.createdAt,
        photoCount: res.photoCount,
        dbBytes: res.dbBytes
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function doRestore(): Promise<void> {
    if (!picked) return
    setRestoring(true)
    try {
      const res = await api.backup.restore(picked.path)
      if (!res.ok) {
        message.error(res.message)
        return
      }
      setPicked(null)
      Modal.success({
        title: '恢复完成',
        content: (
          <div style={{ fontSize: 13 }}>
            <p style={{ marginBottom: 8 }}>{res.message}</p>
            <p style={{ marginBottom: 0 }}>
              界面即将重新加载以读取恢复后的数据。恢复前的数据仍保留在备份目录里，
              确认无误后可以自行删除。
            </p>
          </div>
        ),
        okText: '重新加载界面',
        onOk: () => window.location.reload()
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <Card
        size="small"
        title="数据备份与恢复"
        extra={
          <Space size={8}>
            <Button
              size="small"
              icon={<CloudDownloadOutlined />}
              onClick={() => void onPickRestore()}
              disabled={restoring}
            >
              从备份恢复
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<ExportOutlined />}
              loading={backingUp}
              onClick={() => void onBackup()}
            >
              立即备份
            </Button>
          </Space>
        }
      >
        <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
          <Descriptions.Item label="上次备份">
            {info?.lastBackupAt || '还没有备份过'}
          </Descriptions.Item>
          <Descriptions.Item label="上次恢复">
            {info?.lastRestoreAt || '没有恢复过'}
          </Descriptions.Item>
        </Descriptions>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          备份包（单个 .zip）里包含：
        </Typography.Text>
        <List
          size="small"
          dataSource={info?.includes ?? []}
          renderItem={(t) => <List.Item style={{ padding: '2px 0', fontSize: 13 }}>{t}</List.Item>}
        />

        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="建议每周备份一次，并把备份包放到 U 盘或另一台电脑上"
          description={
            <span style={{ fontSize: 12 }}>
              备份包放在本机同一个硬盘里，硬盘坏了照样一起没。换电脑或重装系统后，
              在新机器上安装本软件，用「从备份恢复」选中这个 zip 即可把项目和照片全部还原。
              恢复前的现有数据会自动另存一份到数据目录下的 backups 文件夹，万一恢复错了还能找回来。
            </span>
          }
        />
      </Card>

      <Modal
        title="确认恢复数据"
        open={!!picked}
        onCancel={() => setPicked(null)}
        onOk={() => void doRestore()}
        okText="确定恢复"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: typed.trim() !== CONFIRM_WORD, loading: restoring }}
        maskClosable={false}
      >
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message="恢复会覆盖当前的全部项目和照片"
          description="恢复后当前数据将被备份包里的内容整体替换。恢复前软件会自动把现有数据另存一份，仍有回退余地。"
        />
        <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="备份包">{picked?.fileName || '—'}</Descriptions.Item>
          <Descriptions.Item label="备份时间">{picked?.createdAt || '未记录'}</Descriptions.Item>
          <Descriptions.Item label="包含照片">
            {picked?.photoCount === undefined ? '未记录' : `${picked.photoCount} 张`}
          </Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph style={{ fontSize: 13, marginBottom: 8 }}>
          请手动输入 <Typography.Text code>{CONFIRM_WORD}</Typography.Text> 两个字以继续：
        </Typography.Paragraph>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={CONFIRM_WORD}
          onPressEnter={() => {
            if (typed.trim() === CONFIRM_WORD) void doRestore()
          }}
        />
      </Modal>
    </>
  )
}
