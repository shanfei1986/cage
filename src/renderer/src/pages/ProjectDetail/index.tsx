import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Steps,
  Tag,
  Timeline,
  Typography
} from 'antd'
import { ArrowLeftOutlined, DownOutlined, EditOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import type { AdvancePayload, DictItem, Project, ProjectLog, ProjectStatus } from '@shared/types'
import {
  MAIN_FLOW,
  REPORT_STATUS_LABEL,
  STAGE_PROMPT,
  STATUS_COLOR,
  STATUS_LABEL,
  TEST_STATUS_LABEL,
  nextMainStatus
} from '@shared/projectStatus'
import { normalizeTaskNo } from '@shared/taskNo'
import ProjectBaseFields, {
  formDateToText,
  type DictOptions
} from '../../components/ProjectBaseFields'
import api from '../../api'
import PhotoWall from './PhotoWall'

const DATE_FIELDS = [
  'receive_date',
  'expect_finish_date',
  'plan_test_date',
  'actual_test_date',
  'report_due_date',
  'report_issue_date'
] as const

export default function ProjectDetail(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()

  const [project, setProject] = useState<Project | null>(null)
  const [logs, setLogs] = useState<ProjectLog[]>([])
  const [allowed, setAllowed] = useState<ProjectStatus[]>([])
  const [dict, setDict] = useState<Record<string, DictItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [advanceTo, setAdvanceTo] = useState<ProjectStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [advanceForm] = Form.useForm()

  const [editOpen, setEditOpen] = useState(false)
  const [editForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await api.project.get(id)
      setProject(p)
      if (p) {
        const [l, a] = await Promise.all([api.project.logs(id), api.project.allowedTargets(id)])
        setLogs(l)
        setAllowed(a)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        setDict(await api.dict.bundle(['project_type', 'test_category', 'source']))
      } catch {
        /* 字典失败不阻断 */
      }
    })()
  }, [])

  const dictOptions = useMemo<DictOptions>(
    () => ({
      project_type: (dict.project_type ?? []).map((d) => ({ value: d.code, label: d.label })),
      test_category: (dict.test_category ?? []).map((d) => ({ value: d.code, label: d.label })),
      source: (dict.source ?? []).map((d) => ({ value: d.code, label: d.label }))
    }),
    [dict]
  )

  function label(type: keyof DictOptions, code: string | null): string {
    if (!code) return '-'
    return dictOptions[type].find((o) => o.value === code)?.label ?? code
  }

  function openAdvance(to: ProjectStatus): void {
    setAdvanceTo(to)
    advanceForm.resetFields()
    if (to === 'testing') advanceForm.setFieldsValue({ actual_test_date: dayjs() })
    if (to === 'report_issued') advanceForm.setFieldsValue({ report_issue_date: dayjs() })
    setAdvanceOpen(true)
  }

  async function submitAdvance(): Promise<void> {
    if (!project || !advanceTo) return
    let v: Record<string, unknown>
    try {
      v = await advanceForm.validateFields()
    } catch {
      return
    }

    // 只把"用户真的填了内容"的字段带上：留空不应把已有的值覆盖成 null。
    // 必填项留空时，主进程的状态机会给出对应的提示语。
    const payload: AdvancePayload = {}
    const put = <K extends keyof AdvancePayload>(k: K, v: AdvancePayload[K] | undefined): void => {
      if (v !== undefined && v !== null && v !== '') payload[k] = v
    }
    put('contact_note', (v.contact_note as string) || undefined)
    put('plan_test_date', formDateToText(v.plan_test_date) ?? undefined)
    put('actual_test_date', formDateToText(v.actual_test_date) ?? undefined)
    put('test_status', (v.test_status as AdvancePayload['test_status']) || undefined)
    put('test_remark', (v.test_remark as string) || undefined)
    put('organize_note', (v.organize_note as string) || undefined)
    put('report_no', (v.report_no as string) || undefined)
    put('report_issue_date', formDateToText(v.report_issue_date) ?? undefined)
    put('report_due_date', formDateToText(v.report_due_date) ?? undefined)
    put('pause_reason', (v.pause_reason as string) || undefined)
    put('cancel_reason', (v.cancel_reason as string) || undefined)

    setSubmitting(true)
    try {
      const res = await api.project.changeStatus(project.id, advanceTo, payload)
      if (!res.ok) {
        message.error(res.message ?? '操作失败')
        return
      }
      message.success(`已更新为「${STATUS_LABEL[advanceTo]}」`)
      setAdvanceOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitEdit(): Promise<void> {
    if (!project) return
    let v: Record<string, unknown>
    try {
      v = await editForm.validateFields()
    } catch {
      return
    }

    setSubmitting(true)
    try {
      const res = await api.project.update(project.id, {
        task_no: String(v.task_no ?? ''),
        name: String(v.name ?? ''),
        client_name: String(v.client_name ?? ''),
        client_contact: (v.client_contact as string) ?? null,
        client_phone: (v.client_phone as string) ?? null,
        project_address: (v.project_address as string) ?? null,
        project_type: (v.project_type as string) ?? null,
        test_category: (v.test_category as string) ?? null,
        source: (v.source as string) ?? null,
        handler: (v.handler as string) ?? null,
        testers: (v.testers as string) ?? null,
        building_count: (v.building_count as number) ?? null,
        building_area: (v.building_area as number) ?? null,
        floors: (v.floors as string) ?? null,
        struct_type: (v.struct_type as string) ?? null,
        receive_date: formDateToText(v.receive_date),
        expect_finish_date: formDateToText(v.expect_finish_date),
        report_due_date: formDateToText(v.report_due_date),
        remark: (v.remark as string) ?? null
      })
      if (!res.ok) {
        message.error(res.message ?? '保存失败')
        return
      }
      message.success('已保存')
      setEditOpen(false)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  function openEdit(): void {
    if (!project) return
    const init: Record<string, unknown> = { ...project }
    for (const f of DATE_FIELDS) {
      const val = project[f]
      init[f] = val ? dayjs(val) : null
    }
    editForm.setFieldsValue(init)
    setEditOpen(true)
  }

  function confirmDelete(): void {
    if (!project) return
    modal.confirm({
      title: '确认删除这个项目？',
      content: `「${project.name}」的全部操作记录会一并删除，且无法恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const res = await api.project.remove(project.id)
        if (!res.ok) {
          message.error(res.message ?? '删除失败')
          return
        }
        message.success('已删除')
        navigate('/projects')
      }
    })
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert
          type="error"
          showIcon
          message="无法打开该项目"
          description={error ?? '项目不存在或已被删除'}
        />
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
          返回项目列表
        </Button>
      </Space>
    )
  }

  const isPaused = project.status === 'paused'
  const stepIndex = MAIN_FLOW.indexOf(project.status)
  const isTerminal = project.status === 'closed' || project.status === 'cancelled'
  const next = nextMainStatus(project.status)
  const canGoNext = next !== null && allowed.includes(next)

  const menuItems = [
    ...(isPaused
      ? [{ key: 'resume', label: '恢复推进' }]
      : [
          { key: 'paused', label: '暂缓项目' },
          { key: 'cancelled', label: '取消项目', danger: true }
        ]),
    { key: 'delete', label: '删除项目', danger: true }
  ]

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
              返回
            </Button>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {project.name}
            </Typography.Title>
            <Tag color={STATUS_COLOR[project.status]}>{STATUS_LABEL[project.status]}</Tag>
            <Typography.Text type="secondary">任务单号 {project.task_no}</Typography.Text>
          </Space>

          <Space size={8} wrap>
            {canGoNext && (
              <Button
                type="primary"
                icon={<RightOutlined />}
                onClick={() => openAdvance(next as ProjectStatus)}
              >
                推进到「{STATUS_LABEL[next as ProjectStatus]}」
              </Button>
            )}
            {isTerminal && (
              <Typography.Text type="secondary">
                该项目已{project.status === 'closed' ? '归档' : '取消'}，如需继续请在下方更多操作中选择。
              </Typography.Text>
            )}
            <Button icon={<EditOutlined />} onClick={openEdit}>
              编辑基本信息
            </Button>
            <Dropdown
              menu={{
                items: menuItems,
                onClick: ({ key }) => {
                  if (key === 'delete') confirmDelete()
                  else openAdvance(key as ProjectStatus)
                }
              }}
            >
              <Button>
                更多操作 <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        </Space>
      </Card>

      <Card size="small" title="流程进度">
        {isPaused && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={`项目已暂缓${project.pause_reason ? `：${project.pause_reason}` : ''}`}
          />
        )}
        {project.status === 'cancelled' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={`项目已取消${project.cancel_reason ? `：${project.cancel_reason}` : ''}`}
          />
        )}
        <Steps
          size="small"
          current={stepIndex >= 0 ? stepIndex : MAIN_FLOW.length}
          status={project.status === 'cancelled' ? 'error' : 'process'}
          items={MAIN_FLOW.map((s) => ({ title: STATUS_LABEL[s] }))}
        />
        {project.test_status === 'partial' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message={`检测为「部分完成」，已进场 ${project.test_round} 次${
              project.test_remark ? `；待补：${project.test_remark}` : ''
            }`}
          />
        )}
      </Card>

      <Card size="small" title="项目信息">
        <Descriptions size="small" column={3} bordered>
          <Descriptions.Item label="委托方">{project.client_name}</Descriptions.Item>
          <Descriptions.Item label="联系人">{project.client_contact ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{project.client_phone ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="项目地址" span={3}>
            {project.project_address ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="业务类型">{label('project_type', project.project_type)}</Descriptions.Item>
          <Descriptions.Item label="检测类别">
            {label('test_category', project.test_category)}
          </Descriptions.Item>
          <Descriptions.Item label="任务来源">{label('source', project.source)}</Descriptions.Item>
          <Descriptions.Item label="栋数">{project.building_count ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="建筑面积">
            {project.building_area ? `${project.building_area} ㎡` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="层数">{project.floors ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="结构形式">{project.struct_type ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="负责人">{project.handler ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="检测人员">{project.testers ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="接单日期">{project.receive_date ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="要求完成">{project.expect_finish_date ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="约定检测日期">{project.plan_test_date ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="实际进场">
            {project.actual_test_date ?? '-'}
            {project.test_round > 0 ? `（第 ${project.test_round} 次）` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="检测情况">
            {(() => {
              const inProgress = project.status === 'testing' && project.test_status === 'none'
              const color =
                project.test_status === 'done'
                  ? 'green'
                  : inProgress || project.test_status === 'partial'
                    ? 'orange'
                    : 'default'
              return (
                <Tag color={color}>
                  {inProgress ? '进场中' : TEST_STATUS_LABEL[project.test_status]}
                </Tag>
              )
            })()}
          </Descriptions.Item>
          <Descriptions.Item label="报告应出">{project.report_due_date ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="报告编号">{project.report_no ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="报告状态">
            {REPORT_STATUS_LABEL[project.report_status]}
          </Descriptions.Item>
          <Descriptions.Item label="报告出具日">{project.report_issue_date ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="联系记录" span={3}>
            {project.contact_note ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="整理记录" span={3}>
            {project.organize_note ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item
            label={project.test_status === 'partial' ? '待补事项' : '检测情况说明'}
            span={3}
          >
            {project.test_remark ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>
            {project.remark ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="建档时间">{project.created_at}</Descriptions.Item>
          <Descriptions.Item label="最后更新">{project.updated_at}</Descriptions.Item>
          <Descriptions.Item label="归档时间">{project.closed_at ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <PhotoWall projectId={project.id} />

      <Card size="small" title="操作记录（时间轴）">
        {logs.length === 0 ? (
          <Empty description="暂无记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Timeline
            items={logs.map((l) => ({
              color: l.to_status ? 'blue' : 'gray',
              children: (
                <Space direction="vertical" size={2}>
                  <Space size={8} wrap>
                    <Typography.Text strong>{l.content ?? l.action}</Typography.Text>
                    {l.from_status && l.to_status && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {STATUS_LABEL[l.from_status]} → {STATUS_LABEL[l.to_status]}
                      </Typography.Text>
                    )}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {l.occurred_at}
                    {l.operator ? ` · ${l.operator}` : ''}
                  </Typography.Text>
                </Space>
              )
            }))}
          />
        )}
      </Card>

      {/* ── 推进到下一阶段 ── */}
      <Modal
        title={advanceTo ? `推进到「${STATUS_LABEL[advanceTo]}」` : '推进'}
        open={advanceOpen}
        okText="确认"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={submitAdvance}
        onCancel={() => setAdvanceOpen(false)}
        forceRender
      >
        {advanceTo && STAGE_PROMPT[advanceTo] && (
          <Alert type="info" showIcon message={STAGE_PROMPT[advanceTo]} style={{ marginBottom: 16 }} />
        )}
        {project.status === 'testing' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="本次进场检测的结果是？"
            description="若只是部分完成，项目会回到「已定检测日期」，等你下次再约进场。"
          />
        )}

        <Form form={advanceForm} layout="vertical" preserve={false}>
          {project.status === 'testing' && (
            <Form.Item label="检测结果" name="test_status" initialValue="done">
              <Radio.Group
                onChange={(e) => {
                  setAdvanceTo(e.target.value === 'partial' ? 'scheduled' : 'organizing')
                }}
                options={[
                  { value: 'done', label: '全部完成' },
                  { value: 'partial', label: '部分完成，需再次进场' }
                ]}
              />
            </Form.Item>
          )}

          {advanceTo === 'contacted' && (
            <Form.Item label="联系情况" name="contact_note">
              <Input.TextArea
                rows={3}
                placeholder="例如：电话联系张工，已发送资料清单，等他确认现场条件"
              />
            </Form.Item>
          )}

          {advanceTo === 'scheduled' && (
            <>
              {project.status === 'testing' && (
                <Form.Item
                  label="待补充的检测内容"
                  name="test_remark"
                  rules={[{ required: true, message: '请写明还需要补测什么' }]}
                >
                  <Input.TextArea rows={3} placeholder="例如：2 层以上尚未抽检，需搭架后补测" />
                </Form.Item>
              )}
              <Form.Item
                label={project.status === 'testing' ? '下次约定检测日期（选填）' : '约定检测日期'}
                name="plan_test_date"
                rules={
                  project.status === 'testing'
                    ? []
                    : [{ required: true, message: '请填写与委托方约定的检测日期' }]
                }
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="联系记录（选填）" name="contact_note">
                <Input.TextArea rows={2} placeholder="例如：已与张工确认 3 月 15 日上午进场" />
              </Form.Item>
            </>
          )}

          {advanceTo === 'testing' && (
            <Form.Item
              label="实际进场日期"
              name="actual_test_date"
              rules={[{ required: true, message: '请填写实际进场日期' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}

          {advanceTo === 'organizing' && (
            <Form.Item label="检测情况说明（选填）" name="test_remark">
              <Input.TextArea rows={3} placeholder="例如：已完成全部抽检项目，现场照片已导出" />
            </Form.Item>
          )}

          {advanceTo === 'reporting' && (
            <Form.Item label="整理记录说明（选填）" name="organize_note">
              <Input.TextArea rows={3} placeholder="例如：数据已录入，开始编制报告正文" />
            </Form.Item>
          )}

          {advanceTo === 'report_issued' && (
            <>
              <Form.Item
                label="报告编号"
                name="report_no"
                rules={[{ required: true, message: '请填写报告编号' }]}
              >
                <Input placeholder="例如：房鉴字LZ【2026】第0398号" />
              </Form.Item>
              <Form.Item
                label="报告出具日期"
                name="report_issue_date"
                rules={[{ required: true, message: '请填写报告出具日期' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}

          {(advanceTo === 'scheduled' || advanceTo === 'organizing' || advanceTo === 'reporting') && (
            <Form.Item
              label="报告应出日期（选填）"
              name="report_due_date"
              extra="填了以后，到期未出报告会被超期预警标出来"
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}

          {advanceTo === 'closed' && (
            <Typography.Text type="secondary">
              归档后项目进入终态，仍可在「更多操作」里撤销归档或删除。
            </Typography.Text>
          )}

          {advanceTo === 'paused' && (
            <Form.Item label="暂缓原因（选填）" name="pause_reason">
              <Input.TextArea rows={3} placeholder="例如：委托方要求延期，等结构加固完成后再进场" />
            </Form.Item>
          )}

          {advanceTo === 'cancelled' && (
            <Form.Item
              label="取消原因"
              name="cancel_reason"
              rules={[{ required: true, message: '请填写取消原因' }]}
            >
              <Input.TextArea rows={3} placeholder="例如：委托方已另行委托其他单位" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* ── 编辑基本信息 ── */}
      <Modal
        title="编辑项目基本信息"
        open={editOpen}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={submitEdit}
        onCancel={() => setEditOpen(false)}
        forceRender
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <ProjectBaseFields
            dictOptions={dictOptions}
            isEdit
            taskNoRules={[
              {
                validator: async (_: unknown, value: string) => {
                  const raw = String(value ?? '').trim()
                  if (!raw) throw new Error('请填写任务单号')
                  const r = await api.project.checkTaskNo(normalizeTaskNo(raw), project.id)
                  if (!r.ok) throw new Error(r.message ?? '任务单号不合法')
                }
              }
            ]}
          />
        </Form>
      </Modal>
    </Space>
  )
}
