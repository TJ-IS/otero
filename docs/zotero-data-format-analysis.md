# Zotero 文献存储数据格式分析

> 基于 `deps/zotero` 源码分析（核心定义：`chrome/content/zotero/xpcom/data/` + `resource/schema/`）

---

## 一、核心数据模型架构

**继承链：** `Zotero.DataObject` → `Zotero.Item`

Zotero 采用 **实体-属性-值（EAV）** 模式存储文献字段，而非扁平化的大表。这种设计灵活支持不同文献类型拥有不同的字段集。

---

## 二、Item 对象完整结构

### 2.1 基础属性（继承自 DataObject）

| 属性 | 类型 | 说明 |
|------|------|------|
| `_id` | Integer | 数据库主键 (itemID) |
| `_libraryID` | Integer | 所属文库 |
| `_key` | String | 文库级别唯一 key（8字符） |
| `_dateAdded` / `_dateModified` | String | 时间戳 |
| `_version` | Integer | 同步版本号 |
| `_synced` | Boolean/null | 同步状态 |
| `_parentID` / `_parentKey` | Integer/String | 父条目 ID（笔记/附件用） |
| `_deleted` | Boolean | 回收站状态 |
| `_relations` | Array | `[[predicate, object], ...]` |
| `_identified` | Boolean | ID/key 是否已设置 |
| `_loaded` / `_changed` | Object | 数据加载和变更追踪 |

### 2.2 Item 专有属性

| 属性 | 说明 |
|------|------|
| `_itemTypeID` | 条目类型 ID |
| `_createdByUserID` | 创建者（群组文库） |
| `_lastModifiedByUserID` | 最后修改者（群组文库） |
| `_firstCreator` / `_sortCreator` | 计算得出的 Creator 显示名/排序名 |
| `_creators` | `[{firstName, lastName, fieldMode, creatorTypeID}]` |
| `_itemData` | `{ fieldID: value }` 字段键值对 |
| `_tags` | `[{tag, type}]` (type: 0=手动, 1=自动) |
| `_collections` | 所属集合 ID 数组 |
| `_attachments` / `_notes` | 子附件/笔记 ID 数组 |
| `_noteTitle` / `_noteText` | 笔记标题和 HTML 内容 |
| `_displayTitle` | 计算得出的显示标题 |
| `_inPublications` | "我的发表" 标记 |

### 2.3 附件相关属性

| 属性 | 说明 |
|------|------|
| `_attachmentCharset` | 字符编码 |
| `_attachmentLinkMode` | 链接模式（0-4） |
| `_attachmentContentType` | MIME 类型 |
| `_attachmentPath` | 文件路径 |
| `_attachmentSyncState` | 文件同步状态 |
| `_attachmentSyncedModificationTime` | 文件修改时间戳 |
| `_attachmentSyncedHash` | MD5 哈希 |
| `_attachmentLastRead` | 最后读取时间 |

### 2.4 标注（Annotation）属性

| 属性 | 说明 |
|------|------|
| `_annotationType` | 类型：highlight / underline / note / image / ink |
| `_annotationAuthorName` | 标注作者 |
| `_annotationText` | 高亮/下划线文本 |
| `_annotationImage` | 图片/手写标注的二进制数据 |
| `_annotationComment` | 用户批注 |
| `_annotationColor` | 颜色 hex 值 |
| `_annotationPageLabel` | 页码标签 |
| `_annotationSortIndex` | 排序键 |
| `_annotationPosition` | JSON 位置数据 |
| `_annotationIsExternal` | 外部标注标记 |

### 2.5 主要字段列表（`items.js` primary fields）

```
itemID, itemTypeID, dateAdded, dateModified, libraryID, key, version, synced,
createdByUserID, lastModifiedByUserID, firstCreator, sortCreator, deleted,
inPublications, parentID, parentKey,
attachmentCharset, attachmentLinkMode, attachmentContentType, attachmentPath,
attachmentSyncState, attachmentSyncedModificationTime, attachmentSyncedHash,
attachmentLastProcessedModificationTime, attachmentLastRead
```

