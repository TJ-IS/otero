# Otero

面向 **AIS Senior Scholars' Basket of Journals**（信息系统协会资深学者推荐期刊，共 11 本）的文献收录与全文管理系统。数据模型仿 Zotero EAV；元数据存 **PostgreSQL**；PDF 与全文资产存 **本地磁盘** 或 **Cloudflare R2**（S3 兼容 API）；全文解析走 [MinerU](https://mineru.net)；Web 端支持浏览、检索、仪表盘、作者图谱与钱包编辑鉴权。

## 收录期刊

通过 `src/services/journalWhitelist.js` 对入库文献做**虚拟分类**：原始 `publicationTitle` 永不改写；不在白名单（或缺省）的条目在查询时归入「待归档」。

| # | 期刊 |
|---|------|
| 1 | MIS Quarterly |
| 2 | Information Systems Research |
| 3 | Journal of Management Information Systems |
| 4 | Journal of the Association for Information Systems |
| 5 | Information Systems Journal |
| 6 | European Journal of Information Systems |
| 7 | Information and Organization |
| 8 | Decision Support Systems |
| 9 | Journal of Information Technology |
| 10 | The Journal of Strategic Information Systems |
| 11 | Information & Management |

## 功能特性

- **EAV 题录**：`items` + `itemData` + `itemDataValues`，适配多种条目类型。
- **PDF 导入**：抽取内嵌元数据与首页文本，再按 DOI / arXiv / ISBN 向 CrossRef、arXiv、OpenLibrary 补全。
- **对象存储**：`STORAGE_TYPE=filesystem` 或 `s3`（Cloudflare R2 / 任意 S3 兼容端点）。
- **MinerU 全文**：PDF → Markdown + 图片；批量提交、配额感知、429 退避、后台 Worker 轮询落盘。
- **期刊侧栏 / 全文阅读 / 任务日志**：按期刊浏览；Markdown 渲染；MinerU 队列状态与失败重试。
- **仪表盘**：概览、期刊、时间线、DOI 覆盖、入库与全文统计。
- **作者图谱**：合作网络与作者详情页。
- **Merkle 完整性**：文献集合 Merkle 根查询、存在性证明与重建。
- **LLM 能力**：题录校准、字段抽取、条目对话（OpenAI 兼容 API）。
- **导出**：BibTeX / RIS。
- **编辑鉴权**：以太坊钱包签名登录；白名单地址可写，其余只读。
- **Docker**：本地开发 compose 自带 `postgres` + `otero`；生产 compose 只跑 `otero`，数据库自备。前端构建产物由后端静态托管。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js ≥ 20（ESM）、Express、`pg`、pdfjs-dist、adm-zip、zod、`minio`（S3 SDK，对接 R2） |
| 前端 | Vite + React + shadcn/ui + Tailwind；recharts / d3-force / KaTeX |
| 数据 | PostgreSQL 16；对象存储 filesystem 或 Cloudflare R2 |
| 外部 | MinerU、DeepSeek/OpenAI 兼容 LLM、CrossRef / arXiv / OpenLibrary |

## 目录结构

```
data/                 运行时数据（gitignored）
  postgres/           本地开发 compose 的 PostgreSQL 数据文件（生产自备）
  storage/            STORAGE_TYPE=filesystem 时的 PDF / 全文
src/
  db/                 connection、schema.postgres.sql、migrate、seed
  models/             Item / Collection / Attachment
  repositories/       SQL 访问层
  services/           导入、识别、存储、MinerU、全文、校准、抽取、聊天、Merkle…
  api/                Express + 路由 + 钱包鉴权中间件
  cli/                commander CLI
  config.js           .env + 默认值（DATABASE_URL 必填）
scripts/
  import-downloads-to-db.mjs   按 DOI 文件名批量入库（Crossref + 当前存储后端）
web/                  Vite 前端
docs/                 设计参考（Zotero 数据格式与 PDF 识别分析）
deps/zotero/          Zotero 参考源码（submodule）
Dockerfile / docker-compose.yml / docker-entrypoint.sh
```

根目录另有若干一次性运维脚本（`import_all.mjs`、`enrich_all.mjs`、`extract_all.mjs` 等），路径与并发写死在脚本内，按需改后使用。

## 环境变量

复制 `.env.example` 为 `.env`。完整键名以 `src/config.js` 为准，常用项：

