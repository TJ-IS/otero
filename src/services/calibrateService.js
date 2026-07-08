import { Item } from '../models/Item.js';
import { getDb } from '../db/connection.js';
import { getFullText } from './fulltextService.js';
import { config } from '../config.js';
import { JOURNAL_WHITELIST, UNFILED } from './journalWhitelist.js';

/**
 * AIS Senior Scholars' Basket of Journals — the 11 journals this system
 * curates (single backend source of truth: src/services/journalWhitelist.js).
 * publicationTitle suggestions are constrained to this list plus UNFILED
 * ("待归档") when the source cannot be matched to any basket journal.
 */
const AIS_BASKET_JOURNALS = JOURNAL_WHITELIST;
const ALLOWED_PUBLICATION_TITLES = [...AIS_BASKET_JOURNALS, UNFILED];

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
 * Build the user prompt that asks the LLM to verify metadata against full text.
 */
function buildPrompt({ itemType, fields, creators, allowedFields, markdown }) {
  const currentMeta = {
    itemType,
    fields,
    creators: creators.map((c, i) => ({
      index: i,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      creatorType: c.creatorType || 'author',
      fieldMode: c.fieldMode ?? 0,
    })),
  };

  return `你是一名文献元数据校对专家。下面给出从一篇 PDF 全文中解析出的 Markdown 内容，以及当前数据库里已提取的元数据。请逐字段核对元数据是否与全文内容一致，找出错误、缺失或可补充的字段。

## 当前条目类型
${itemType}

## 该类型允许的字段名（仅可对这些字段给出建议）
${allowedFields.join(', ')}

## 当前已提取的元数据（JSON）
${JSON.stringify(currentMeta, null, 2)}

## 全文 Markdown（截取前部，元数据通常在首页）
<fulltext>
${markdown}
</fulltext>

## 任务
请对比全文内容与当前元数据，对每个**允许字段**和**每位作者**给出判断。只返回 JSON，不要任何额外文字。

## 输出 JSON schema
{
  "overallAccuracy": "high|medium|low",
  "fields": [
    {
      "field": "字段名",
      "current": "当前值或空字符串",
      "suggested": "建议值或空字符串",
      "confidence": 0.0到1.0的浮点数,
      "status": "correct|incorrect|missing|extra",
      "reason": "一句话理由（中文）"
    }
  ],
  "creators": [
    {
      "index": 0,
      "current": {"firstName":"","lastName":"","creatorType":"author"},
      "suggested": {"firstName":"","lastName":"","creatorType":"author"},
      "confidence": 0.0到1.0,
      "status": "correct|incorrect|missing",
      "reason": "一句话理由（中文）"
    }
  ]
}

## 规则
- status 含义：correct=当前值正确；incorrect=当前值有误应改为 suggested；missing=当前为空应补 suggested；extra=当前值多余建议清空（suggested 留空）。
- 只对允许字段列表里的字段输出；不要编造字段名。
- 期刊字段名是 publicationTitle（不是 journal/publicationName）。日期字段是 date（通常只存年份）。DOI 字段名是 DOI（大写）。
- publicationTitle 的 suggested 必须是下列 AIS Senior Scholars' Basket 期刊之一，或字符串"${UNFILED}"（当全文无法确认属于其中任何一本时使用"${UNFILED}"）。允许值列表：
${AIS_BASKET_JOURNALS.map(j => `  - ${j}`).join('\n')}
  - ${UNFILED}
- 若当前 DOI 字段为空（缺失），publicationTitle 的 suggested 必须为"${UNFILED}"，不得建议任何 basket 期刊。
- 作者：若全文未提及或无法判断，status=correct 且 suggested 与 current 相同。
- 若全文内容不足以判断某字段，confidence 设低（<0.5）并在 reason 注明"全文未明确"。
- suggested 必须是可直接写入数据库的最终值，不要含解释性文字。
- current 必须如实反映上面给出的当前元数据值。`;
}

