/**
 * 自定义域名边缘转发
 *
 * 作用：把 douyin.mindscopelab.org 的全部请求透明转发到 Pages 生产站点。
 * 为什么需要它：Pages 自定义域名要求一条指向 <project>.pages.dev 的 CNAME，
 * 而 wrangler 的 OAuth 令牌没有 DNS 写权限；Workers 自定义域名由 Cloudflare
 * 自动创建 DNS 记录并签发证书，是等效且免手动配置的方案。
 */
const ORIGIN = 'https://douyin-downloader-git.pages.dev'

export default {
  async fetch(request) {
    const incoming = new URL(request.url)
    const target = new URL(incoming.pathname + incoming.search, ORIGIN)

    // 透传原始请求（方法、头、body、Range 等），仅改写目标主机
    const proxied = new Request(target.toString(), request)

    // 保留访客真实来源，便于 Pages Functions 侧展示/排障
    proxied.headers.set('x-forwarded-host', incoming.host)
    proxied.headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''))

    const response = await fetch(proxied)

    // 响应原样回传，并补上不可变的 CORS 与缓存语义由源站决定，这里不改动
    return response
  },
}
