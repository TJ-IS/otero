# Otero

面向 **AIS Senior Scholars' Basket of Journals**（信息系统协会资深学者推荐期刊列表，共 11 本）的文献收录与全文管理系统。基于 Zotero 风格的 EAV 数据模型，使用纯 JavaScript + PostgreSQL 存储元数据，配合 MinerU 进行 PDF 全文解析，并提供 Web 界面进行浏览、检索与导出。

## 收录期刊

系统通过内置白名单（`src/services/journalWhitelist.js`）对入库文献做**虚拟分类**：原始 `publicationTitle` 字段从不被改写，凡不在白名单内（或缺省）的条目在查询时归入"待归档"桶。

| # | 期刊名称 |
|---|----------|
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

- **EAV 数据模型**：仿 Zotero 的 `items` + `itemData` + `itemDataValues` 三层结构，灵活适配不同条目类型。
- **PDF 导入流水线**：抽取 PDF 内嵌元数据与首页文本，再向 CrossRef / arXiv / OpenLibrary 按 DOI / arXiv ID / ISBN 查询补全题录。
- **批量导入**：`import_all.mjs` 以并发方式批量入库一个目录下的全部 PDF，并输出 CSV 进度日志。
- **MinerU 全文解析**：调用 [MinerU](https://mineru.net) 将 PDF 转换为 Markdown + 图片资源，支持 200 文件/批的单次提交、配额感知、429 退避、失败重试。
- **后台轮询 Worker**：服务器启动后自动轮询 MinerU 批次状态，将完成结果下载解包并改写图片链接。
- **期刊分类侧栏**：按 11 本期刊 + "待归档"分组浏览，并显示各期刊条目计数。
- **全文阅读视图**：在条目详情中渲染解析得到的 Markdown，图片通过 `/api/attachments/:key/fulltext` 端点提供。
- **任务日志**：MineruTaskLog 弹窗查看解析队列状态（待提交 / 排队中 / 解析中 / 已完成 / 失败），支持批量重试失败项。
- **题录导出**：单条或批量导出为 BibTeX / RIS。
- **REST API**：完整支持 items / collections / tags / journals / fulltext / attachments 的增删改查。
- **Docker 部署**：多阶段构建，前端构建产物由后端静态托管，单容器即可运行。

## 技术栈

- **后端**：Node.js ≥ 20（ESM）、Express、pg（PostgreSQL）、pdfjs-dist、adm-zip、zod
- **前端**：Vite + React + shadcn/ui + Tailwind CSS
- **外部服务**：PostgreSQL、MinerU（全文解析）、DeepSeek/OpenAI 兼容 API（LLM）、CrossRef/arXiv/OpenLibrary（元数据识别）、可选 MinIO

## 目录结构

```
data/                 运行时数据（gitignored）
  storage/            文件系统模式下的 PDF / 全文（STORAGE_TYPE=filesystem）
src/                  后端（Node.js, ESM）
  db/                 connection（pg Pool）、schema.postgres.sql、migrate、seed
  models/             Item / Collection / Attachment
  repositories/       SQL 访问层（itemRepo / fulltextRepo / collectionRepo / …）
  services/           importService / pdfParser / recognizers / mineruService
                       fulltextService / fulltextWorker / journalWhitelist
                       metadataMapper / exportService / storageService
  api/                Express 服务器 + 路由
  cli/                commander 命令行入口
  utils/              key / doi / isbn 工具
  config.js           配置加载（.env + 默认值；DATABASE_URL 必填）
  index.js            服务器启动入口
scripts/              sqlite-to-pg.mjs 等运维脚本
web/                  前端（Vite + React + shadcn/ui）
docs/                 含 postgres-migration.md
deps/zotero/          Zotero 参考源码（git submodule）
Dockerfile            多阶段构建（前端 build + 后端运行）
docker-compose.yml    postgres + otero（可选）
```

## 环境变量

在项目根目录创建 `.env` 文件（参见 `src/config.js`）：

```env
# MinerU 全文解析
OTERO_MINERU_TOKEN="<your-mineru-bearer-token>"
OTERO_MINERU_MODEL=vlm
OTERO_MINERU_POLL_MS=15000
OTERO_MINERU_MAX_CONCURRENT=3
OTERO_MINERU_BATCH_SIZE=200

# LLM（可选，用于元数据补全等）
OPENAI_API_KEY="<your-api-key>"
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-v4-flash

# 服务器
OTERO_PORT=3000
OTERO_HOST=127.0.0.1

# PostgreSQL（必填）
DATABASE_URL=postgresql://otero:otero-secret-change-me@127.0.0.1:5432/otero
```

> ⚠️ `.env` 已在 `.gitignore` 中，切勿提交真实密钥。SQLite → PG 步骤见 [`docs/postgres-migration.md`](docs/postgres-migration.md)。

## 安装与运行

### 本地开发

```bash
docker compose up -d postgres   # 或自备 PostgreSQL
npm install
# 可选：从旧 SQLite 导入
# node scripts/sqlite-to-pg.mjs --wipe
npm run migrate   # 应用 schema.postgres.sql
npm run seed      # 写入 itemTypes / fields / creatorTypes
npm run serve     # 启动 API + Web（默认 127.0.0.1:3000）
```

前端（开发模式，热更新）：

```bash
cd web
npm install
npm run dev       # http://127.0.0.1:5173，/api 反向代理到 :3000
npm run build     # 生产构建到 web/dist，由后端静态托管
```

开发时同时运行后端 `npm run serve` 与前端 `npm run dev`；Vite 会把 `/api`、`/health` 代理到 `http://127.0.0.1:3000`。

生产部署时先 `cd web && npm run build`，再启动后端即可，后端会以 SPA fallback 方式提供 `web/dist/`。

### Docker

```bash
docker compose up -d --build
# 访问 http://localhost:3001
```

容器内 `/app/data` 为持久卷，挂载到宿主 `./data`。

## 使用方式

### 命令行

```bash
# 导入 PDF（自动识别元数据）
node src/cli/index.js import path/to/paper1.pdf path/to/paper2.pdf

# 列出条目
node src/cli/index.js list
node src/cli/index.js list --type journalArticle --tag "machine learning"

# 启动服务
node src/cli/index.js serve --port 3000
```

### 批量导入脚本

`import_all.mjs` 扫描一个目录下的全部 PDF 并并发入库，输出 CSV 进度日志：

```bash
# 修改脚本顶部的 PDF_DIR / CONCURRENCY / BATCH_LOG 后执行
node import_all.mjs
```

### 触发全文解析

- 在 Web 界面条目详情中点击"解析全文"，或在 MineruTaskLog 中批量提交。
- 调用 API：`POST /api/fulltext/parse-batch { "keys": ["KEY1", ...] }`。
- 后台 Worker 会按 `OTERO_MINERU_POLL_MS` 间隔轮询 MinerU 并下载结果。

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/items` | 列出条目（`?type=&journal=&collection=&search=`） |
| GET | `/api/items/export` | 批量导出（`?format=bibtex\|ris`） |
| GET | `/api/items/:key` | 条目详情 |
| GET | `/api/items/:key/export` | 单条导出（`?format=bibtex\|ris`） |
| PATCH | `/api/items/:key` | 更新字段 |
| DELETE | `/api/items/:key` | 软删除（`?permanent=true` 永久删除） |
| POST | `/api/import/pdf` | multipart 上传 PDF 并走识别流水线 |
| GET | `/api/journals` | 11 本期刊 + 待归档的条目计数 |
| GET | `/api/fulltext/pending` | 分页任务日志（`?filter=&page=&pageSize=`） |
| POST | `/api/fulltext/parse-batch` | 批量入队解析 |
| POST | `/api/fulltext/retry-failed` | 重试所有失败项 |
| POST | `/api/items/:key/fulltext/parse` | 单条触发解析（`?force=true`） |
| GET | `/api/items/:key/fulltext` | 读取全文（含 Markdown） |
| DELETE | `/api/items/:key/fulltext` | 删除全文结果 |
| GET | `/api/attachments/:key/fulltext/*` | 全文图片等静态资源 |
| — | `/api/collections` `/api/tags` | 集合与标签 CRUD |

## 设计文档

- `docs/zotero-data-format-analysis.md`：Zotero 数据格式分析。
- `docs/zotero-pdf-metadata-extraction.md`：PDF 元数据抽取设计。
