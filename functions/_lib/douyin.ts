/**
 * 抖音免费匿名解析核心
 *
 * 原理（无需 Cookie、无需付费 API、无需签名服务）：
 * 1. 请求官方 H5 分享页 https://www.iesdouyin.com/share/video/<id>
 * 2. 分享页 HTML 里内嵌一次性上下文：
 *    <div id=douyin_reflow_token xsstoken=...>
 *    <div id='douyin_reflow_webId' webId=... usercip=...>
 * 3. 用 webId 前 16 字节作为 AES-128-CBC 的 key 和 IV，
 *    对 xsstoken 做 PKCS#7 填充后加密，Base64 得到 reflow_id
 * 4. 带 reflow_id 请求官方 H5 接口 /web/api/v2/aweme/iteminfo/
 * 5. 从 item_list[0] 取作品数据，play_addr 里的 playwm 换成 play 即无水印直链
 *
 * 参考：开源项目 wujunwei928/parse-video 的 PR #106（douyin_h5_detail.go）
 * 该方案只使用抖音/字节官方端点，不调用任何第三方解析服务。
 */

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const SHARE_PAGE = 'https://www.iesdouyin.com/share/video/'
const ITEMINFO = 'https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/'
const TIMEOUT_MS = 20_000
const MAX_CONTEXT_RETRY = 3

interface ReflowContext {
  token: string
  webId: string
  userCip: string
}

interface H5Item {
  aweme_id?: string
  desc?: string
  create_time?: number
  aweme_type?: number
  author?: { nickname?: string; signature?: string }
  music?: { play_url?: { url_list?: string[] } }
  video?: {
    play_addr?: { url_list?: string[] }
    cover?: { url_list?: string[] }
    bit_rate?: { play_addr?: { url_list?: string[] } }[]
    duration?: number
    width?: number
    height?: number
  }
  images?: { url_list?: string[]; video?: { play_addr?: { url_list?: string[] } } }[]
  image_infos?: unknown[]
}

export interface FreeParseResult {
  type: 'video' | 'images'
  title: string
  author: string
  description: string
  cover: string
  videoUrl: string
  videoUrlAlt: string
  audioUrl: string
  images: string[]
  motionPhotos: { index: number; imageUrl: string; videoUrl: string }[]
  duration: number
}

export class DouyinError extends Error {
  constructor(
    message: string,
    public kind: string,
    public status = 502
  ) {
    super(message)
  }
}

/** 从各种分享文案/链接里提取抖音作品 ID */
export function extractVideoId(input: string): string | null {
  const short = input.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_\-]+/i)
  const idMatch =
    input.match(/https?:\/\/(?:www\.)?(?:ies)?douyin\.com\/(?:video|note|share\/video|share\/note)\/(\d+)/i) ||
    input.match(/(?:video|note|item_ids=)(\d{15,25})/)
  if (idMatch) return idMatch[1]
  // 纯数字 ID
  const plain = input.trim().match(/^(\d{15,25})$/)
  if (plain) return plain[1]
  void short
  return null
}