function extractJson(text) {
  if (!text) throw new Error('LLM 返回为空');
  // Try direct parse first.
  try { return JSON.parse(text); } catch { /* fall through */ }
  // Extract the first {...} block.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error('无法从 LLM 响应中解析 JSON');
}

/**
 * Run metadata calibration for an item. Reads item metadata + full-text markdown,
 * asks the LLM to verify, and returns per-field suggestions. Does NOT write to DB.
 */
export async function calibrateItem(key) {
  if (!config.llm.apiKey) throw new Error('未配置 OPENAI_API_KEY');
  if (!config.llm.baseURL) throw new Error('未配置 OPENAI_BASE_URL');

  const item = Item.loadByKey(key);
  if (!item) throw new Error('条目未找到');

  const ft = getFullText(key);
  if (ft.state !== 'done' || !ft.markdown) {
    throw new Error('请先解析全文后再校准（当前全文状态：' + (ft.state || 'idle') + '）');
  }

  const json = item.toJSON();
  const itemType = json.itemType;
  const fields = json.fields || {};
  const creators = json.creators || [];
  const allowedFields = allowedFieldsForType(itemType);

  const markdown = ft.markdown.length > config.llm.maxMarkdownChars
    ? ft.markdown.slice(0, config.llm.maxMarkdownChars)
    : ft.markdown;

  const userPrompt = buildPrompt({ itemType, fields, creators, allowedFields, markdown });

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
          { role: 'system', content: '你是文献元数据校对助手，只输出 JSON，不输出任何其他内容。' },
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

  // Normalize: ensure fields/creators arrays exist, filter to allowed fields.
  const allowedSet = new Set(allowedFields);
  const doiMissing = !fields.DOI;
  const fieldsOut = normalizeCalibrationFields(parsed, { allowedSet, doiMissing });
  const creatorsOut = Array.isArray(parsed.creators) ? parsed.creators : [];

  return {
    overallAccuracy: parsed.overallAccuracy || 'unknown',
    fields: fieldsOut,
    creators: creatorsOut,
    itemType,
    // Tracing info: the exact messages sent to the LLM and the raw response.
    debug: {
      model: config.llm.model,
      systemPrompt: '你是文献元数据校对助手，只输出 JSON，不输出任何其他内容。',
      userPrompt,
      rawResponse: content,
      markdownChars: markdown.length,
    },
  };
}

/**
 * Pure normalization of the LLM's per-field suggestions. Exported for testing.
 *
 * - Drops any field not in `allowedSet` (the itemType's allowed field names).
 * - Enforces the AIS Basket constraint on `publicationTitle`: a suggestion
 *   outside ALLOWED_PUBLICATION_TITLES is discarded (reverted to current).
 * - Enforces the DOI rule: when `doiMissing` is true, `publicationTitle` may
 *   only be UNFILED ("待归档"); anything else is rewritten to UNFILED.
 */
export function normalizeCalibrationFields(parsed, { allowedSet, doiMissing }) {
  const allowedTitles = new Set(ALLOWED_PUBLICATION_TITLES);
  return Array.isArray(parsed?.fields)
    ? parsed.fields
        .filter(f => allowedSet.has(f.field))
        .map(f => {
          if (f.field === 'publicationTitle' && f.suggested && !allowedTitles.has(f.suggested)) {
            return {
              ...f,
              suggested: f.current || '',
              status: f.current ? 'correct' : 'missing',
              reason: `建议值「${f.suggested}」不在 AIS Basket 允许列表内，已忽略。${f.reason || ''}`.trim(),
            };
          }
          if (f.field === 'publicationTitle' && doiMissing && f.suggested !== UNFILED) {
            return {
              ...f,
              suggested: UNFILED,
              status: f.suggested === f.current ? 'correct' : 'incorrect',
              reason: `DOI 缺失，仅可归入「${UNFILED}」。${f.reason || ''}`.trim(),
            };
          }
          return f;
        })
    : [];
}
