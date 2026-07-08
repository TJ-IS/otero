import fs from 'node:fs';
import path from 'node:path';
import { Item } from '../models/Item.js';
import { getDb } from '../db/connection.js';
import { getFullText } from './fulltextService.js';
import { config } from '../config.js';
import { itemTypeIdByName, itemNameById } from '../repositories/itemRepo.js';
import { JOURNAL_WHITELIST } from './journalWhitelist.js';

/**
 * LLM-based bibliographic metadata EXTRACTION from a parsed full text.
 *
 * Unlike calibrateService (which verifies *existing* metadata against the full
 * text and constrains publicationTitle to the AIS Basket), this service
 * *extracts* metadata from scratch — most unfiled items are sparse `document`
 * rows with no publicationTitle, so the goal is to pull the real journal name,
 * authors, DOI, year, volume/issue/pages, abstract etc. straight out of the
 * MinerU markdown. publicationTitle stores the REAL journal name; the virtual
 * classification in journalWhitelist naturally buckets non-Basket journals back
 * into "待归档" at query time, in line with the README's "original
 * publicationTitle is never rewritten" principle.
 */

// itemType names the LLM may suggest. Matches src/db/seed.js.
const ITEM_TYPES = [
  'journalArticle',
  'preprint',
  'book',
  'bookSection',
  'conferencePaper',
  'thesis',
  'report',
  'document',
];

/**
 * The bibliographic fields we ask the LLM to extract. These are common across
 * the scholarly item types; applyExtraction() filters to the allowed set for
 * the chosen itemType before writing.
 */
const TARGET_FIELDS = [
  'title',
  'abstractNote',
  'publicationTitle',
  'volume',
  'issue',
  'pages',
  'date',
  'DOI',
  'ISSN',
  'url',
  'language',
];

/**
 * List the field names allowed for a given itemType name.
 */