/** 跟随 v.douyin.com 短链，拿到最终分享页 URL */
export async function resolveShortLink(input: string): Promise<string> {
  const m = input.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_\-]+\/?/i)
  if (!m) return input
  try {
    const res = await fetch(m[0], {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.url || input
  } catch {
    return input
  }
}

/** 从分享页 HTML 里提取一次性 reflow 上下文 */
function parseReflowContext(html: string): ReflowContext | null {
  // 属性可能带引号也可能不带，顺序也可能变化，逐个属性解析
  const tokenTag = html.match(/<div[^>]*id=['"]?douyin_reflow_token['"]?[^>]*>/i)
  const webIdTag = html.match(/<div[^>]*id=['"]?douyin_reflow_webId['"]?[^>]*>/i)
  if (!tokenTag || !webIdTag) return null

  const attr = (tag: string, name: string): string => {
    const re = new RegExp(`${name}\\s*=\\s*['"]?([^'">\\s]+)`, 'i')
    return tag.match(re)?.[1]?.trim() ?? ''
  }
  const token = attr(tokenTag[0], 'xsstoken')
  const webId = attr(webIdTag[0], 'webId')
  const userCip = attr(webIdTag[0], 'usercip')
  if (!token || !webId || new TextEncoder().encode(webId).length < 16) return null
  return { token, webId, userCip }
}

/** AES-128-CBC 加密（Web Crypto API，边缘环境可用，自动 PKCS#7 填充） */
async function encryptReflowId(token: string, webId: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(webId.slice(0, 16))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'])
  const tokenBytes = new TextEncoder().encode(token)

  // Web Crypto 的 AES-CBC 自带 PKCS#7 填充，直接加密原始 token 即可
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: keyBytes }, key, tokenBytes)
  const bytes = new Uint8Array(ciphertext)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** 取非空 URL（优先非 webp 图片、优先高码率视频） */
function pickUrl(urls?: string[]): string {
  if (!Array.isArray(urls)) return ''
  return urls.find((u) => typeof u === 'string' && u.startsWith('http')) ?? ''
}

function pickImageUrl(urls?: string[]): string {
  if (!Array.isArray(urls)) return ''
  return urls.find((u) => u.startsWith('http') && !u.includes('.webp')) ?? urls.find((u) => u.startsWith('http')) ?? ''
}

/** 归一化作品数据 */
function normalize(item: H5Item): FreeParseResult | null {
  const isImagePost = (Array.isArray(item.images) && item.images.length > 0) || item.aweme_type === 2
  const playUrl = pickUrl(item.video?.play_addr?.url_list)
  // 备用源：bit_rate 里其他码率
  const altUrl = pickUrl(item.video?.bit_rate?.find((b) => pickUrl(b.play_addr?.url_list) !== playUrl)?.play_addr?.url_list)
  // playwm -> play 得到无水印流
  const toNoWm = (u: string) => u.replace('/playwm/', '/play/')

  const images = isImagePost ? (item.images ?? []).map((im) => pickImageUrl(im.url_list)).filter(Boolean) : []
  const motionPhotos = isImagePost
    ? (item.images ?? [])
        .map((im, i) => ({ index: i, imageUrl: pickImageUrl(im.url_list), videoUrl: pickUrl(im.video?.play_addr?.url_list) }))
        .filter((x) => x.videoUrl)
    : []

  const videoUrl = isImagePost ? (motionPhotos[0]?.videoUrl ?? '') : toNoWm(playUrl)
  if (!videoUrl && images.length === 0) return null

  return {
    type: isImagePost ? 'images' : 'video',
    title: (item.desc ?? '').slice(0, 5000),
    author: (item.author?.nickname ?? '').slice(0, 80),
    description: (item.desc ?? '').slice(0, 5000),
    cover: pickImageUrl(item.video?.cover?.url_list),
    videoUrl,
    videoUrlAlt: altUrl ? toNoWm(altUrl) : '',
    audioUrl: pickUrl(item.music?.play_url?.url_list),
    images,
    motionPhotos,
    duration: item.video?.duration ?? 0,
  }
}

/** 核心：免费匿名解析抖音作品 */
export async function parseDouyin(input: string): Promise<FreeParseResult> {
  const resolved = await resolveShortLink(input)
  const videoId = extractVideoId(resolved) ?? extractVideoId(input)
  if (!videoId) throw new DouyinError('未找到有效的抖音作品 ID', 'invalid_input', 400)

  let pageHtml = ''
  let cookies = ''

  // 多次尝试：上下文可能一次性或短期过期，失败时刷新分享页
  for (let attempt = 0; attempt < MAX_CONTEXT_RETRY; attempt++) {
    if (!pageHtml) {
      let pageRes: Response
      try {
        pageRes = await fetch(`${SHARE_PAGE}${videoId}`, {
          headers: { 'User-Agent': UA, Accept: 'text/html' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        throw new DouyinError('连接抖音分享页超时', 'timeout', 504)
      }
      if (!pageRes.ok) throw new DouyinError(`分享页返回 ${pageRes.status}`, 'upstream_error', 502)
      pageHtml = await pageRes.text()
      // 收集 Set-Cookie（Workers 支持 getSetCookie，旧环境回退到 get）
      const setCookie = (pageRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
      cookies = setCookie ? setCookie.call(pageRes.headers).map((c) => c.split(';')[0]).join('; ') : pageRes.headers.get('set-cookie')?.split(';')[0] ?? ''
    }

    const context = parseReflowContext(pageHtml)
    if (!context) {
      // 上下文缺失，刷新页面重试
      pageHtml = ''
      continue
    }

    const reflowId = await encryptReflowId(context.token, context.webId)
    const params = new URLSearchParams({
      reflow_source: 'reflow_page',
      web_id: context.webId,
      device_id: context.webId,
      use_new_select_scope: '0',
      item_ids: videoId,
      reflow_id: reflowId,
    })
    if (context.userCip) params.set('user_cip', context.userCip)

    let apiRes: Response
    try {
      apiRes = await fetch(`${ITEMINFO}?${params.toString()}`, {
        headers: {
          'User-Agent': UA,
          Referer: `${SHARE_PAGE}${videoId}`,
          Accept: 'application/json, text/plain, */*',
          ...(cookies ? { Cookie: cookies } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new DouyinError('请求抖音数据接口超时', 'timeout', 504)
    }
    if (!apiRes.ok) throw new DouyinError(`抖音接口返回 ${apiRes.status}`, 'upstream_error', 502)

    let payload: { status_code?: number; status_msg?: string; item_list?: H5Item[] }
    try {
      payload = await apiRes.json()
    } catch {
      throw new DouyinError('抖音接口返回了无效数据', 'upstream_error', 502)
    }

    if (payload.status_code !== 0) {
      const filterReason = payload.item_list?.[0] ? '作品不可用' : payload.status_msg || '解析失败'
      throw new DouyinError(filterReason, 'not_found_or_private', 404)
    }

    const item = payload.item_list?.[0]
    if (!item) {
      // 上下文可能被拒绝，刷新重试
      pageHtml = ''
      continue
    }
    if (item.aweme_id && item.aweme_id !== videoId) {
      pageHtml = ''
      continue
    }

    const result = normalize(item)
    if (!result) throw new DouyinError('该作品没有可下载的媒体', 'unsupported_media', 422)
    return result
  }

  throw new DouyinError('无法获取作品信息，请稍后重试或检查链接', 'context_failed', 502)
}
