import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Space,
  Typography
} from 'antd'
import type { AppInfo } from '@shared/api'
import api from '../../api'
import BackupCard from './BackupCard'

const ALERT_FIELDS: Array<{ key: string; label: string; hint: string; def: number }> = [
  { key: 'alert.receive_contact_days', label: '接单后未联系委托方提醒（天）', hint: '超过这个天数还没联系客户，列入待办', def: 3 },
  { key: 'alert.test_upcoming_days', label: '进场日期临近提醒（天）', hint: '约定检测日期前多少天开始提醒', def: 2 },
  { key: 'alert.report_due_warn_days', label: '报告到期预警（天）', hint: '报告应出日期前多少天开始预警', def: 3 },
  { key: 'alert.stale_days', label: '项目停滞提醒（天）', hint: '多少天没有任何进展就算停滞', def: 7 },
  { key: 'alert.partial_followup_days', label: '部分完成待跟进（天）', hint: '部分完成后多少天没再进场就提醒', def: 5 }
]

export default function Settings(): React.JSX.Element {
  const { message } = App.useApp()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    const [i, s] = await Promise.all([api.app.info(), api.setting.getAll()])
    setInfo(i)
    form.setFieldsValue({
      'org.name': s['org.name'] ?? '',
      'org.task_prefix': s['org.task_prefix'] ?? 'lz',
      ...Object.fromEntries(
        ALERT_FIELDS.map((f) => [f.key, Number(s[f.key] ?? f.def)])
      )
    })
  }, [form])

  useEffect(() => {
    void load()
  }, [load])

  async function save(): Promise<void> {
    const v = await form.validateFields()
    setSaving(true)
    try {
      for (const [k, val] of Object.entries(v)) {
        await api.setting.set(k, String(val ?? ''))
      }
      message.success('已保存')
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card title="基本信息" size="small" loading={!info}>
        <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
          <Form.Item label="单位名称" name="org.name" extra="会用在导出的报表表头">
            <Input placeholder="例如：广东 XX 鉴定与加固工程有限公司" />
          </Form.Item>
          <Form.Item
            label="任务单号统一前缀"
            name="org.task_prefix"
            extra="2 个小写字母。任务单号前缀与它不一致时只提醒、不拦截"
            rules={[{ pattern: /^[a-z]{2}$/, message: '必须是 2 个小写字母' }]}
          >
            <Input placeholder="lz" maxLength={2} />
          </Form.Item>
        </Form>
      </Card>

      <Card title="提醒阈值" size="small">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="这些阈值保存后立即生效，「工作台 · 今日待办」和项目列表的行标记都会按新阈值重新计算。"
        />
        <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
          {ALERT_FIELDS.map((f) => (
            <Form.Item key={f.key} label={f.label} name={f.key} extra={f.hint}>
              <InputNumber min={1} max={90} style={{ width: 160 }} addonAfter="天" />
            </Form.Item>
          ))}
        </Form>
      </Card>

      <Card size="small">
        <Button type="primary" loading={saving} onClick={save}>
          保存设置
        </Button>
      </Card>

      <BackupCard />

      <Card title="运行环境（排查问题用）" size="small">
        {info && (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="软件版本">
              {info.name} v{info.version}（{info.isPackaged ? '正式安装版' : '开发调试版'}）
            </Descriptions.Item>
            <Descriptions.Item label="Electron">{info.electron}</Descriptions.Item>
            <Descriptions.Item label="内置 Node">{info.node}</Descriptions.Item>
            <Descriptions.Item label="数据库引擎">
              {info.sqliteAvailable ? 'Node 内置 SQLite（可正常使用）' : '不可用 —— 请反馈此问题'}
            </Descriptions.Item>
            <Descriptions.Item label="数据文件">{info.dbPath}</Descriptions.Item>
            <Descriptions.Item label="数据目录">{info.userData}</Descriptions.Item>
            <Descriptions.Item label="照片目录">
              {info.userData ? `${info.userData}/attachments` : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          数据完全存在本机，不联网、不上传。请勿把数据目录放进 OneDrive 等网盘同步文件夹，
          以免数据库文件被同步过程改坏。需要搬到别的电脑时，用上面的「立即备份」导出 zip 再恢复即可。
        </Typography.Text>
      </Card>
    </Space>
  )
}
