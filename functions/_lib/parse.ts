import type { Env, NormalizedMedia, ParseSuccess } from './types'
import { json } from './lib'
import { DouyinError, parseDouyin } from './douyin'

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  try {
    const res = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(10_000),
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
  if (!input) return json({ error: '请输入抖音分享链接', error_kind: 'invalid_input' }, 400)

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

  try {
    const parsed = await parseDouyin(input)
    const data: NormalizedMedia = {
      type: parsed.type,
      title: parsed.title,
      author: parsed.author,
      description: parsed.description,
      cover: parsed.cover,
      videoUrl: parsed.videoUrl,
      videoUrlAlt: parsed.videoUrlAlt,
      audioUrl: parsed.audioUrl,
      images: parsed.images,
      motionPhotos: parsed.motionPhotos,
      watermarkStatus: 'removed',
    }
    const result: ParseSuccess = {
      provider: 'self-hosted-h5',
      resolvedUrl: input,
      data,
    }
    return json(result)
  } catch (err) {
    if (err instanceof DouyinError) {
      return json({ error: err.message, error_kind: err.kind }, err.status)
    }
    const message = err instanceof Error ? err.message : '未知错误'
    return json({ error: `解析失败：${message}`, error_kind: 'upstream_error' }, 502)
  }
}
