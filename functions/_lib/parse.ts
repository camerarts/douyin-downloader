import type { Env, NormalizedMedia, ParseSuccess } from './types'
import { extractDouyinUrl, json } from './lib'

const DOUPARSE_ENDPOINT = 'https://www.qimiaowan.com/api/v1/parse'
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 25_000

interface DouParseData {
  platform?: string
  aweme_type?: string
  desc?: string
  cover?: string
  author?: string
  play_url?: string
  images?: string[]
  qualities?: { url?: string; name?: string }[]
  music?: { play_url?: string; play_url_backup?: string }
  [key: string]: unknown
}

const ERROR_KIND: Record<number, string> = {
  1001: 'not_found_or_private',
  1002: 'network',
  1401: 'provider_key_invalid',
  1402: 'provider_quota_exceeded',
  1429: 'rate_limited',
  1500: 'upstream_error',
  1503: 'provider_unavailable',
}

function normalize(d: DouParseData): NormalizedMedia {
  const isImage = d.aweme_type === 'image' || (!d.play_url && Array.isArray(d.images) && d.images.length > 0)
  const videoUrl = d.play_url ?? d.qualities?.find((q) => q.url)?.url ?? ''
  const altUrl = d.qualities?.find((q) => q.url && q.url !== videoUrl)?.url ?? ''
  return {
    type: isImage ? 'images' : 'video',
    title: (d.desc ?? '').slice(0, 300),
    author: (d.author ?? '').slice(0, 80),
    description: (d.desc ?? '').slice(0, 1000),
    cover: d.cover ?? '',
    videoUrl,
    videoUrlAlt: altUrl,
    audioUrl: d.music?.play_url ?? d.music?.play_url_backup ?? '',
    images: Array.isArray(d.images) ? d.images.filter((x) => typeof x === 'string') : [],
    motionPhotos: [],
    watermarkStatus: 'removed',
  }
}

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  try {
    const res = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

export async function handleParse(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let input = ''
  try {
    const body = (await request.json()) as { url?: unknown }
    input = typeof body.url === 'string' ? body.url.trim().slice(0, 2000) : ''
  } catch {
    return json({ error: '请求格式错误', error_kind: 'invalid_input' }, 400)
  }

  const url = extractDouyinUrl(input)
  if (!url) return json({ error: '未找到有效的抖音分享链接', error_kind: 'invalid_input' }, 400)

  // 生产环境：配置了 Turnstile secret 则强制校验；本地开发可用 ALLOW_UNVERIFIED=true 放行
  const secret = env.TURNSTILE_SECRET_KEY
  if (secret) {
    const token = request.headers.get('X-Turnstile-Token') ?? ''
    const ip = request.headers.get('CF-Connecting-IP') ?? ''
    if (!token || !(await verifyTurnstile(token, secret, ip))) {
      return json({ error: '安全验证未通过，请刷新后重试', error_kind: 'verification_failed' }, 403)
    }
  } else if (env.ALLOW_UNVERIFIED !== 'true') {
    return json({ error: '服务尚未配置安全验证密钥', error_kind: 'server_misconfigured' }, 503)
  }

  const apiKey = env.DOUPARSE_API_KEY
  if (!apiKey) return json({ error: '服务尚未配置解析密钥', error_kind: 'server_misconfigured' }, 503)

  let upstream: Response
  try {
    upstream = await fetch(DOUPARSE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return json({ error: '解析服务连接超时', error_kind: 'timeout' }, 504)
  }

  let payload: { code?: number; message?: string; data?: DouParseData; remaining?: number }
  try {
    payload = (await upstream.json()) as typeof payload
  } catch {
    return json({ error: '解析服务返回了无效响应', error_kind: 'upstream_error' }, 502)
  }

  if (!upstream.ok || payload.code !== 0 || !payload.data) {
    const code = payload.code ?? -1
    const kind = ERROR_KIND[code] ?? 'upstream_error'
    const headers: Record<string, string> = {}
    if (kind === 'rate_limited') headers['Retry-After'] = '30'
    return json(
      { error: payload.message || '解析失败，请稍后重试', error_kind: kind, code },
      code === 1401 || code === 1402 ? 402 : code === 1429 ? 429 : 502,
      headers
    )
  }

  const data = normalize(payload.data)
  if (!data.videoUrl && data.images.length === 0) {
    return json({ error: '该作品没有可下载的媒体', error_kind: 'unsupported_media' }, 422)
  }

  const result: ParseSuccess = { provider: 'douyin', resolvedUrl: url, data }
  return json(result)
}
