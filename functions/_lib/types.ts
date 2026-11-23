export interface Env {
  // 抖解 DouParse 开放 API Key（服务端密钥，禁止下发到前端）
  DOUPARSE_API_KEY?: string
  // Cloudflare Turnstile：secret 服务端校验，site key 公开给前端
  TURNSTILE_SECRET_KEY?: string
  TURNSTILE_SITE_KEY?: string
  // 未配置 Turnstile 时是否放行（仅本地开发设 true）
  ALLOW_UNVERIFIED?: string
  PARSER_PROVIDER?: string
}

export interface NormalizedMedia {
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
  watermarkStatus: 'removed' | 'unknown'
}

export interface ParseSuccess {
  provider: string
  resolvedUrl: string
  data: NormalizedMedia
}