---

## 三、35 种条目类型

**完整列表：**

```
artwork          音频/艺术作品
audioRecording   录音
bill             法律草案
blogPost         博客文章
book             书籍
bookSection      书籍章节
case             法庭判例
computerProgram  计算机程序
conferencePaper  会议论文
dataset          数据集
dictionaryEntry  词条
document         通用文档
email            电子邮件
encyclopediaArticle 百科全书条目
film             电影
forumPost        论坛帖子
hearing          听证会
instantMessage   即时消息
interview        访谈
journalArticle   期刊论文
letter           信件
magazineArticle  杂志文章
manuscript       手稿
map              地图
newspaperArticle 报纸文章
patent           专利
podcast          播客
preprint         预印本
presentation     演示文稿
radioBroadcast   广播
report           报告
standard         标准
statute          法规
thesis           学位论文
tvBroadcast      电视广播
videoRecording   视频录制
webpage          网页
```

**特殊内置类型**（不可通过 UI 直接创建）：

| 类型 | 说明 |
|------|------|
| `attachment` | 文件附件（PDF、网页快照等） |
| `note` | 笔记 |
| `annotation` | PDF/阅读器标注 |
| `webpage` | 网页（隐藏在新条目菜单中） |

---

## 四、121 个字段与基字段映射

### 4.1 通用字段（跨多种条目类型可用）

```
title, date, DOI, ISBN, ISSN, PMCID, PMID, abstractNote, accessDate,
url, language, rights, pages, volume, issue, edition, series,
seriesNumber, seriesTitle, seriesText, shortTitle, callNumber,
archive, archiveLocation, libraryCatalog, extra, label,
publicationTitle, place, publisher, type
```

### 4.2 完整字段列表

```
DOI, ISBN, ISSN, PMCID, PMID, abstractNote, accessDate, applicationNumber,
archive, archiveID, archiveLocation, artworkMedium, artworkSize, assignee,
audioFileType, audioRecordingFormat, billNumber, blogTitle, bookTitle,
callNumber, caseName, citationKey, code, codeNumber, codePages, codeVolume,
committee, company, conferenceName, country, court, date, dateDecided,
dateEnacted, dictionaryTitle, distributor, docketNumber, documentNumber,
edition, encyclopediaTitle, episodeNumber, eventPlace, extra, filingDate,
firstPage, format, forumTitle, genre, history, identifier, institution,
interviewMedium, issue, issueDate, issuingAuthority, journalAbbreviation,
label, language, legalStatus, legislativeBody, letterType, libraryCatalog,
manuscriptType, mapType, meetingName, nameOfAct, network, numPages, number,
numberOfVolumes, organization, originalDate, originalPlace, originalPublisher,
pages, partNumber, partTitle, patentNumber, place, postType, presentationType,
priorityDate, priorityNumbers, proceedingsTitle, programTitle,
programmingLanguage, publicLawNumber, publicationTitle, publisher, references,
reportNumber, reportType, reporter, reporterVolume, repository,
repositoryLocation, rights, runningTime, scale, section, series, seriesNumber,
seriesText, seriesTitle, session, sessionTitle, shortTitle, status, studio,
subject, system, thesisType, title, type, university, url, versionNumber,
videoRecordingFormat, volume, websiteTitle, websiteType
```

### 4.3 基字段映射机制（Base Field Mapping）

不同条目类型对同一语义的字段使用不同名称，`baseFieldMappings` 表负责统一映射：

