import { DatePicker, Form, Input, InputNumber, Select, Space } from 'antd'
import dayjs from 'dayjs'

export interface DictOption {
  value: string
  label: string
}

export interface DictOptions {
  project_type: DictOption[]
  test_category: DictOption[]
  source: DictOption[]
}

/**
 * 项目基本信息表单字段（新建与编辑共用）。
 * 只放 Form.Item，本身不包 Form —— 必须在调用方的 <Form> 里渲染。
 */
export default function ProjectBaseFields({
  dictOptions,
  isEdit = false,
  taskNoRules
}: {
  dictOptions: DictOptions
  isEdit?: boolean
  /** 由调用方注入任务单号的校验规则（新建时校验重号，编辑时排除自己） */
  taskNoRules?: React.ComponentProps<typeof Form.Item>['rules']
}): React.JSX.Element {
  return (
    <>
      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item
          label="任务单号"
          name="task_no"
          style={{ width: 220 }}
          validateTrigger="onBlur"
          normalize={(v: string) => String(v ?? '').toLowerCase()}
          rules={taskNoRules}
          extra="2 个小写字母 + 5 位数字，例如 lz-00007"
        >
          <Input placeholder="lz-00007" maxLength={8} />
        </Form.Item>

        <Form.Item
          label="项目名称"
          name="name"
          style={{ flex: 1 }}
          rules={[{ required: true, message: '请填写项目名称' }]}
        >
          <Input placeholder="例如：XX 小区 3 号楼房屋安全鉴定" />
        </Form.Item>
      </Space>

      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item
          label="委托方"
          name="client_name"
          style={{ flex: 1 }}
          rules={[{ required: true, message: '请填写委托方名称' }]}
        >
          <Input placeholder="例如：XX 置业有限公司" />
        </Form.Item>
        <Form.Item label="联系人" name="client_contact" style={{ width: 160 }}>
          <Input placeholder="张工" />
        </Form.Item>
        <Form.Item
          label="联系电话"
          name="client_phone"
          style={{ width: 180 }}
          rules={[{ pattern: /^[0-9\-+ ]*$/, message: '只能填数字、空格和连字符' }]}
        >
          <Input placeholder="13800000000" />
        </Form.Item>
      </Space>

      <Form.Item label="项目地址" name="project_address">
        <Input placeholder="XX 市 XX 区 XX 路 X 号" />
      </Form.Item>

      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item label="业务类型" name="project_type" style={{ width: 200 }}>
          <Select allowClear placeholder="请选择" options={dictOptions.project_type} />
        </Form.Item>
        <Form.Item label="检测类别" name="test_category" style={{ width: 180 }}>
          <Select allowClear placeholder="请选择" options={dictOptions.test_category} />
        </Form.Item>
        <Form.Item label="任务来源" name="source" style={{ width: 160 }}>
          <Select allowClear placeholder="请选择" options={dictOptions.source} />
        </Form.Item>
      </Space>

      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item label="栋数" name="building_count" style={{ width: 110 }}>
          <InputNumber min={0} style={{ width: '100%' }} placeholder="3" />
        </Form.Item>
        <Form.Item label="建筑面积（㎡）" name="building_area" style={{ width: 160 }}>
          <InputNumber min={0} style={{ width: '100%' }} placeholder="3200" />
        </Form.Item>
        <Form.Item label="层数" name="floors" style={{ width: 160 }}>
          <Input placeholder="地上6层/地下1层" />
        </Form.Item>
        <Form.Item label="结构形式" name="struct_type" style={{ width: 160 }}>
          <Input placeholder="框架结构" />
        </Form.Item>
      </Space>

      <Space size={12} style={{ display: 'flex' }} align="start">
        <Form.Item label="接单日期" name="receive_date" style={{ width: 170 }}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="要求完成日期"
          name="expect_finish_date"
          style={{ width: 170 }}
          extra="委托方要求的截止日期"
        >
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="负责人" name="handler" style={{ width: 160 }}>
          <Input placeholder="单飞" />
        </Form.Item>
        {isEdit && (
          <Form.Item
            label="报告应出日期"
            name="report_due_date"
            style={{ width: 170 }}
            extra="超期提醒的基准日期"
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        )}
      </Space>

      <Form.Item label="备注" name="remark" style={{ marginBottom: 0 }}>
        <Input.TextArea rows={2} placeholder="其他需要说明的情况" />
      </Form.Item>
    </>
  )
}

/** 把表单里的值转成入库用的日期字符串 */
export function formDateToText(v: unknown): string | null {
  if (!v) return null
  return dayjs(v as dayjs.Dayjs).format('YYYY-MM-DD')
}