function allowedFieldsForType(itemTypeName) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT f.fieldName FROM itemTypeFields itf
    JOIN fields f ON f.fieldID = itf.fieldID
    JOIN itemTypes it ON it.itemTypeID = itf.itemTypeID
    WHERE it.typeName = ?
    ORDER BY itf.orderIndex
  `).all(itemTypeName);
  return rows.map(r => r.fieldName);
}

/**
 * Read the MinerU content_list.json for an item and extract the header/footer
 * text blocks (which contain the publisher stamp: DOI, journal name, volume,
 * issue, pages, year, ISSN). MinerU classifies these as header/footer and
 * EXCLUDES them from full.md, so the LLM never sees them unless we inject them.
 *
 * Returns { headerFooterText, doi } where doi is regex-extracted for reliability
 * (the LLM sometimes mangles DOIs).
 */
export function readHeaderFooterMetadata(key) {
  const dir = path.join(config.storageDir, key.slice(0, 2), key, 'fulltext');
  let contentListPath = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      // Prefer the v1 content_list.json (flat array). Skip the _v2 variant.
      if (f === 'content_list.json' || (f.endsWith('_content_list.json') && !f.endsWith('_v2.json'))) {
        contentListPath = path.join(dir, f);
        break;
      }
    }
  } catch { /* dir missing */ }
  if (!contentListPath) return { headerFooterText: '', doi: '' };

  let blocks;
  try { blocks = JSON.parse(fs.readFileSync(contentListPath, 'utf8')); }
  catch { return { headerFooterText: '', doi: '' }; }
  if (!Array.isArray(blocks)) return { headerFooterText: '', doi: '' };

  // Collect header/footer blocks from the first 2 pages — the publisher stamp
  // lives on page 0. Dedupe identical lines (headers repeat on every page).
  const seen = new Set();
  const lines = [];
  let doi = '';
  const DOI_RE = /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s)"']+)|\b(10\.\d{4,9}\/[^\s)"']+)/i;

  for (const b of blocks) {
    const t = b.type;
    if (t !== 'header' && t !== 'footer' && t !== 'page_header' && t !== 'page_footer') continue;
    if (b.page_idx != null && b.page_idx > 1) continue;
    const text = (b.text || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(text);

    if (!doi) {
      const m = text.match(DOI_RE);
      if (m) doi = (m[1] || m[2] || '').replace(/[.,;]+$/, '').trim();
    }
  }

  return { headerFooterText: lines.join('\n'), doi };
}

/**
 * Build the extraction prompt. Framed as "extract from full text" (not
 * "verify existing metadata"), since most unfiled items are sparse. The
 * publisher stamp (DOI, journal, volume/issue/pages, year) often lives in
 * header/footer blocks that MinerU excludes from full.md, so we inject them
 * explicitly as supplementary metadata.
 */
function buildPrompt({ markdown, currentItemType, headerFooterText }) {
  const hfSection = headerFooterText
    ? `\n## 页眉/页脚文本（出版商印记，含 DOI/期刊名/卷期等，优先采用）\n<header_footer>\n${headerFooterText}\n</header_footer>\n`
    : '';

  return `你是一名文献元数据抽取专家。下面给出从一篇 PDF 全文中解析出的 Markdown 内容（通常包含标题、作者、摘要、正文与参考文献），以及 MinerU 单独提取的页眉/页脚文本（出版商印记区域，通常含 DOI、期刊名、卷期页、年份、ISSN 等）。请从中抽取书目元数据。

## 当前条目类型（仅供参考，可建议更合适的类型）
${currentItemType}
${hfSection}
## 全文 Markdown（截取前部，元数据通常在首页）
<fulltext>
${markdown}
</fulltext>

## 任务
请从全文与页眉页脚中提取以下书目信息，并对每个字段给出置信度（0.0-1.0）。若全文中未出现某信息，对应字段 value 留空、confidence 设为 0。

## 输出 JSON schema（只返回 JSON，不要任何额外文字）
{
  "suggestedItemType": "建议的条目类型",
  "itemTypeConfidence": 0.0到1.0,
  "fields": [
    {
      "field": "字段名",
      "value": "提取到的值或空字符串",
      "confidence": 0.0到1.0,
      "reason": "一句话依据（中文）"
    }
  ],
  "creators": [
    {
      "firstName": "",
      "lastName": "",
      "creatorType": "author",
      "confidence": 0.0到1.0
    }
  ]
}

## 可建议的 itemType（只能从中选择）
${ITEM_TYPES.map(t => `  - ${t}`).join('\n')}

## 需要提取的字段名（只输出这些字段，不要编造字段名）
${TARGET_FIELDS.map(f => `  - ${f}`).join('\n')}

## 规则
- suggestedItemType：根据全文判断最合适的类型。学术论文→journalArticle；预印本（arXiv 等）→preprint；书籍→book；书章→bookSection；会议论文→conferencePaper；学位论文→thesis；报告→report；无法判断→document。
- publicationTitle：提取**真实的期刊/出版物全名**。页眉中通常有期刊全名（如 "Journal of Strategic Information Systems"），优先采用。不要写"待归档"。若全文未出现期刊名则留空。
- date：通常只存年份（如 "2023"）。页眉/页脚中的年份优先。若有完整日期可保留。
- DOI：格式如 "10.1234/xxx"，不要带 URL 前缀。页脚中的 "https://doi.org/..." 是论文自身 DOI，应提取。
- volume/issue/pages：页眉中的期刊行常含卷期页（如 "Information and Organization 29 (2019) 100250" 中 29 是卷、100250 是文章号）。
- pages：格式如 "1-25" 或 "12-34, 56-78"。
- 作者：按全文出现的顺序提取全部作者。西方人名 firstName 为名、lastName 为姓；中文姓名 lastName 为整名、firstName 留空、creatorType 用 "author"。若无作者则输出空数组。
- confidence：1.0=全文明确出现且无歧义；0.5-0.9=有依据但存在推断；<0.5=不确定或全文未明确。
- value 必须是可直接写入数据库的最终值，不要含解释性文字或 Markdown 标记。`;
}

function extractJson(text) {
  if (!text) throw new Error('LLM 返回为空');
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error('无法从 LLM 响应中解析 JSON');
}

/**
 * Run metadata extraction for an item. Reads the MinerU full-text markdown,
 * asks the LLM to extract bibliographic metadata, and returns per-field
 * suggestions with confidence. Does NOT write to the database.
 */
