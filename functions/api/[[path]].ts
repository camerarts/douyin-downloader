import type { Env } from '../_lib/types'
import { json } from '../_lib/lib'
import { handleParse } from '../_lib/parse'
import { handleDownload } from '../_lib/download'

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context
  const path = new URL(request.url).pathname

  if (path === '/api/health') return json({ ok: true, provider: env.PARSER_PROVIDER ?? 'douparse' })
  if (path === '/api/parse') return handleParse(request, env)
  if (path === '/api/download') return handleDownload(request, env)
  if (path === '/api/config') {
    return json({
      turnstileRequired: Boolean(env.TURNSTILE_SECRET_KEY),
      siteKey: env.TURNSTILE_SITE_KEY ?? '',
    })
  }

  return json({ error: 'Not found' }, 404)
}
