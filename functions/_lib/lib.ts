// 仅提取抖音域名链接，整段分享文案自动识别
const DY_PATTERNS = [
  /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_\-]+\/?/gi,
  /https?:\/\/(?:www\.)?douyin\.com\/(?:video|note)\/\d+[^\s"']*/gi,
  /https?:\/\/(?:www\.)?iesdouyin\.com\/share\/(?:video|note)\/\d+[^\s"']*/gi,
]

export function extractDouyinUrl(text: string): string | null {
  if (!text) return null
  for (const re of DY_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m) return m[0].replace(/[)\]}>"'.,。，、！!?？]+$/, '')
  }
  return null
}

// 下载代理只允许平台 CDN 域名，防止 SSRF
const CDN_HOSTS = [
  // 抖音系视频/图片 CDN
  'douyincdn.com', 'douyinstatic.com', 'douyinvod.com', 'douyin.com',
  'douyinpic.com', 'snssdk.com', 'snssdkimg.com', 'bytecdn.cn',
  'byteimg.com', 'bytecdn.com', 'byteimg.com', 'zicdn.com', 'ixigua.com',
  'memedata.cn', 'douyinlive.com',
  'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktok.com', 'tiktokcdn-web.com',
  // 其他平台
  'xhscdn.com', 'xiaohongshu.com', 'kuaishoucdn.com', 'kuaishou.com',
  'bilivideo.com', 'bilibili.com', 'hdslb.com',
]

export function isAllowedCdn(host: string): boolean {
  const h = host.toLowerCase()
  return CDN_HOSTS.some((suffix) => h === suffix || h.endsWith('.' + suffix))
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 80)
  return cleaned || 'media'
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}