```env
# PostgreSQL（必填）
DATABASE_URL=postgresql://otero:otero-secret-change-me@127.0.0.1:5432/otero
POSTGRES_USER=otero
POSTGRES_PASSWORD=otero-secret-change-me
POSTGRES_DB=otero
POSTGRES_PORT=5432

# 对象存储：filesystem | s3（R2 等）
STORAGE_TYPE=s3
S3_ENDPOINT=<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_PORT=443
S3_USE_SSL=true
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=otero-pdfs
S3_REGION=auto
S3_CREATE_BUCKET=false

# MinerU
OTERO_MINERU_TOKEN=
# OTERO_MINERU_TOKEN_2=          # extra keys; rotate on 429 / quota
# OTERO_MINERU_TOKENS=tokA,tokB  # or a comma-separated pool
OTERO_MINERU_MODEL=vlm
OTERO_MINERU_POLL_MS=15000
OTERO_MINERU_MAX_CONCURRENT=3
OTERO_MINERU_BATCH_SIZE=200

# LLM（校准 / 抽取 / 对话）
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-v4-flash

# 钱包编辑白名单（逗号分隔）与 JWT
OTERO_EDITOR_WHITELIST=0x...
OTERO_AUTH_SECRET=change-me-in-production

# 服务监听（本地开发）
OTERO_PORT=3000
OTERO_HOST=127.0.0.1
```

> `.env` 已在 `.gitignore` 中，勿提交真实密钥。R2 请使用 **S3 API 端点**（`*.r2.cloudflarestorage.com`），不要用公共自定义域名。

## 安装与运行

### 本地开发

```bash
docker compose up -d postgres   # 或自备 PostgreSQL
cp .env.example .env            # 填 DATABASE_URL、存储与 Token
npm install
npm run migrate                 # 应用 schema.postgres.sql
npm run seed                    # itemTypes / fields / creatorTypes（幂等）
npm run serve                   # API +（若已 build）Web，默认 127.0.0.1:3000
```

前端热更新：

```bash
cd web && npm install && npm run dev
# http://127.0.0.1:5173 ，/api 与 /health 代理到 :3000
```

生产前端：`cd web && npm run build`，后端以 SPA fallback 托管 `web/dist/`。

测试：`DATABASE_URL=... npm test`（不会 TRUNCATE 业务表）。

### Docker（一键）

```bash
# 根目录准备好 .env（含 S3/R2、MinerU、AUTH 等；compose 会覆盖 DATABASE_URL 指向服务名 postgres）
docker compose up -d --build
# 宿主访问 http://localhost:4321 （映射容器 3000）
```

`./data` 挂载到容器 `/app/data`（含 `postgres/` 与可选 `storage/`）。入口脚本会先 `migrate` + `seed` 再启动。

### 生产部署（Docker 镜像）

服务器只需 Docker Engine + Docker Compose，**不需要 Node.js、不需要 clone 源码或在本地构建**，但需要**自备一个可访问的 PostgreSQL 16+**（schema v6，应用启动时自动迁移）。GitHub Actions 会把多架构镜像（`linux/amd64` + `linux/arm64`）推送到 Docker Hub 的 `sitdownkevin/otero`；服务器按自身架构自动拉取。

```bash
mkdir -p /opt/otero && cd /opt/otero
curl -fsSLO https://raw.githubusercontent.com/TJ-IS/otero/main/docker-compose.prod.yml
curl -fsSL https://raw.githubusercontent.com/TJ-IS/otero/main/.env.prod.example -o .env
chmod 600 .env
# 编辑 .env：至少填写 DATABASE_URL、OTERO_AUTH_SECRET 及各项外部服务密钥
docker compose -f docker-compose.prod.yml up -d
```

- 数据库：不在 compose 内，由 `.env` 的 `DATABASE_URL` 指向你自备的 PostgreSQL（同机可用 `host.docker.internal`）。
- 数据卷：`./data` 用于 filesystem 存储与运行时数据（不含数据库）。
- 迁移：入口脚本在容器启动时自动执行 `migrate` + `seed`，无需手动操作。
- 升级：`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`。
- 回滚：在 `.env` 中把 `OTERO_IMAGE_TAG` 固定/改回具体版本（如 `1.2.3` 或 `sha-<短 SHA>`；git tag `v1.2.3` 对应的镜像标签是 `1.2.3`）后重新 `pull` + `up -d`。

