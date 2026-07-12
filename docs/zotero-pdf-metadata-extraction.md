# Zotero PDF 元信息提取流程分析

> **文档角色**：设计参考。梳理 Zotero 导入 PDF 后的识别流水线。  
> **Otero 现状**：不调用 Zotero Recognizer / Translator；用自研流水线（见文末对照表）。元数据在 PostgreSQL，PDF/全文在 filesystem 或 R2。

## 概述

上传 PDF 后，Zotero 通过以下流水线提取文献元信息：

```
用户操作 (拖拽/导入/右键识别)
  │
  ├─ 创建附件条目 (attachments.js)
  ├─ 全文索引 (fulltext.js)
  │
  └─ 自动识别 (recognizeDocument.js)
       │
       ├─ 1. PDF 文本提取 (PDF Worker / PDF.js)
       ├─ 2. 云端识别 (Zotero Recognizer Service)
       └─ 3. 元数据解析 (Translator 框架)
```

---

## 阶段一：入口

| 入口 | 文件 | 关键函数 |
|------|------|----------|
| 拖拽到条目树 | `chrome/content/zotero/collectionTree.jsx` | `onDrop()` → `Zotero.Attachments.importFromFile()` |
| 文件 > 导入 | `chrome/content/zotero/fileInterface.js` | `importFile()` |
| 右键"创建父条目" | `chrome/content/zotero/zoteroPane.js` | `createParentItemsFromSelected()` |
| 右键"识别文献" | `chrome/content/zotero/zoteroPane.js` | `recognizeSelected()` |
| 浏览器连接器 | `xpcom/server/server_connector.js` | `handle()` |

创建附件后自动触发：

```javascript
Zotero.RecognizeDocument.autoRecognizeItems(addedItems);
```

---

## 阶段二：PDF 文本提取

**核心文件：** `xpcom/recognizeDocument.js`、`xpcom/pdfWorker/manager.js`

```
_recognizePDF(item)
  → extractPDFJSON(item.id)
    → Zotero.PDFWorker.getRecognizerData(itemID)
      → postMessage 发送给 Web Worker (document-worker/worker.js)
        → Worker 使用 PDF.js 解析 PDF，逐页提取文本和布局
      ← 返回 JSON: { pages: [{ page: 1, text: "..." }, ...] }
```

PDF Worker 提供的核心方法：

| 方法 | Worker Action | 用途 |
|------|--------------|------|
| `getRecognizerData(itemID)` | `pdf.getRecognizerData` | 提取文本 + 元数据供 recognizer 服务 |
| `getFullText(itemID, maxPages)` | `pdf.getFulltext` | 提取全文用于全文索引 |
| `import(itemID)` | `pdf.importAnnotations` | 读取 PDF 内嵌批注 |
| `export(itemID, path)` | `pdf.writeAnnotations` | 将批注写回 PDF |

提取流程：

1. `IOUtils.read(path)` → `Uint8Array.buffer`
2. 通过 `postMessage` 发送给 Worker
3. Worker 用 PDF.js 逐页解析文本
4. 结果通过 `postMessage` 返回主线程

---

## 阶段三：云端识别

**核心文件：** `xpcom/recognizeDocument.js`

```javascript
_query(json)
  → POST {baseURL}recognize/
  ← 返回结构化元数据
```

请求的 Base URL 由 `_getBaseURL()` 确定：

- 优先使用 `Zotero.Prefs.get("recognize.url")`（自定义 URL）
- 否则使用 `Zotero.Prefs.get("services.url") || ZOTERO_CONFIG.SERVICES_URL` + `"recognizer/"`

服务器返回的 JSON 示例：

```json
{
  "arxiv": "1234.56789",
  "doi": "10.1234/example",
  "isbn": "978-0-123-45678-9",
  "title": "论文标题",
  "authors": [{ "firstName": "三", "lastName": "张" }],
  "abstract": "摘要内容...",
  "year": "2024",
  "pages": "123-456",
  "volume": "42",
  "issue": "3",
  "container": "期刊名称",
  "publisher": "出版社",
  "url": "https://...",
  "language": "en",
  "ISSN": "1234-5678",
  "type": "journalArticle"
}
```

---

## 阶段四：元数据解析（优先级顺序）

在 `_recognizePDF()` 中按以下优先级尝试解析：

### 1. arXiv ID

若 `res.arxiv` 存在：

```javascript
let search = new Zotero.Translate.Search();
search.setIdentifier({ arXiv: res.arxiv });
// search → 找到 translator → translate → 获取完整元数据
```

### 2. DOI

若 `res.doi` 存在：

```javascript
let search = new Zotero.Translate.Search();
search.setIdentifier({ DOI: res.doi });
// search → 找到 translator (如 CrossRef) → translate → 获取完整元数据
```

### 3. ISBN

若 `res.isbn` 存在：