| 基字段 | 映射到 |
|--------|--------|
| `publisher` | `label`（录音）、`company`（软件）、`distributor`（电影）、`institution`（手稿/报告）、`network`（广播/电视）、`studio`（视频）、`university`（论文）、`repository`（数据集/预印本） |
| `publicationTitle` | `blogTitle`、`bookTitle`、`dictionaryTitle`、`encyclopediaTitle`、`forumTitle`、`proceedingsTitle`、`programTitle`、`sessionTitle`、`websiteTitle` |
| `place` | `eventPlace`、`place`、`repositoryLocation` |
| `type` | `artworkMedium`、`audioRecordingFormat`、`interviewMedium`、`manuscriptType`、`mapType`、`postType`、`presentationType`、`reportType`、`thesisType`、`videoRecordingFormat`、`websiteType`、`genre`、`format`、`letterType`、`legalStatus` |

### 4.4 字段格式化验证

| 验证 | 说明 |
|------|------|
| `isDate(field)` | 日期类型字段，存储为多部分日期 |
| `isInteger(field)` | 整数字段 |
| `isMultiline(field)` | 多行字段：`abstractNote`、`extra` |
| `isAutocomplete(field)` | 自动补全字段（大量预定义值的字段） |

---

## 五、Creator 数据结构

### 5.1 内部存储格式

```javascript
{
  firstName: "John",      // 名
  lastName: "Smith",      // 姓（fieldMode=1 时存全名）
  fieldMode: 0,           // 0=姓名分栏, 1=单栏（机构作者）
  creatorTypeID: 1        // FK to creatorTypes
}
```

### 5.2 API JSON 格式

```javascript
// 双栏模式（fieldMode=0）
{ firstName: "John", lastName: "Smith", creatorType: "author" }

// 单栏模式（fieldMode=1）
{ name: "Some Institution", creatorType: "author" }
```

### 5.3 36 种 Creator 类型

```
author, bookAuthor, editor, seriesEditor, translator, contributor,
artist, performer, composer, wordsBy, originalCreator, programmer,
director, castMember, guest, host, narrator, producer, scriptwriter,
seriesCreator, executiveProducer, podcaster, interviewee, interviewer,
recipient, reviewedAuthor, counsel, attorneyAgent, inventor, sponsor,
cosponsor, chair, creator, organizer, presenter, cartographer, commenter
```

### 5.4 各条目类型的主 Creator

| 条目类型 | 主 Creator |
|----------|-----------|
| book | author |
| artwork | artist |
| audioRecording | performer |
| film | director |
| interview | interviewee |
| letter | author |
| podcast | podcaster |
| presentation | presenter |
| computerProgram | programmer |
| tvBroadcast / radioBroadcast | presenter |

---

## 六、集合（Collection）结构

```javascript
// 内部数据模型
{
  _id: null,              // collectionID
  _libraryID: null,
  _key: null,             // 8字符唯一键
  _dateAdded: null,
  _dateModified: null,
  _version: null,
  _name: null,            // 集合名称
  _parentID: null,        // 父集合（false 表示顶级）
  _deleted: null,
  _childCollections: Set,   // 子集合 ID
  _childItems: Set,         // 子条目 ID
  _relations: []
}

// API JSON 格式
{
  key: "ABC12345",
  version: 0,
  name: "集合名称",
  parentCollection: false | "parentKey",  // 支持嵌套层级
  relations: {},
  meta: { numCollections: 2, numItems: 15 }
}
```

**数据库表：**
- `collections`（collectionID, collectionName, parentCollectionID, libraryID, key, version, synced）
- `collectionItems`（collectionID, itemID, orderIndex）

---

## 七、标签（Tag）结构

```javascript
// 最小格式
{ tag: "深度学习" }

// 完整格式
{ tag: "深度学习", type: 0 }   // 0=手动标签（默认）
{ tag: "深度学习", type: 1 }   // 1=自动标签
```

**处理逻辑：** 标签名会做 trim + Unicode 归一化。最大长度 255 字符。

**数据库表：** `tags`（tagID, name）+ `itemTags`（itemID, tagID, type）

---

## 八、笔记、附件与标注

### 8.1 笔记（Note）

