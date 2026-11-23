# 抖音无水印下载器（React + Cloudflare Pages）

粘贴抖音分享文案/短链 → 解析无水印视频、图集、原声音乐 → 下载。
前端 React/Vite 静态托管，后端用 Cloudflare Pages Functions（Hono 风格路由）在边缘运行，**不自建服务器**。

## 架构

```
浏览器 ──POST /api/parse──> Pages Function ──Bearer Key──> 抖解 DouParse API
       <──CDN 直链───────────────────────────────────────────────
浏览器 ──GET /api/download?source=...──> Pages Function ──> 抖音 CDN（域名白名单）
```

- `src/`：React 前端
- `functions/api/[[path]].ts`：API 路由（`/api/parse`、`/api/download`、`/api/config`、`/api/health`）
- `functions/_lib/`：解析适配、下载代理、输入提取（下划线前缀不生成路由）
- 解析核心由第三方 API 提供，本项目只做**输入清洗 + 调用 + 结果归一化 + 安全代理**

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars      # 填入 DOUPARSE_API_KEY
```

`.dev.vars` 里临时设 `ALLOW_UNVERIFIED=true`（本地跳过 Turnstile）。启动：

```bash
npm run dev
# 前端 http://127.0.0.1:5173 ，API 经 8788 端口代理
```

单独看生产构建：

```bash
npm run build && npm run preview   # http://127.0.0.1:8788
```

## 获取解析 API Key

1. 注册并领取 Key：https://www.qmiaowan.com/account（站点唯一官方域名 www.qimiaowan.com）
2. 新用户有免费额度；按次计费，缓存命中和失败不扣次数
3. 文档：https://www.qimiaowan.com/api-docs

## 部署到 GitHub + Cloudflare Pages

### 1. 推送到 GitHub

```bash
git init
git add .
git commit -m "init: douyin downloader on cloudflare pages"
git remote add origin https://github.com/<你的账号>/douyin-downloader.git
git branch -M main
git push -u origin main
```

### 2. Cloudflare Pages 连接仓库

1. 登录 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选中刚才的 GitHub 仓库，分支 `main`
3. 构建配置：
   - Framework preset：`Vite`
   - Build command：`npm run build`
   - Build output directory：`dist`
   - Root directory：`/`（若仓库在项目子目录则填对应路径）
4. **Environment variables（Production）必填**：
   - `DOUPARSE_API_KEY` = 你的解析 Key（**不要写进代码或提交到 GitHub**）
   - `TURNSTILE_SECRET_KEY` = Turnstile secret（见下一步）
   - `TURNSTILE_SITE_KEY` = Turnstile site key（公开值）
   - `ALLOW_UNVERIFIED` = `false`
   - `PARSER_PROVIDER` = `douparse`
5. 点 **Save and Deploy**，之后每次 push 自动重新部署。

### 3. 开启 Turnstile（公网必做）

1. Cloudflare Dashboard → **Turnstile** → **Add widget**
2. 域名选你的 Pages 域名，模式建议 **Managed**，复制 Site Key 和 Secret Key
3. 填入上面两个环境变量，重新部署
4. 前端会通过 `/api/config` 自动判断是否展示验证，后端强制校验 Token，未通过返回 403

### 4. 自定义域名（可选）

Pages 项目 → **Custom domains** → 添加你的域名，按提示改 DNS 即可。

## 安全设计

- **API Key 只在服务端**：前端拿不到，避免被盗刷
- **Turnstile 强制校验**：配置了 secret 后所有解析请求必须带有效 Token
- **下载域名白名单**：`/api/download` 只允许抖音/小红书/B站等平台 CDN 域名，防止被当成开放代理做 SSRF
- **文件名清洗**：去掉路径穿越和非法字符
- **文件大小上限**：代理 500MB 以内文件
- **输入长度限制**：分享文案 2000 字符以内

## 已知限制

- 只解析公开作品；私密、需登录、已删除内容不支持
- 依赖第三方解析 API 的额度与稳定性；Key 无效/用完会返回明确错误
- CDN 直链有时效（约 5 分钟），过期需重新解析
- Cloudflare Pages Functions 单次请求有 CPU/响应时间限制，超大图集批量打包请在客户端做
- 仅供个人学习研究，请勿用于商业或侵权用途

## 自检记录

- `npm run typecheck`：通过
- `npm run build`：通过
- 本地 `wrangler pages dev` 冒烟：`/api/health`、`/api/config`、无效输入拦截、SSRF 域名拦截均符合预期
