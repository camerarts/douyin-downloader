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

function downloadUrl(source: string, filename: string, inline = false) {
  return `/api/download?source=${encodeURIComponent(source)}&filename=${encodeURIComponent(filename)}${inline ? '&inline=1' : ''}`
}

function Icon({ name, size = 16 }: { name: 'sun' | 'moon' | 'copy' | 'check' | 'arrow' | 'link' | 'play' | 'image' | 'music'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 20 20', 'aria-hidden': true } as const
  switch (name) {
    case 'sun':
      return <svg {...common}><circle cx="10" cy="10" r="3.6" fill="currentColor" /><g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" /></g></svg>
    case 'moon':
      return <svg {...common}><path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a.6.6 0 0 0-.8-.7 7.6 7.6 0 1 0 10.3 10.3.6.6 0 0 0-.7-.8z" fill="currentColor" /></svg>
    case 'copy':
      return <svg {...common}><rect x="7" y="7" width="9" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M13 5V4.2A1.2 1.2 0 0 0 11.8 3H4.2A1.2 1.2 0 0 0 3 4.2v8.6A1.2 1.2 0 0 0 4.2 14H5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
    case 'check':
      return <svg {...common}><path d="M4 10.5l3.5 3.5L16 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'arrow':
      return <svg {...common}><path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'link':
      return <svg {...common}><path d="M8 12a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2L9.3 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M12 8a3 3 0 0 0-4.2 0L5.3 10.5a3 3 0 0 0 4.2 4.2l1.2-1.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
    case 'play':
      return <svg {...common}><path d="M6 3.5v13a.7.7 0 0 0 1.1.6l10-6.5a.7.7 0 0 0 0-1.2l-10-6.5A.7.7 0 0 0 6 3.5z" fill="currentColor" /></svg>
    case 'image':
      return <svg {...common}><rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="7" cy="8" r="1.5" fill="currentColor" /><path d="M3 14l4-4 3.5 3.5L13 11l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    case 'music':
      return <svg {...common}><path d="M8 15V5l9-2v10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="5.5" cy="15.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="14.5" cy="13.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  }
}

export default function App() {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [config, setConfig] = useState<Config>({ turnstileRequired: false, siteKey: '' })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | undefined>(undefined)
  const pendingToken = useRef('')

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

  const copy = async (text: string, key: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      ta.remove()
    }
    setCopied(key)
    window.setTimeout(() => setCopied(''), 1800)
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('dy-theme', next) } catch { /* ignore */ }
  }

  const d = result?.data
  const caption = d?.description || d?.title || ''
  const busyLabel = busy ? (phase === 'verifying' ? '验证中…' : '解析中…') : '开始解析'

  return (
    <div className="app">
      <header className="top">
        <div className="top-in">
          <a className="logo" href="/" aria-label="抖音无水印下载 首页">
            <span className="logo-mark">DY</span>
            <span>抖音无水印</span>
          </a>
          <nav className="top-nav" aria-label="站点信息">
            <span className="status"><span className="status-dot" />免费 · 无需登录</span>
            <button type="button" className="icon-b" onClick={toggleTheme} aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'} title={theme === 'dark' ? '浅色主题' : '深色主题'}>
              {theme === 'dark' ? <Icon name="sun" size={18} /> : <Icon name="moon" size={18} />}
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        <div className="columns">
          {/* ---------- 左：操作 + 媒体 ---------- */}
          <div className="col-stage">
            <section className="hero" aria-labelledby="hero-h">
              <p className="eyebrow">FREE · NO WATERMARK · NO LOGIN</p>
              <h1 id="hero-h">把喜欢的作品，<br />干干净净地留下来。</h1>
              <p className="lead">粘贴抖音分享链接或整段文案，解析无水印视频、图集与原声。不登录、不装 App、不花钱。</p>
              <dl className="facts">
                <div><dt>解析费用</dt><dd>¥0</dd></div>
                <div><dt>水印处理</dt><dd>已去除</dd></div>
                <div><dt>第三方 Key</dt><dd>不需要</dd></div>
              </dl>
            </section>

            <section className="install" aria-labelledby="input-h">
              <div className="install-head">
                <h2 className="install-h" id="input-h">粘贴分享内容</h2>
                <span className="install-note">支持短链 / 完整链接 / 整段文案</span>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="把抖音 App 里复制的整段分享文案粘到这里…"
                rows={4}
                aria-label="抖音分享链接或文案"
                spellCheck={false}
              />
              <div className="input-actions">
                <button type="button" className="btn btn-main" onClick={onParse} disabled={busy}>
                  {busyLabel}
                  {!busy && <Icon name="arrow" size={17} />}
                </button>
                <span className="input-hint"><Icon name="link" size={14} /> 例如 v.douyin.com/xxxxx/</span>
              </div>
              {config.turnstileRequired && <div ref={turnstileRef} className="turnstile" />}
              {phase === 'error' && <div className="alert" role="alert">{error}</div>}
            </section>

            {phase === 'success' && d && (
              <section className="media" aria-labelledby="media-h">
                <div className="media-head">
                  <h2 className="install-h" id="media-h">解析结果</h2>
                  <span className="pill">{d.type === 'video' ? '视频' : `图集 · ${d.images.length} 张`}</span>
                </div>

                {d.type === 'video' && d.videoUrl && (
                  <div className="stage">
                    <video controls playsInline preload="metadata" poster={d.cover ? downloadUrl(d.cover, `${d.title || 'cover'}_封面.jpg`, true) : undefined} src={downloadUrl(d.videoUrl, d.title || 'douyin-video', true)} />
                  </div>
                )}

                <div className="downloads">
                  {d.videoUrl && (
                    <a className="btn btn-main" href={downloadUrl(d.videoUrl, d.title || 'douyin-video')} download>
                      <Icon name="play" size={14} /> 下载无水印视频
                    </a>
                  )}
                  {d.videoUrlAlt && <a className="btn" href={downloadUrl(d.videoUrlAlt, `${d.title || 'video'}_备用`)} download>备用源</a>}
                  {d.audioUrl && (
                    <a className="btn" href={downloadUrl(d.audioUrl, `${d.title || 'audio'}_原声`)} download>
                      <Icon name="music" size={14} /> 原声 MP3
                    </a>
                  )}
                  {d.cover && <a className="btn" href={downloadUrl(d.cover, `${d.title || 'cover'}_封面`)} download><Icon name="image" size={14} /> 封面</a>}
                </div>

                {d.images.length > 0 && (
                  <div className="gallery">
                    <h3 className="gallery-h">图集 · {d.images.length} 张</h3>
                    <div className="grid">
                      {d.images.map((src, i) => (
                        <div className="tile" key={i}>
                          <img src={downloadUrl(src, `${d.title || 'image'}_${i + 1}`, true)} alt={`第 ${i + 1} 张`} loading="lazy" />
                          <a href={downloadUrl(src, `${d.title || 'image'}_${i + 1}`)} download>保存</a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="expiry">CDN 直链约 5 分钟过期，请及时下载。</p>
              </section>
            )}
          </div>

          {/* ---------- 右：文案面板 ---------- */}
          <aside className="col-copy" aria-labelledby="copy-h">
            <div className="copy-panel">
              <div className="copy-head">
                <h2 className="install-h" id="copy-h">作品文案</h2>
                <span className="copy-badge">CAPTION</span>
              </div>

              {d ? (
                <>
                  <div className="copy-author">
                    <span className="avatar">{d.author ? d.author.slice(0, 1).toUpperCase() : 'DY'}</span>
                    <div>
                      <div className="author-name">{d.author ? `@${d.author}` : '抖音作品'}</div>
                      <div className="author-sub">{d.type === 'video' ? '视频作品' : `图集 · ${d.images.length} 张`}</div>
                    </div>
                  </div>

                  {d.title && <h3 className="copy-title">{d.title}</h3>}

                  <div className="caption-box">
                    <p>{caption || '（该作品没有文案）'}</p>
                  </div>

                  <div className="copy-actions">
                    <button type="button" className={`btn btn-main copy-btn ${copied === 'caption' ? 'is-done' : ''}`} onClick={() => void copy(caption, 'caption')} disabled={!caption}>
                      <Icon name={copied === 'caption' ? 'check' : 'copy'} size={15} />
                      {copied === 'caption' ? '已复制文案' : '一键复制文案'}
                    </button>
                    {d.title && (
                      <button type="button" className={`btn copy-btn ${copied === 'title' ? 'is-done' : ''}`} onClick={() => void copy(d.title, 'title')}>
                        <Icon name={copied === 'title' ? 'check' : 'copy'} size={15} />
                        {copied === 'title' ? '已复制标题' : '复制标题'}
                      </button>
                    )}
                  </div>

                  <dl className="copy-meta">
                    <div><dt>解析方式</dt><dd>自建匿名</dd></div>
                    <div><dt>水印状态</dt><dd>{d.watermarkStatus === 'removed' ? '已去除' : '未知'}</dd></div>
                    <div><dt>内容类型</dt><dd>{d.type === 'video' ? '视频' : '图集'}</dd></div>
                  </dl>
                  <p className="copy-foot">文案可直接粘贴到其它平台使用。</p>
                </>
              ) : (
                <div className="copy-empty">
                  <div className="empty-mark"><Icon name="copy" size={22} /></div>
                  <h3>文案会显示在这里</h3>
                  <p>解析作品后，标题与完整文案会自动呈现在右侧，点一下即可复制。</p>
                  <div className="empty-lines"><span /><span /><span /><span /></div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      <footer className="foot">
        <span>仅供个人学习与研究使用 · 内容版权归平台及原作者所有</span>
        <span className="foot-right">免费 · 匿名 · 无水印</span>
      </footer>
    </div>
  )
}