- `itemType == 'note'`
- 通过 `parentID` / `parentKey` 关联到父条目
- 内容存储为 HTML：
  ```html
  <div class="zotero-note znv1">笔记内容...</div>
  ```
- 默认空笔记：`<div class="zotero-note znv1"></div>`
- 数据库表：`itemNotes`（itemID, parentItemID, note TEXT, title TEXT）

### 8.2 附件（Attachment）

- `itemType == 'attachment'`

**链接模式（LinkMode）：**

| 常量 | 值 | 说明 |
|------|----|------|
| `LINK_MODE_IMPORTED_FILE` | 0 | 文件存储于 Zotero 存储目录 |
| `LINK_MODE_IMPORTED_URL` | 1 | 网页快照存储在 Zotero |
| `LINK_MODE_LINKED_FILE` | 2 | 外部链接文件 |
| `LINK_MODE_LINKED_URL` | 3 | 仅 URL 链接 |
| `LINK_MODE_EMBEDDED_IMAGE` | 4 | 嵌入笔记中的图片 |

**常用类型检测：**

| 方法 | 说明 |
|------|------|
| `isImportedAttachment()` | LINK_MODE_IMPORTED_FILE 或 IMPORTED_URL |
| `isStoredFileAttachment()` | 已导入附件或嵌入图片 |
| `isFileAttachment()` | 非 LINK_MODE_LINKED_URL |
| `isPDFAttachment()` | content-type = application/pdf |
| `isSnapshotAttachment()` | LINK_MODE_IMPORTED_URL + text/html |
| `isEPUBAttachment()` | content-type = application/epub+zip |
| `isImageAttachment()` | content-type 以 image/ 开头 |
| `isLinkedFileAttachment()` | LINK_MODE_LINKED_FILE |
| `isWebAttachment()` | 任何非文件的链接模式 |
| `isEmbeddedImageAttachment()` | LINK_MODE_EMBEDDED_IMAGE |

### 8.3 标注（Annotation）

- `itemType == 'annotation'`
- 父条目必须是文件附件（如 PDF 附件）

**标注类型：** highlight, underline, note, image, ink

**完整属性：**

```javascript
{
  annotationType: "highlight",       // 标注类型
  authorName: "用户名",               // 标注作者
  text: "被高亮的原文文本",           // 高亮文本
  image: <binary>,                    // 图片/手写数据
  comment: "用户的批注文字",          // 批注
  color: "#ffd400",                   // 颜色 hex
  pageLabel: "42",                    // 页码标签
  sortIndex: "0_0",                   // 排序索引
  position: {...},                    // JSON 位置数据
  isExternal: false                   // 是否外部标注
}
```

**数据库表：** `itemAnnotations`（itemID, parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal）

---

## 九、关系（Relations）系统

- 内部存储：`[[predicate, object], ...]`
- API 格式：`{ predicate: [uri, ...] }`
- 主要谓词：`dc:relation`（条目间关联）
- 数据库表：`itemRelations`、`collectionRelations`

---

## 十、数据库架构总览

### 10.1 完整表结构

| 类别 | 表名 | 说明 |
|------|------|------|
| **模式定义** | `itemTypes` | 条目类型定义 |
| | `fields` | 字段定义 |
| | `itemTypeFields` | 条目类型 ↔ 字段关联 |
| | `baseFieldMappings` | 基字段映射 |
| | `creatorTypes` | Creator 类型定义 |
| | `itemTypeCreatorTypes` | 条目类型 ↔ Creator 类型关联 |
| **核心数据** | `items` | 条目主表 |
| | `itemData` | 条目字段值（EAV：itemID + fieldID → valueID） |
| | `itemDataValues` | 字段值的唯一字符串存储 |
| | `creators` | 创作者唯一名称 |
| | `itemCreators` | 条目 ↔ 创作者关联 |
| **组织** | `collections` | 集合定义（支持父子层级） |
| | `collectionItems` | 集合 ↔ 条目关联（含排序） |
| **标签** | `tags` | 标签定义 |
| | `itemTags` | 条目 ↔ 标签关联（含类型） |
| **笔记/附件/标注** | `itemNotes` | 笔记内容 |
| | `itemAttachments` | 附件元数据 |
| | `itemAnnotations` | 标注数据 |
| **关系** | `itemRelations` | 条目间关系 |
| | `collectionRelations` | 集合间关系 |
| **全文搜索** | `fulltextItems` | 全文索引条目 |
| | `fulltextWords` | 分词 |
| | `fulltextItemWords` | 词 → 条目映射 |
| **其他** | `groupItems` | 群组文库用户追踪 |
| | `deletedItems` / `deletedCollections` | 回收站 |
| | `settings` / `version` | 系统元数据 |

