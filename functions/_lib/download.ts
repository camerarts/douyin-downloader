import type { Env } from './types'
import { isAllowedCdn, json, safeFilename } from './lib'

const MAX_BYTES = 500 * 1024 * 1024

export async function handleDownload(request: Request, _env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const u = new URL(request.url)
  const source = u.searchParams.get('source') ?? ''
  const filename = safeFilename(u.searchParams.get('filename') ?? 'douyin-media')
  const inline = u.searchParams.get('inline') === '1'

  if (!source) return json({ error: '缺少资源地址', error_kind: 'invalid_input' }, 400)

  let target: URL
  try {
    target = new URL(source)
  } catch {
    return json({ error: '资源地址无效', error_kind: 'invalid_input' }, 400)
  }

  if (!['https:', 'http:'].includes(target.protocol) || !isAllowedCdn(target.hostname)) {
    return json({ error: '不允许的资源域名', error_kind: 'forbidden_host' }, 400)
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        Referer: 'https://www.douyin.com/',
      },
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    return json({ error: '资源获取失败', error_kind: 'network' }, 502)
  }

  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: `资源返回 HTTP ${upstream.status}`, error_kind: 'upstream_error' }, 502)
  }

  const length = Number(upstream.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(length) && length > MAX_BYTES) {
    return json({ error: '文件过大，无法代理', error_kind: 'too_large' }, 413)
  }

  const contentType = upstream.headers.get('Content-Type') ?? 'application/octet-stream'
  const ext = contentType.includes('video') ? 'mp4' : contentType.includes('image') ? 'jpg' : contentType.includes('audio') ? 'mp3' : 'bin'
  const finalName = /\.(mp4|jpg|jpeg|png|webp|mp3|m4a|zip)$/i.test(filename) ? filename : `${filename}.${ext}`

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  // inline=1 用于 <img> 预览：不加 attachment，否则浏览器会当作下载导致图片不显示
  if (!inline) {
    headers.set('Content-Disposition', `attachment; filename="${safeFilename(finalName)}"; filename*=UTF-8''${encodeURIComponent(finalName)}`)
  }
  headers.set('Cache-Control', inline ? 'public, max-age=300' : 'no-store')
  const range = upstream.headers.get('Content-Range')
  if (range) headers.set('Content-Range', range)
  if (upstream.headers.get('Accept-Ranges')) headers.set('Accept-Ranges', upstream.headers.get('Accept-Ranges')!)

  return new Response(upstream.body, { status: upstream.status, headers })
}