```javascript
let search = new Zotero.Translate.Search();
search.setIdentifier({ itemType: 'book', ISBN: res.isbn });
search.translate({ libraryID: false }); // 先不保存，仅获取数据
// 获取后手动创建条目
```

### 4. 标题+作者（兜底）

若上面三种标识符都没有，直接用 recognizer 返回的字段创建条目：

```javascript
// 使用 res.title, res.authors, res.abstract,
// res.year, res.pages, res.volume, res.container 等
```

---

## 阶段五：全文索引与撤回检测

### 全文索引

在创建附件后，`_postProcessFile()` 调用 `Zotero.Fulltext.indexItems()`：

- 通过 PDF Worker 的 `getFullText()` 提取全文
- 分词后存入数据库全文索引表
- 供 Zotero 搜索功能使用

### 撤回检测

**核心文件：** `xpcom/retractions.js`

1. `init()` 时从 Zotero 服务器下载 DOI/Prefix 映射列表
2. 监听条目 `add`/`modify` 事件
3. 检查条目的 DOI/PMID 是否匹配撤回列表
4. 匹配规则：先匹配前缀，再匹配完整 DOI/PMID
5. 撤回信息存入 `retractedItems` 数据库表
6. 在 Zotero 界面显示撤回警告横幅
7. 引用时自动显示撤回提示

---

## 关键文件清单

| 文件路径 | 作用 |
|----------|------|
| `chrome/content/zotero/xpcom/recognizeDocument.js` | **核心**：调度 PDF/EPUB 文本提取、调用 recognizer 服务、按标识符解析元数据 |
| `chrome/content/zotero/xpcom/pdfWorker/manager.js` | PDF Worker 管理，与 document-worker 子模块通信 |
| `chrome/content/zotero/xpcom/attachments.js` | 附件创建、文件管理、`_postProcessFile()` |
| `chrome/content/zotero/xpcom/fulltext.js` | 全文索引：提取 PDF 全文、分词、缓存 |
| `chrome/content/zotero/xpcom/retractions.js` | 撤回检测：DOI/PMID 匹配、用户提醒 |
| `chrome/content/zotero/xpcom/translation/translators.js` | Translator 管理：加载和缓存 web translator |
| `chrome/content/zotero/xpcom/translation/translate_item.js` | 翻译结果的条目保存器 |
| `chrome/content/zotero/xpcom/translation/translate_firefox.js` | Firefox 特定 DOM 封装 |
| `chrome/content/zotero/xpcom/data/item.js` | 条目模型：`isPDFAttachment()`、`setAutoAttachmentTitle()` |
| `chrome/content/zotero/collectionTree.jsx` | 拖拽入口 |
| `chrome/content/zotero/zoteroPane.js` | UI 入口：`recognizeSelected()`、`createParentItemsFromSelected()` |
| `chrome/content/zotero/zotero.mjs` | 模块加载器 |
| `defaults/preferences/zotero.js` | 默认配置：`autoRecognizeFiles`、`autoRenameFiles` 等 |
| `document-worker/` (子模块) | PDF.js 解析器的 Worker 封装 |
| `translators/` (子模块) | 760+ web translator |

---

## 配置项

| 偏好设置 | 默认值 | 说明 |
|----------|--------|------|
| `extensions.zotero.autoRecognizeFiles` | `true` | 导入 PDF 时是否自动识别元数据 |
| `extensions.zotero.autoRenameFiles` | — | 识别后是否自动重命名文件 |

---

## Otero 对应实现（当前）

Otero 借鉴「本地抽文本 → 标识符 → 外部元数据源」的思路，但实现完全独立：

```
导入入口（CLI / POST /api/import/pdf / scripts/import-downloads-to-db.mjs）
  │
  ├─ storageService.storeFile → filesystem 或 R2（S3）
  ├─ pdfParser（pdfjs-dist）抽取内嵌元数据与首页文本
  ├─ recognizers：CrossRef / arXiv / OpenLibrary（按 DOI、arXiv ID、ISBN）
  ├─ metadataMapper → Item + Attachment 写入 PostgreSQL
  │
  └─ 全文（可选，异步）
       └─ MinerU 批次 + fulltextWorker → Markdown / 图片写入同一存储后端
```

| 步骤 | Otero 代码 |
|------|------------|
| 导入编排 | `src/services/importService.js` |
| PDF 解析 | `src/services/pdfParser.js` |
| 外部识别 | `src/services/recognizers/*` |
| 字段映射 | `src/services/metadataMapper.js` |
| 对象读写 | `src/services/storageService.js`、`s3Client.js` |
| 全文 | `src/services/fulltextService.js`、`mineruService.js`、`fulltextWorker.js` |
| 批量 DOI 入库 | `scripts/import-downloads-to-db.mjs` |

可选增强（非 Zotero 路径）：`calibrateService` / `extractService` / `crossrefEnrichService` / `chatService` 用 LLM 或 Crossref 再补全。