完整步骤（首次部署、升级、备份、回滚注意事项）见 [`docs/deploy.md`](docs/deploy.md)。

## 使用方式

### CLI

```bash
npm run cli -- import path/to/a.pdf path/to/b.pdf
npm run cli -- list
npm run cli -- list --type journalArticle
npm run cli -- parse <ITEM_KEY> --wait
npm run cli -- parse-all
npm run cli -- parse-status
npm run cli -- serve --port 3000
```

### 批量入库（DOI 文件名）

```bash
# 默认扫描 data/downloads/{unpaywall,scihub}；文件名 = DOI 且 '/' → '_'
node scripts/import-downloads-to-db.mjs
node scripts/import-downloads-to-db.mjs --dir /path/to/pdfs --concurrency 4
node scripts/import-downloads-to-db.mjs --dry-run
```

### 全文解析

- Web：条目详情「解析全文」，或 MineruTaskLog 批量提交 / 重试失败项。
- API：`POST /api/fulltext/parse-batch`、`POST /api/items/:key/fulltext/parse`。
- Worker 按 `OTERO_MINERU_POLL_MS` 轮询并下载结果到当前存储后端。

### Web 路由

| 路径 | 说明 |
|------|------|
| `/` | 文献库 |
| `/search` | 检索 |
| `/items/:key` | 条目详情 |
| `/dashboard` | 概览 / 期刊 / 时间线 |
| `/dashboard/authors`、`/authors/:id` | 作者图谱与详情 |
| `/dashboard/merkle` | Merkle 视图 |

## REST API（摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET/POST | `/api/auth/nonce`、`/verify`、`/me` | 钱包登录 |
| GET/POST/PATCH/DELETE | `/api/items…` | 条目 CRUD、导出、附件列表 |
| POST | `/api/import/pdf` | multipart 上传 PDF |
| GET | `/api/journals` | 期刊 + 待归档计数 |
| GET | `/api/authors/graph`、`/api/authors/:id` | 作者 |
| GET | `/api/stats/*` | overview、doi-coverage、years、journals、fulltext、ingestion… |
| GET/POST/DELETE | `/api/fulltext…`、`/api/items/:key/fulltext…` | 全文队列与内容 |
| GET | `/api/attachments/:key/file` | 短时签名 PDF 流（需 `exp`+`sig`） |
| GET | `/api/attachments/:key/fulltext/*` | 全文静态资源 |
| POST | `/api/items/:key/calibrate`、`/extract`、`/chat`、`/crossref` | LLM / Crossref |
| GET/POST | `/api/merkle/*` | root / exists / verify / rebuild |
| — | `/api/collections` | 集合 CRUD |

写操作需编辑者 JWT（`Authorization: Bearer …`）；未登录可读。

## Agent Skill

外部 Agent 通过 skills CLI 安装只读 Open API skill（必须带协议前缀，裸域名会被当成 GitHub 仓库）：

```bash
npx skills add https://ais-basket.xyz
npx skills update
```

发现索引：`GET /.well-known/agent-skills/index.json`。实时正文：`GET /api/open/v1/SKILL.md`。页面说明见 `/docs/agents`。自托管实例把 origin 换成自己的站点即可。

## 设计文档

- [`docs/zotero-data-format-analysis.md`](docs/zotero-data-format-analysis.md) — Zotero EAV / 存储模型分析（Otero schema 的设计依据）
- [`docs/zotero-pdf-metadata-extraction.md`](docs/zotero-pdf-metadata-extraction.md) — Zotero PDF 识别流水线；文末对照 Otero 实现
- [`transfer/RESTORE.md`](transfer/RESTORE.md) — 当前栈下的备份与恢复说明（`transfer/` 目录本身 gitignore）

## 备份与数据

| 组件 | 位置 | 备份建议 |
|------|------|----------|
| 元数据 | PostgreSQL（本地 compose 为 `data/postgres/`；生产为自备实例） | `pg_dump` / `pg_restore` |
| PDF + 全文 | R2 bucket，或 `data/storage/`（filesystem） | R2 侧版本/复制；本地则打包 `data/storage` |

历史「SQLite + 本地 MinIO」迁移脚本与文档已移除；勿再按旧流程操作。
