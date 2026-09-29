import { net, protocol } from 'electron'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IMAGE_EXTENSIONS, MEDIA_HOST, MEDIA_SCHEME } from '@shared/attachment'

/**
 * 现场照片的私有协议。
 *
 * 为什么不用 file://：
 * 1. 渲染层 CSP 是 `img-src 'self' data: blob:`，`'self'` 并不覆盖 file:；
 * 2. 开发态页面加载自 http://localhost，引用 file:// 会被 webSecurity 拦掉；
 * 3. 最关键的是安全：把注册过的目录之外的任何路径都挡在门外，渲染层即使被注入脚本
 *    也读不到磁盘上别的文件。
 *
 * 实现上用 protocol.handle（Electron 现行 API；registerFileProtocol 已废弃）。
 * 路径校验做了三层：段数 → UUID/文件名正则 → 规范化后仍在上游目录之内。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILE_NAME_RE = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${IMAGE_EXTENSIONS.join('|')})$`
)

/**
 * 必须在 app ready 之前调用，且只能调用一次 —— 官方明确要求。
 * 所以放在主进程模块顶层，不要挪进 whenReady。
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true, // 不设的话 URL 不能被正确解析
        secure: true, // 视为可信来源，避免被当成不安全内容
        supportFetchAPI: true,
        stream: true
        // 故意不开 bypassCSP：宁可显式在 CSP 里列出 fwjc-media:，也不要开这个后门
      }
    }
  ])
}

/**
 * 在 app.whenReady() 内调用，把 attachmentsRoot 目录暴露成
 * `fwjc-media://media/<project_id>/<uuid>.<ext>`。
 */
export function registerMediaProtocol(attachmentsRoot: string): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return new Response('bad url', { status: 400 })
    }

    if (url.host !== MEDIA_HOST) return new Response('bad host', { status: 400 })

    // 只接受两段：<project_id>/<file_name>
    const segments = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/')
    if (segments.length !== 2) return new Response('bad path', { status: 400 })

    const [projectId, fileName] = segments
    if (!UUID_RE.test(projectId) || !FILE_NAME_RE.test(fileName)) {
      return new Response('bad name', { status: 400 })
    }

    // 规范化后再确认结果仍在上游目录内（挡住 ../ 之类的手法）
    const abs = resolve(attachmentsRoot, projectId, fileName)
    const rel = relative(attachmentsRoot, abs)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      return new Response('forbidden', { status: 403 })
    }

    return net.fetch(pathToFileURL(abs).toString())
  })
}
