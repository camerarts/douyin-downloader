import { useCallback, useEffect, useRef, useState } from 'react'

interface MediaData {
  type: 'video' | 'images'
  title: string
  author: string
  description: string
  cover: string
  videoUrl: string
  videoUrlAlt: string
  audioUrl: string
  images: string[]
  motionPhotos: { index: number }[]
  watermarkStatus: 'removed' | 'unknown'
}

interface ParseResult {
  provider: string
  resolvedUrl: string
  data: MediaData
}

type Phase = 'idle' | 'verifying' | 'parsing' | 'success' | 'error'

interface Config {
  turnstileRequired: boolean
  siteKey: string
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (widget?: string) => void
      remove: (widget?: string) => void
      execute: (widget?: string) => void
    }
  }
}

const EXAMPLES = [
  '把你抖音 App 里复制的整段分享文案粘到这里',
  '也支持 https://v.douyin.com/xxxxx/ 这样的短链接',
]

function downloadUrl(source: string, filename: string) {
  return `/api/download?source=${encodeURIComponent(source)}&filename=${encodeURIComponent(filename)}`
}

export default function App() {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [config, setConfig] = useState<Config>({ turnstileRequired: false, siteKey: '' })
  const [busy, setBusy] = useState(false)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | undefined>(undefined)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? (r.json() as Promise<Config>) : null))
      .then((c) => { if (c) setConfig(c) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!config.turnstileRequired || !config.siteKey || !turnstileRef.current) return
    let cancelled = false
    const render = () => {
      if (cancelled || !turnstileRef.current || !window.turnstile || widgetId.current) return
      widgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: config.siteKey,
        execution: 'execute',
        appearance: 'interaction-only',
        size: 'flexible',
        callback: (token: string) => {
          pendingToken.current = token
          void submit(token)
        },
        'error-callback': () => {
          setBusy(false)
          setPhase('error')
          setError('安全验证失败，请重试')
        },
      })
    }
    if (window.turnstile) {
      render()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = render
    document.head.appendChild(script)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const pendingToken = useRef('')

  const submit = useCallback(async (token = '') => {
    const text = input.trim()
    if (!text) {
      setPhase('error')
      setError('请先粘贴分享链接或文案')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    setPhase(config.turnstileRequired && !token ? 'verifying' : 'parsing')
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Turnstile-Token': token } : {}),
        },
        body: JSON.stringify({ url: text }),
      })
      const payload = (await res.json().catch(() => ({}))) as Partial<ParseResult> & { error?: string }
      if (!res.ok || payload.error) {
        throw new Error(payload.error || `解析失败（HTTP ${res.status}）`)
      }
      setResult(payload as ParseResult)
      setPhase('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败')
      setPhase('error')
    } finally {
      setBusy(false)
      if (config.turnstileRequired && window.turnstile && widgetId.current) {
        window.turnstile.reset(widgetId.current)
        pendingToken.current = ''
      }
    }
  }, [input, config.turnstileRequired])

  const onParse = () => {
    if (config.turnstileRequired) {
      setBusy(true)
      setPhase('verifying')
      if (window.turnstile && widgetId.current) window.turnstile.execute(widgetId.current)
      else setError('安全验证尚未就绪，请稍后再试')
      return
    }
    void submit('')
  }

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
  }

  const d = result?.data

  return (
    <main className="app">
      <header className="hero">
        <div className="tag">无水印 · 抖音解析</div>
        <h1>抖音视频，干干净净地存下来。</h1>
        <p>粘贴分享链接或整段文案，解析无水印视频、图集与原声音乐。不登录、不装 App。</p>
      </header>

      <section className="panel">
        <div className="input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={EXAMPLES[0]}
            rows={3}
            aria-label="抖音分享链接或文案"
          />
          <button className="primary" onClick={onParse} disabled={busy}>
            {busy ? (phase === 'verifying' ? '验证中…' : '解析中…') : '开始解析'}
          </button>
        </div>
        <div className="hint">{EXAMPLES[1]}</div>
        {config.turnstileRequired && <div ref={turnstileRef} className="turnstile" />}
        {phase === 'error' && <div className="alert" role="alert">{error}</div>}
      </section>

      {phase === 'success' && d && (
        <section className="result">
          {d.cover && <img className="cover" src={downloadUrl(d.cover, `${d.title || 'cover'}_封面.jpg`)} alt="封面" />}
          <div className="info">
            <div className="author">{d.author ? `@${d.author}` : '抖音作品'}</div>
            <h2>{d.title || '（无标题）'}</h2>
            <div className="meta">
              <span>{d.type === 'video' ? '视频' : `图集 · ${d.images.length} 张`}</span>
              <span>水印：{d.watermarkStatus === 'removed' ? '已去除' : '未知'}</span>
            </div>
            <div className="actions">
              {d.videoUrl && (
                <a className="btn primary" href={downloadUrl(d.videoUrl, d.title || 'douyin-video')} download>
                  下载无水印视频
                </a>
              )}
              {d.videoUrlAlt && (
                <a className="btn ghost" href={downloadUrl(d.videoUrlAlt, `${d.title || 'video'}_备用`)} download>
                  备用源
                </a>
              )}
              {d.audioUrl && (
                <a className="btn ghost" href={downloadUrl(d.audioUrl, `${d.title || 'audio'}_原声`)} download>
                  下载原声 MP3
                </a>
              )}
              {d.cover && (
                <a className="btn ghost" href={downloadUrl(d.cover, `${d.title || 'cover'}_封面`)} download>
                  封面
                </a>
              )}
              <button className="btn ghost" onClick={() => void copyText(d.description || d.title)}>复制文案</button>
            </div>
            <div className="expiry">CDN 直链约 5 分钟过期，请及时下载。</div>
          </div>
        </section>
      )}

      {phase === 'success' && d && d.images.length > 0 && (
        <section className="gallery">
          <h3>图集 · {d.images.length} 张</h3>
          <div className="grid">
            {d.images.map((src, i) => (
              <div className="tile" key={i}>
                <img src={downloadUrl(src, `${d.title || 'image'}_${i + 1}`)} alt={`第 ${i + 1} 张`} loading="lazy" />
                <a href={downloadUrl(src, `${d.title || 'image'}_${i + 1}`)} download>保存</a>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer>仅供个人学习与研究使用 · 内容版权归平台及原作者所有</footer>
    </main>
  )
}
