# 抖音无水印下载器（React + Cloudflare Pages）

粘贴抖音分享文案/短链 → 解析无水印视频、图集、封面 → 下载。

**解析核心完全免费**：自建直连抖音官方接口，无需任何付费 API Key，无需注册第三方服务，无次数限制。
前端 React/Vite 静态托管，后端 Cloudflare Pages Functions 在边缘运行，**不自建服务器**。

## 解析原理（免费的核心）

```
分享链接 → Pages Function → 抖音官方 H5 分享页（取一次性 xsstoken/webId）
                        → AES-128-CBC 加密得到 reflow_id
                        → 抖音官方 iteminfo 接口取作品 JSON
                        → playwm 换成 play 得到无水印直链
```

- 只调用抖音/字节官方端点，**不经过任何第三方解析服务**，不存储作品内容
- xsstoken 是一次性短期凭证，每次解析实时获取，失败自动刷新重试
- 所谓"去水印"不是擦除像素：抖音水印是客户端播放时叠加的，CDN 原始流（`play` 接口）本就无水印
- 参考开源项目 `wujunwei928/parse-video` 的 H5 恢复方案（PR #106）

## 架构

- `src/`：React 前端
- `functions/api/[[path]].ts`：API 路由（`/api/parse`、`/api/download`、`/api/config`、`/api/health`）
- `functions/_lib/douyin.ts`：**免费解析核心**（H5 上下文 + AES 加密 + 数据归一化）
- `functions/_lib/download.ts`：下载代理（域名白名单防 SSRF）
- `functions/_lib/parse.ts`：请求校验 + 调用解析核心

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars      # 已默认 ALLOW_UNVERIFIED=true，无需填任何 Key
npm run dev
# 前端 http://127.0.0.1:5173 ，API 经 8788 端口代理
```

单独看生产构建：

```bash
npm run build && npm run preview   # http://127.0.0.1:8788
```

不需要申请任何 API Key，直接就能解析。

## 部署到 GitHub + Cloudflare Pages

### 1. 推送到 GitHub

```bash
git init
git add .
git commit -m "init: free douyin downloader on cloudflare pages"
git remote add origin https://github.com/<你的账号>/douyin-downloader.git
git branch -M main
git push -u origin main
```

### 2. Cloudflare Pages 连接仓库

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选中 GitHub 仓库，分支 `main`
3. 构建配置：
   - Framework preset：`Vite`
   - Build command：`npm run build`
   - Build output directory：`dist`
   - Root directory：`/`
4. 环境变量：
   - **免费方案无需配置任何解析 Key**
   - 公网部署建议配 Turnstile（见下一步）：`TURNSTILE_SECRET_KEY`（secret）、`TURNSTILE_SITE_KEY`（公开值）
   - `ALLOW_UNVERIFIED` = `false`
5. **Save and Deploy**，之后每次 push 自动重新部署。

### 3. 开启 Turnstile（公网建议）

免费不等于无防护。解析接口直接暴露会被刷，建议加 Cloudflare Turnstile：

1. Dashboard → **Turnstile** → **Add widget**，域名选 Pages 域名，模式选 **Managed**
2. 填入上面两个环境变量，重新部署
3. 前端通过 `/api/config` 自动判断是否展示验证，后端强制校验 Token

### 4. 自定义域名（可选）

Pages 项目 → **Custom domains** → 添加域名，按提示改 DNS。

## 安全设计

- **无第三方 Key**：不存在 Key 泄露、盗刷、额度耗尽问题
- **Turnstile 可选强制校验**：配置后所有解析请求必须带有效 Token
- **下载域名白名单**：`/api/download` 只允许抖音/CDN 官方域名，防止被当成开放代理做 SSRF
- **文件名清洗 / 大小上限 / 输入长度限制**
- **不存储内容**：解析结果直接返回，CDN 直链有时效（约几分钟）

## 已知限制

- 只解析公开作品；私密、需登录、已删除内容不支持（接口会返回明确提示）
- 依赖抖音 H5 页面的一次性 token 机制，平台改版可能导致解析失效，需更新核心
- CDN 直链有时效，过期需重新解析
- Cloudflare 免费版 Workers 有每日请求额度，个人使用足够
- 仅供个人学习研究，请勿用于商业或侵权用途

## 自检记录

- `npm run typecheck`：通过
- `npm run build`：通过
- 本地 `wrangler pages dev` 实测：真实抖音短链成功返回标题/作者/封面/无水印 `play` 直链（HTTP 200）