export async function extractItem(key) {
  if (!config.llm.apiKey) throw new Error('未配置 OPENAI_API_KEY');
  if (!config.llm.baseURL) throw new Error('未配置 OPENAI_BASE_URL');

  const item = Item.loadByKey(key);
  if (!item) throw new Error('条目未找到');

  const ft = getFullText(key);
  if (ft.state !== 'done' || !ft.markdown) {
    throw new Error('请先解析全文后再提取（当前全文状态：' + (ft.state || 'idle') + '）');
  }

  const currentItemType = item.itemType || 'document';
  const markdown = ft.markdown.length > config.llm.maxMarkdownChars
    ? ft.markdown.slice(0, config.llm.maxMarkdownChars)
    : ft.markdown;

  // MinerU puts the publisher stamp (DOI, journal, volume/issue/pages, year)
  // into header/footer blocks that are excluded from full.md. Read them from
  // content_list.json so the LLM (and a DOI regex) can see them.
  const { headerFooterText, doi: regexDoi } = readHeaderFooterMetadata(key);

  const userPrompt = buildPrompt({ markdown, currentItemType, headerFooterText });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  let data;
  try {
    const resp = await fetch(`${config.llm.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [
          { role: 'system', content: '你是文献元数据抽取助手，只输出 JSON，不输出任何其他内容。' },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`LLM 请求失败 ${resp.status}: ${errText.slice(0, 200)}`);
    }

    data = await resp.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('LLM 请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);

  // Normalize the LLM output.
  const suggestedItemType = ITEM_TYPES.includes(parsed.suggestedItemType)
    ? parsed.suggestedItemType
    : 'document';
  const itemTypeConfidence = clamp01(Number(parsed.itemTypeConfidence) || 0);

  const allowedTarget = new Set(TARGET_FIELDS);
  const fields = Array.isArray(parsed.fields)
    ? parsed.fields
        .filter(f => allowedTarget.has(f.field))
        .map(f => ({
          field: f.field,
          value: typeof f.value === 'string' ? f.value.trim() : String(f.value ?? '').trim(),
          confidence: clamp01(Number(f.confidence) || 0),
          reason: f.reason || '',
        }))
    : [];

  // The regex-extracted DOI from header/footer blocks is deterministic and
  // reliable; LLMs sometimes truncate or hallucinate DOIs (e.g. one run gave
  // ~200 MISQ items the same truncated "10.25300/MISQ/202"). Always prefer the
  // regex DOI when present, overriding whatever the LLM returned.
  if (regexDoi) {
    const llmDoi = fields.find(f => f.field === 'DOI');
    if (llmDoi) {
      llmDoi.value = regexDoi;
      llmDoi.confidence = Math.max(llmDoi.confidence, 0.95);
      if (!llmDoi.reason.includes('页脚正则提取')) {
        llmDoi.reason = (llmDoi.reason ? llmDoi.reason + ' ' : '') + '页脚正则提取 DOI（权威）';
      }
    } else {
      fields.push({ field: 'DOI', value: regexDoi, confidence: 0.95, reason: '页脚正则提取 DOI' });
    }
  }

  // Normalize publicationTitle to the canonical AIS Basket spelling when the
  // extracted name is a close variant (e.g. "Information and Management" →
  // "Information & Management", "Journal of Strategic Information Systems" →
  // "The Journal of Strategic Information Systems"). Without this, a correct
  // but non-canonical journal name would fail the whitelist exact-match and
  // leave the item stuck in "待归档".
  const pubField = fields.find(f => f.field === 'publicationTitle');
  if (pubField && pubField.value) {
    const canonical = normalizeJournalName(pubField.value);
    if (canonical && canonical !== pubField.value) {
      pubField.value = canonical;
      if (!pubField.reason.includes('规范化')) {
        pubField.reason = (pubField.reason ? pubField.reason + ' ' : '') + '期刊名规范化为白名单标准写法';
      }
    }
  }

  const creators = Array.isArray(parsed.creators)
    ? parsed.creators.map((c, i) => ({
        firstName: (c.firstName || '').trim(),
        lastName: (c.lastName || '').trim(),
        creatorType: c.creatorType || 'author',
        fieldMode: c.fieldMode ?? (c.firstName ? 0 : 1),
        orderIndex: i,
        confidence: clamp01(Number(c.confidence) || 0),
      })).filter(c => c.firstName || c.lastName)
    : [];

  const overallConfidence = computeOverall(fields, creators, itemTypeConfidence);

  return {
    suggestedItemType,
    itemTypeConfidence,
    fields,
    creators,
    overallConfidence,
    currentItemType,
    debug: {
      model: config.llm.model,
      userPrompt,
      rawResponse: content,
      markdownChars: markdown.length,
    },
  };
}

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Map an extracted journal name to the canonical AIS Basket spelling, or null
 * if it doesn't match any whitelist journal. Comparison is tolerant of:
 *   - "The" prefix (The Journal of... vs Journal of...)
 *   - "&" vs "and"  (Information & Management vs Information and Management)
 *   - case differences
 *   - surrounding whitespace
 */
export function normalizeJournalName(raw) {
  if (!raw) return null;
  const norm = s => s.trim().toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
    .trim();
  const target = norm(raw);
  for (const canonical of JOURNAL_WHITELIST) {
    if (norm(canonical) === target) return canonical;
  }
  return null;
}


function computeOverall(fields, creators, itemTypeConfidence) {
  // Weighted blend: the title carries the most signal, then authors, then the
  // rest. Falls back to itemTypeConfidence when no fields were extracted.
  const title = fields.find(f => f.field === 'title');
  const titleScore = title ? title.confidence : 0;
  const creatorAvg = creators.length
    ? creators.reduce((s, c) => s + c.confidence, 0) / creators.length
    : 0;
  const fieldAvg = fields.length
    ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length
    : 0;
  if (fields.length === 0 && creators.length === 0) return itemTypeConfidence;
  return clamp01(titleScore * 0.4 + creatorAvg * 0.3 + fieldAvg * 0.3);
}

/**
 * Apply an extraction result to the database, gated by confidence thresholds.
 * Only fills EMPTY fields by default (does not overwrite existing non-empty
 * values) to avoid clobbering manually-confirmed metadata.
 *
 * @param {string} key
 * @param {object} result - output of extractItem()
 * @param {object} opts
 * @param {number} opts.fieldThreshold     default 0.8
 * @param {number} opts.creatorThreshold   default 0.8
 * @param {number} opts.typeThreshold      default 0.9
 * @param {boolean} opts.overwrite         default false (only fill empty fields)
 * @returns {object} { appliedFields, skippedFields, typeChanged, appliedCreators, skippedCreators }
 */
export function applyExtraction(key, result, opts = {}) {
  const fieldThreshold = opts.fieldThreshold ?? 0.8;
  const creatorThreshold = opts.creatorThreshold ?? 0.8;
  const typeThreshold = opts.typeThreshold ?? 0.9;
  const overwrite = opts.overwrite ?? false;

  const item = Item.loadByKey(key);
  if (!item) throw new Error('条目未找到');

  const targetType = result.suggestedItemType;

  // ---- itemType conversion -------------------------------------------------
  // Convert the itemType when EITHER:
  //   (a) the LLM's itemTypeConfidence meets the typeThreshold, OR
  //   (b) the LLM suggests a scholarly type (journalArticle/preprint/...) AND
  //       a key bibliographic field (publicationTitle or DOI) is confidently
  //       extracted. This is critical because `document` items cannot store
  //       publicationTitle/volume/issue/ISSN — without converting the type,
  //       those fields would be silently dropped by Item.save() and the item
  //       could never leave "待归档".
  const scholarlyTypes = new Set([
    'journalArticle', 'preprint', 'book', 'bookSection', 'conferencePaper', 'thesis', 'report',
  ]);
  const pubField = result.fields.find(f => f.field === 'publicationTitle');
  const doiField = result.fields.find(f => f.field === 'DOI');
  const hasScholarlyEvidence =
    scholarlyTypes.has(targetType) &&
    ((pubField && pubField.confidence >= fieldThreshold && pubField.value) ||
     (doiField && doiField.confidence >= fieldThreshold && doiField.value));

  let typeChanged = false;
  if (
    targetType !== item.itemType &&
    itemTypeIdByName(targetType) != null &&
    (result.itemTypeConfidence >= typeThreshold || hasScholarlyEvidence)
  ) {
    item.setItemType(targetType);
    typeChanged = true;
  }

  // Use the EFFECTIVE type (after potential conversion) for field validation.
  const effectiveType = item.itemType;
  const allowedFields = new Set(allowedFieldsForType(effectiveType));

  const appliedFields = [];
  const skippedFields = [];

  for (const f of result.fields) {
    if (!allowedFields.has(f.field)) {
      skippedFields.push({ ...f, reason: `字段不允许 ${effectiveType} 类型` });
      continue;
    }
    if (f.confidence < fieldThreshold) {
      skippedFields.push({ ...f, reason: `置信度 ${f.confidence.toFixed(2)} < ${fieldThreshold}` });
      continue;
    }
    if (!f.value) {
      skippedFields.push({ ...f, reason: '值为空' });
      continue;
    }
    const existing = item.getField(f.field);
    if (existing && !overwrite) {
      skippedFields.push({ ...f, reason: '已有值，未覆盖' });
      continue;
    }
    item.setField(f.field, f.value);
    appliedFields.push(f);
  }

  // Creators: apply only if every creator meets the threshold AND there are no
  // existing creators (unless overwrite). Full replacement semantics.
  let appliedCreators = false;
  const existingCreators = item.creators;
  const allConfident = result.creators.length > 0 &&
    result.creators.every(c => c.confidence >= creatorThreshold);
  const avgConfident = result.creators.length > 0 &&
    (result.creators.reduce((s, c) => s + c.confidence, 0) / result.creators.length) >= creatorThreshold;

  if (result.creators.length > 0 && allConfident && avgConfident) {
    if (existingCreators.length === 0 || overwrite) {
      item.setCreators(result.creators.map(({ firstName, lastName, creatorType, fieldMode, orderIndex }) => ({
        firstName, lastName, creatorType, fieldMode, orderIndex,
      })));
      appliedCreators = true;
    }
  }

  item.save();

  return {
    typeChanged,
    appliedFields,
    skippedFields,
    appliedCreators,
    skippedCreators: !appliedCreators && result.creators.length > 0 ? result.creators : [],
  };
}