### 10.2 EAV 存储模式详解

```
itemData 表结构：
+---------+----------+---------+
| itemID  | fieldID  | valueID |
+---------+----------+---------+
| 1       | 58       | 1001    |  →  itemDataValues(1001) = "2024"
| 1       | 110      | 1002    |  →  itemDataValues(1002) = "Machine Learning"
| 2       | 58       | 1003    |  →  itemDataValues(1003) = "2023"
| 2       | 26       | 1004    |  →  itemDataValues(1004) = "10.1000/xyz"
+---------+----------+---------+
```

- `fieldID` 引用 `fields` 表
- `valueID` 引用 `itemDataValues` 表（去重存储，节省空间）
- 不同条目类型有不同的有效 fieldID 集合，定义在 `itemTypeFields` 表

---

## 十一、验证规则总结

### 11.1 字段验证（`item.js setField()`）

- 空值归约为 `false`
- 非多行字段的换行符被删除
- ISBN 自动添加连字符
- 日期存储为多部分日期
- `accessDate` 验证为 SQL 日期/时间

### 11.2 Creator 验证（`creators.js cleanData()`）

- 必须有 `name` 或 `firstName + lastName`，不能同时有
- `fieldMode=1` 表示单栏模式（机构作者）
- 名称 trim 并做 Unicode 归一化

### 11.3 父子关系约束

- 附件父条目必须为普通文献（嵌入图片的父可为笔记）
- 标注父条目必须为文件附件
- 笔记父条目必须为普通文献

### 11.4 条目类型变更

- 普通类型 ↔ 特殊类型（attachment/note/annotation）之间不可转换
- 基字段映射会被保留

---

## 十二、关键源码文件索引

| 文件 | 内容 |
|------|------|
| `chrome/content/zotero/xpcom/data/item.js` | Zotero.Item 核心类（~6370行） |
| `chrome/content/zotero/xpcom/data/items.js` | Zotero.Items 集合管理 |
| `chrome/content/zotero/xpcom/data/itemFields.js` | 字段元数据和验证 |
| `chrome/content/zotero/xpcom/data/cachedTypes.js` | 条目类型和 Creator 类型定义 |
| `chrome/content/zotero/xpcom/data/creators.js` | Creator 数据管理 |
| `chrome/content/zotero/xpcom/data/tags.js` | 标签管理 |
| `chrome/content/zotero/xpcom/data/collection.js` | Zotero.Collection |
| `chrome/content/zotero/xpcom/data/collections.js` | Zotero.Collections 管理 |
| `chrome/content/zotero/xpcom/data/notes.js` | 笔记管理 |
| `chrome/content/zotero/xpcom/data/dataObject.js` | DataObject 基类 |
| `chrome/content/zotero/xpcom/data/attachments.js` | 附件常量和方法 |
| `chrome/content/zotero/xpcom/schema.js` | Schema 管理 |
| `resource/schema/userdata.sql` | 用户数据表定义 |
| `resource/schema/system.sql` | 系统表定义 |
| `test/tests/data/itemJSON.js` | 所有条目类型的完整 JSON 示例 |
| `chrome/locale/en-US/zotero/schema.ftl` | Schema 本地化字符串 |
