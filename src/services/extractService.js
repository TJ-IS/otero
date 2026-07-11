import { Item } from '../models/Item.js';
import { query } from '../db/connection.js';
import { getFullText, getContentListBlocks } from './fulltextService.js';
import { config } from '../config.js';
import { itemTypeIdByName } from '../repositories/itemRepo.js';
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
async function allowedFieldsForType(itemTypeName) {
  const rows = await query(`
    SELECT f."fieldName" FROM itemTypeFields itf
    JOIN fields f ON f."fieldID" = itf."fieldID"
    JOIN itemTypes it ON it."itemTypeID" = itf."itemTypeID"
    WHERE it."typeName" = $1
    ORDER BY itf."orderIndex"
  `, [itemTypeName]);
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
export async function readHeaderFooterMetadata(key) {
  const found = await getContentListBlocks(key);
  if (!found) return { headerFooterText: '', doi: '' };
  const { blocks } = found;
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
 * Build a COMPACT extraction prompt. The original prompt asked the LLM to
 * return an array of {field,value,confidence,reason} objects — the per-field
 * Chinese "reason" sentence roughly doubled output tokens. This version
 * requests a flat fields map plus an `uncertain` list, which is ~60% smaller
 * in output while preserving the same information (field→value, and which
 * fields are low-confidence).
 *
 * Framed as "extract from full text" (not "verify existing metadata"), since
 * most unfiled items are sparse. The publisher stamp (DOI, journal,
 * volume/issue/pages, year) often lives in header/footer blocks that MinerU
 * excludes from full.md, so we inject them explicitly as supplementary
 * metadata.
 */
function buildPrompt({ markdown, currentItemType, headerFooterText }) {
  const hfSection = headerFooterText
    ? `\n## 页眉/页脚（出版商印记，含 DOI/期刊名/卷期页/年份/ISSN，优先采用）\n${headerFooterText}\n`
    : '';

  return `你是文献元数据抽取专家。从下面全文 Markdown 与页眉/页脚中提取书目元数据，只输出 JSON，不要任何额外文字。

## 当前条目类型（仅供参考，可建议更合适的类型）
${currentItemType}
${hfSection}
## 全文 Markdown（前部，元数据通常在首页）
${markdown}

## 输出格式（只返回 JSON）
{
  "itemType": "journalArticle",
  "itemTypeConfidence": 0.9,
  "fields": {
    "title": "", "abstractNote": "", "publicationTitle": "",
    "volume": "", "issue": "", "pages": "", "date": "",
    "DOI": "", "ISSN": "", "url": "", "language": ""
  },
  "creators": [
    {"lastName": "Smith", "firstName": "John"},
    {"lastName": "Zhang", "firstName": ""},
    {"lastName": "李四", "firstName": ""}
  ],
  "uncertain": ["pages", "ISSN"]
}

## 可选 itemType（只能从中选）
${ITEM_TYPES.join(', ')}

## 需提取字段（只输出这些字段名，不要编造）
${TARGET_FIELDS.join(', ')}

## 规则
- itemType：学术论文→journalArticle；预印本（arXiv 等）→preprint；书籍→book；书章→bookSection；会议论文→conferencePaper；学位论文→thesis；报告→report；无法判断→document。itemTypeConfidence 为 0.0-1.0。
- fields：只填能从全文/页眉页脚确认的字段，未出现的留空字符串。
  - publicationTitle：真实期刊/出版物全名（页眉中常有，优先采用），不要写"待归档"。
  - date：通常只存年份（如 "2023"），页眉/页脚中的年份优先。
  - DOI：格式 "10.1234/xxx"，不带 URL 前缀；页脚 "https://doi.org/..." 是论文自身 DOI。
  - volume/issue/pages：页眉期刊行常含卷期页（如 "Information and Organization 29 (2019) 100250" → volume=29, pages=100250）。pages 格式如 "1-25"。
- creators：按全文出现顺序列出**全部作者，不要省略，至少前 10 位**。西方人名 lastName=姓、firstName=名（如 John Smith → firstName=John, lastName=Smith）；中文/单字段姓名 lastName=全名、firstName 留空。无作者输出空数组。
- uncertain：你没把握的字段名数组（对应 confidence 低于 0.8）；有把握的不要列入。
- 所有值必须是纯文本，不要含 XML/HTML 标签、Markdown 标记（# ** _ 等）、引号或解释性文字。`;
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
 * Strip the markup leakage the LLM sometimes leaves in field values: XML/HTML
 * tags (e.g. <fulltext>, <header_footer> from the prompt), Markdown header
 * markers (#), bold/italic markers (** __), and surrounding quotes. Without
 * this, extracted titles/abstracts can contain raw tags that pollute the DB.
 */
function cleanFieldValue(value) {
  if (!value) return '';
  let v = String(value).trim();
  // XML/HTML tags: <fulltext>, <header_footer>, <abstract>, etc.
  v = v.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  // Leading Markdown header markers.
  v = v.replace(/^#{1,6}\s+/, '');
  // Bold/italic markers.
  v = v.replace(/\*\*/g, '').replace(/__/g, '');
  // Surrounding quotes (straight + curly + CJK).
  v = v.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '');
  // Collapse internal whitespace.
  v = v.replace(/\s+/g, ' ').trim();
  return v;
}

/**
 * Clean a creator name and strip trailing affiliation superscripts/commas
 * (e.g. "Smith, John1,2" → "Smith, John" handled by caller splitting; here
 * we strip trailing digits/punctuation on a single name component).
 */
function cleanCreatorName(name) {
  if (!name) return '';
  let v = String(name).trim();
  v = v.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  v = v.replace(/^#{1,6}\s+/, '');
  v = v.replace(/\*\*/g, '').replace(/__/g, '');
  v = v.replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '');
  // Trailing affiliation markers: digits, commas, semicolons.
  v = v.replace(/[\d,;：:·\s]+$/, '');
  v = v.replace(/\s+/g, ' ').trim();
  return v;
}

/**
 * Trim the MinerU markdown to the front-matter region that actually carries
 * bibliographic metadata. The references section ("References" / "参考文献" /
 * "Bibliography" / "Works Cited") bloats input tokens massively but is useless
 * for title/author/DOI/journal extraction. Cut at the first references
 * heading when it appears after at least 800 chars of body; otherwise fall
 * back to the maxChars slice.
 */
function trimMarkdownForMetadata(md, maxChars) {
  const RE = /^#{1,6}\s*(references|参考文献|bibliography|works\s+cited|引用文献|refs?)\s*$/im;
  if (md.length <= maxChars) {
    const m = md.match(RE);
    if (m && m.index != null && m.index > 800) return md.slice(0, m.index).trimEnd();
    return md;
  }
  const head = md.slice(0, maxChars);
  const m = head.match(RE);
  if (m && m.index != null && m.index > 800) return md.slice(0, m.index).trimEnd();
  return head;
}

/**
 * Conservative regex fallback for authors when the LLM returns none. Scans the
 * first ~4000 chars after the title heading for capitalized "First Last" name
 * sequences. Confidence is set low (0.5) so this never auto-applies past the
 * 0.8 threshold — it's a review-only suggestion. Returns [] when the byline
 * is ambiguous.
 */
function fallbackAuthors(markdown) {
  const head = markdown.slice(0, 4000);
  const lines = head.split('\n').map(l => l.trim()).filter(Boolean);
  let startIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (/^#{1,3}\s+/.test(lines[i])) { startIdx = i + 1; break; }
  }
  const cand = lines.slice(startIdx, startIdx + 6).join(' ');
  if (!cand) return [];
  const stop = new Set([
    'Abstract', 'Introduction', 'Keywords', 'Summary', 'Contents',
    '摘要', '关键词', '引言', '目录', '作者', '通讯',
  ]);
  const matches = cand.match(/\b[A-Z][a-z]+(?:[- ][A-Z][a-z]+)+\b/g) || [];
  const out = [];
  for (const full of matches) {
    const firstWord = full.split(' ')[0];
    if (stop.has(full) || stop.has(firstWord)) continue;
    out.push(full);
    if (out.length >= 10) break;
  }
  return out.map(full => {
    const parts = full.split(' ');
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1],
      creatorType: 'author',
      fieldMode: 0,
      confidence: 0.5,
    };
  });
}

/**
 * Run metadata extraction for an item. Reads the MinerU full-text markdown,
 * asks the LLM to extract bibliographic metadata, and returns per-field
 * suggestions with confidence. Does NOT write to the database.
 */
export async function extractItem(key) {
  if (!config.llm.apiKey) throw new Error('未配置 OPENAI_API_KEY');
  if (!config.llm.baseURL) throw new Error('未配置 OPENAI_BASE_URL');

  const item = await Item.loadByKey(key);
  if (!item) throw new Error('条目未找到');

  const ft = await getFullText(key);
  if (ft.state !== 'done' || !ft.markdown) {
    throw new Error('请先解析全文后再提取（当前全文状态：' + (ft.state || 'idle') + '）');
  }

  const currentItemType = item.itemType || 'document';
  const markdown = trimMarkdownForMetadata(ft.markdown, config.llm.maxMarkdownChars);

  // MinerU puts the publisher stamp (DOI, journal, volume/issue/pages, year)
  // into header/footer blocks that are excluded from full.md. Read them from
  // content_list.json so the LLM (and a DOI regex) can see them.
  const { headerFooterText, doi: regexDoi } = await readHeaderFooterMetadata(key);

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

  // Normalize the LLM output. The compact schema returns a flat fields map
  // (field→value) plus an `uncertain` list, instead of an array of verbose
  // {field,value,confidence,reason} objects. We rebuild the legacy array
  // shape so consumers (applyExtraction, extract_all.mjs) keep working.
  const suggestedItemType = ITEM_TYPES.includes(parsed.itemType || parsed.suggestedItemType)
    ? (parsed.itemType || parsed.suggestedItemType)
    : 'document';
  const hasTitleOrDoi = !!(parsed.fields?.title || parsed.fields?.DOI);
  const itemTypeConfidence = clamp01(
    Number(parsed.itemTypeConfidence) || (hasTitleOrDoi ? 0.9 : 0.5)
  );

  const fieldsObj = parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields)
    ? parsed.fields
    : {};
  const uncertainSet = new Set(Array.isArray(parsed.uncertain) ? parsed.uncertain : []);

  const fields = [];
  for (const field of TARGET_FIELDS) {
    const raw = fieldsObj[field];
    if (raw == null || raw === '') continue;
    const value = cleanFieldValue(String(raw));
    if (!value) continue;
    const confidence = uncertainSet.has(field) ? 0.5 : 0.9;
    fields.push({ field, value, confidence, reason: '' });
  }

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

  let creators = Array.isArray(parsed.creators)
    ? parsed.creators.map((c, i) => ({
        firstName: cleanCreatorName(c.firstName || c.f || ''),
        lastName: cleanCreatorName(c.lastName || c.l || ''),
        creatorType: c.creatorType || 'author',
        fieldMode: c.fieldMode ?? (c.firstName || c.f ? 0 : 1),
        orderIndex: i,
        confidence: 0.9,
      })).filter(c => c.firstName || c.lastName)
    : [];

  // When the LLM fails to return any authors, fall back to a conservative
  // regex byline scan. Confidence is 0.5 so it never auto-applies past the
  // 0.8 threshold — review-only.
  if (creators.length === 0) {
    creators = fallbackAuthors(markdown).map((c, i) => ({ ...c, orderIndex: i }));
  }

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
export async function applyExtraction(key, result, opts = {}) {
  const fieldThreshold = opts.fieldThreshold ?? 0.8;
  const creatorThreshold = opts.creatorThreshold ?? 0.8;
  const typeThreshold = opts.typeThreshold ?? 0.9;
  const overwrite = opts.overwrite ?? false;

  const item = await Item.loadByKey(key);
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
    (await itemTypeIdByName(targetType)) != null &&
    (result.itemTypeConfidence >= typeThreshold || hasScholarlyEvidence)
  ) {
    await item.setItemType(targetType);
    typeChanged = true;
  }

  // Use the EFFECTIVE type (after potential conversion) for field validation.
  const effectiveType = item.itemType;
  const allowedFields = new Set(await allowedFieldsForType(effectiveType));

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

  await item.save();

  return {
    typeChanged,
    appliedFields,
    skippedFields,
    appliedCreators,
    skippedCreators: !appliedCreators && result.creators.length > 0 ? result.creators : [],
  };
}
