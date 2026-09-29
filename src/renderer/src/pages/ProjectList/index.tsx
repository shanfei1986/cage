import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import type { AlertLevel, DictItem, Project, ProjectCreateInput, ProjectStatus } from '@shared/types'
import {
  REPORT_STATUS_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TEST_STATUS_LABEL
} from '@shared/projectStatus'
import { ALERT_LEVEL_LABEL, type ProjectAlert } from '@shared/alerts'
import { normalizeTaskNo } from '@shared/taskNo'
import ProjectBaseFields, { type DictOptions } from '../../components/ProjectBaseFields'
import { AlertHitsTags } from '../../components/AlertTag'
import api from '../../api'

const PAGE_SIZE = 20

type DictBundle = Record<string, DictItem[]>

type TodoFilter = AlertLevel | 'all'

export default function ProjectList(): React.JSX.Element {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  const [rows, setRows] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dict, setDict] = useState<DictBundle>({})
  const [clients, setClients] = useState<string[]>([])

  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<ProjectStatus | 'all'>(
    (searchParams.get('status') as ProjectStatus) || 'all'
  )
  const [client, setClient] = useState<string | undefined>(undefined)
  const [todo, setTodo] = useState<TodoFilter>('all')
  /** 待办索引：一次取全量待办，列表里按 project_id 查，避免每行一次 IPC */
  const [alertMap, setAlertMap] = useState<Map<string, ProjectAlert>>(new Map())

  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [prefixWarning, setPrefixWarning] = useState<string | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(
    async (targetPage = page) => {
      setLoading(true)
      setError(null)
      try {
        // 待办清单和列表是两件事，但一起取能少一轮往返，而且数量很小
        const [res, alerts] = await Promise.all([
          api.project.list({
            keyword,
            status,
            client_name: client,
            todo,
            page: targetPage,
            pageSize: PAGE_SIZE
          }),
          api.alert.list()
        ])
        setRows(res.rows)
        setTotal(res.total)
        setAlertMap(new Map(alerts.map((a) => [a.project_id, a])))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [keyword, status, client, todo, page]
  )

  useEffect(() => {
    void load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, client, todo])

  useEffect(() => {
    void (async () => {
      try {
        const [d, c] = await Promise.all([
          api.dict.bundle(['project_type', 'test_category', 'source']),
          api.project.clients()
        ])
        setDict(d)
        setClients(c)
      } catch {
        /* 字典加载失败不阻断主流程 */
      }
    })()
  }, [])

  // 从仪表盘点卡片进来时，把 URL 上的 status 同步到筛选条件
  useEffect(() => {
    const s = searchParams.get('status')
    if (s && s !== status) setStatus(s as ProjectStatus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const dictOptions = useMemo<DictOptions>(
    () => ({
      project_type: (dict.project_type ?? []).map((d) => ({ value: d.code, label: d.label })),
      test_category: (dict.test_category ?? []).map((d) => ({ value: d.code, label: d.label })),
      source: (dict.source ?? []).map((d) => ({ value: d.code, label: d.label }))
    }),
    [dict]
  )

  function onSearch(): void {
    setPage(1)
    void load(1)
  }

  /**
   * 导出台账：导出的是"当前筛选条件下的全部匹配项目"，不是当前这一页 ——
   * 否则用户筛完看到 200 条、导出只拿到 20 条，会以为筛选没生效。
   */
  async function onExport(): Promise<void> {
    setExporting(true)
    try {
      const res = await api.project.exportExcel({ keyword, status, client_name: client, todo })
      if (!res.ok) {
        if (res.message !== '已取消导出') message.warning(res.message)
        return
      }
      message.success(res.message)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  function onReset(): void {
    setKeyword('')
    setStatus('all')
    setClient(undefined)
    setTodo('all')
    setPage(1)
    setSearchParams({})
    setTimeout(() => void load(1), 0)
  }

  async function handleCreate(): Promise<void> {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const payload: ProjectCreateInput = {
      task_no: String(values.task_no ?? ''),
      name: String(values.name ?? ''),
      client_name: String(values.client_name ?? ''),
      client_contact: (values.client_contact as string) ?? null,
      client_phone: (values.client_phone as string) ?? null,
      project_address: (values.project_address as string) ?? null,
      project_type: (values.project_type as string) ?? null,
      test_category: (values.test_category as string) ?? null,
      source: (values.source as string) ?? null,
      handler: (values.handler as string) ?? null,
      testers: (values.testers as string) ?? null,
      building_count: (values.building_count as number) ?? null,
      building_area: (values.building_area as number) ?? null,
      floors: (values.floors as string) ?? null,
      struct_type: (values.struct_type as string) ?? null,
      receive_date: values.receive_date ? dayjs(values.receive_date as dayjs.Dayjs).format('YYYY-MM-DD') : null,
      expect_finish_date: values.expect_finish_date
        ? dayjs(values.expect_finish_date as dayjs.Dayjs).format('YYYY-MM-DD')
        : null,
      remark: (values.remark as string) ?? null
    }

    setSubmitting(true)
    try {
      const res = await api.project.create(payload)
      if (!res.ok) {
        message.error(res.message ?? '新建失败')
        return
      }
      message.success(`已新建项目「${res.data?.name}」，任务单号 ${res.data?.task_no}`)
      setModalOpen(false)
      form.resetFields()
      setPrefixWarning(null)
      setPage(1)
      await load(1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string, name: string): Promise<void> {
    try {
      const res = await api.project.remove(id)
      if (!res.ok) {
        message.error(res.message ?? '删除失败')
        return
      }
      message.success(`已删除「${name}」`)
      await load(page)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  const columns: ColumnsType<Project> = [
    {
      title: '任务单号',
      dataIndex: 'task_no',
      width: 100,
      fixed: 'left',
      render: (v: string, r) => (
        // 最后更新时间放在悬浮提示里：列出来会挤掉"操作"列，得不偿失
        <Tooltip title={`最后更新：${r.updated_at}`}>
          <a onClick={() => navigate(`/projects/${r.id}`)}>{v}</a>
        </Tooltip>
      )
    },
    {
      title: '项目名称',
      dataIndex: 'name',
      width: 190,
      // 这一列不用 ellipsis：待办原因要换行显示在名称下方
      render: (v: string, r) => {
        const alert = alertMap.get(r.id)
        return (
          <div>
            <Tooltip title={v}>
              <div
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {v}
              </div>
            </Tooltip>
            {alert && <AlertHitsTags hits={alert.hits} max={1} size="small" />}
          </div>
        )
      }
    },
    { title: '委托方', dataIndex: 'client_name', width: 160, ellipsis: true },
    {
      title: '当前阶段',
      dataIndex: 'status',
      width: 106,
      className: 'nowrap',
      render: (s: ProjectStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>
    },
    {
      title: '检测',
      dataIndex: 'test_status',
      width: 110,
      className: 'nowrap',
      // 项目处于"检测中"但结果还没登记时，显示"进场中"比"未开始"更贴合实际
      render: (v: keyof typeof TEST_STATUS_LABEL, r) => {
        const inProgress = r.status === 'testing' && v === 'none'
        const label = inProgress ? '进场中' : TEST_STATUS_LABEL[v]
        const color = v === 'done' ? 'green' : inProgress || v === 'partial' ? 'orange' : 'default'
        return (
          <Space size={4}>
            <Tag color={color}>{label}</Tag>
            {r.test_round > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                第{r.test_round}次
              </Typography.Text>
            )}
          </Space>
        )
      }
    },
    {
      title: '约定检测日期',
      dataIndex: 'plan_test_date',
      width: 108,
      className: 'nowrap',
      render: (v: string | null) => v ?? '-'
    },
    {
      title: '报告应出',
      dataIndex: 'report_due_date',
      width: 96,
      className: 'nowrap',
      render: (v: string | null) => v ?? '-'
    },
    {
      title: '报告',
      dataIndex: 'report_status',
      width: 92,
      className: 'nowrap',
      // 报告编号太长会撑爆表格，这里只显示状态，编号在详情页看
      render: (v: keyof typeof REPORT_STATUS_LABEL, r) =>
        r.report_no ? (
          <Tooltip title={`报告编号 ${r.report_no}`}>
            <Tag color="green">{REPORT_STATUS_LABEL[v]}</Tag>
          </Tooltip>
        ) : (
          <Tag color={v === 'drafting' ? 'orange' : 'default'}>{REPORT_STATUS_LABEL[v]}</Tag>
        )
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      className: 'nowrap',
      render: (_, r) => (
        <Space size={4}>
          <a onClick={() => navigate(`/projects/${r.id}`)}>详情</a>
          <Popconfirm
            title="确认删除这个项目？"
            description="该项目的全部操作记录也会一并删除，且无法恢复。"
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(r.id, r.name)}
          >
            <a style={{ color: '#ff4d4f' }}>
              <DeleteOutlined />
            </a>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message="读取项目列表失败" description={error} />}

      <Card size="small">
        <div className="filter-bar">
          <Input
            allowClear
            style={{ width: 240 }}
            placeholder="搜索任务单号 / 项目名称 / 委托方"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={onSearch}
          />
          <Select
            style={{ width: 160 }}
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: '全部阶段' },
              ...(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => ({
                value: s,
                label: STATUS_LABEL[s]
              }))
            ]}
          />
          <Select
            style={{ width: 140 }}
            value={todo}
            onChange={(v) => {
              setTodo(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: '全部项目' },
              { value: 'overdue', label: `只看${ALERT_LEVEL_LABEL.overdue}` },
              { value: 'today', label: `只看${ALERT_LEVEL_LABEL.today}` },
              { value: 'soon', label: `只看${ALERT_LEVEL_LABEL.soon}` }
            ]}
          />
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder="委托方"
            value={client}
            onChange={(v) => {
              setClient(v)
              setPage(1)
            }}
            options={clients.map((c) => ({ value: c, label: c }))}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={onReset}>
            重置
          </Button>
          <div style={{ flex: 1 }} />
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void onExport()}>
            导出台账
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setPrefixWarning(null)
              form.resetFields()
              form.setFieldsValue({ receive_date: dayjs() })
              setModalOpen(true)
            }}
          >
            新建项目
          </Button>
        </div>

        <Table<Project>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1046 }}
          // 待办行整行打标：左侧色条 + 浅底色。比插一列"待办"更省横向空间，
          // 也不会破坏表格布局
          rowClassName={(r) => {
            const a = alertMap.get(r.id)
            return a ? `row-alert-${a.level}` : ''
          }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 个项目`,
            onChange: (p) => setPage(p)
          }}
        />
      </Card>

      <Modal
        title="新建项目"
        open={modalOpen}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        forceRender
      >
        {prefixWarning && (
          <Alert
            type="warning"
            showIcon
            message={prefixWarning}
            style={{ marginBottom: 12 }}
            closable
            onClose={() => setPrefixWarning(null)}
          />
        )}
        <Form form={form} layout="vertical" preserve={false}>
          <ProjectBaseFields
            dictOptions={dictOptions}
            taskNoRules={[
              {
                validator: async (_: unknown, value: string) => {
                  const raw = String(value ?? '').trim()
                  if (!raw) throw new Error('请填写任务单号')
                  const r = await api.project.checkTaskNo(normalizeTaskNo(raw))
                  if (!r.ok) throw new Error(r.message ?? '任务单号不合法')
                  setPrefixWarning(r.warnings?.length ? r.warnings[0] : null)
                }
              }
            ]}
          />
        </Form>
      </Modal>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        提示：新建后进入项目详情页，点「推进到下一阶段」依次完成联系委托方、确定检测日期、进场检测等环节，
        每一步都会自动留下记录。
      </Typography.Text>
    </Space>
  )
}
