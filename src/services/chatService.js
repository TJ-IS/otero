import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Item } from '../models/Item.js';
import { getFullText } from './fulltextService.js';
import { config } from '../config.js';

let provider;

function getProvider() {
  if (!provider) {
    if (!config.llm.apiKey) throw new Error('未配置 OPENAI_API_KEY');
    if (!config.llm.baseURL) throw new Error('未配置 OPENAI_BASE_URL');
    provider = createOpenAICompatible({
      name: 'deepseek',
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
    });
  }
  return provider;
}

/**
 * The AI SDK LanguageModel for the configured DeepSeek (OpenAI-compatible)
 * endpoint, wired up for use with `streamText`/`generateText`.
 */
export function getChatModel() {
  return getProvider()(config.llm.model);
}

const YEAR_RE = /\b(1[5-9]|20)\d{2}\b/;

function creatorDisplay(c) {
  if (c.fieldMode === 1 || !c.firstName) return c.lastName || c.name || '';
  return `${c.lastName || ''}, ${c.firstName || ''}`.trim(', ');
}

function volumeIssuePages(fields) {
  const volume = fields?.volume?.trim();
  const issue = fields?.issue?.trim();
  const pages = fields?.pages?.trim();
  let vi = '';
  if (volume) vi = volume;
  if (issue) vi = vi ? `${vi}(${issue})` : `(${issue})`;
  if (vi && pages) return `${vi}: ${pages}`;
  return vi || pages || '';
}

/**
 * Build the system prompt that grounds the chat in this paper's metadata +
 * full-text markdown (truncated to config.chat.maxMarkdownChars — chat needs
 * headroom for conversation turns on top of the context, unlike calibrate/
 * extract which spend the whole budget on one-shot analysis).
 */
export async function buildPaperContext(key) {
  const item = await Item.loadByKey(key);
  if (!item) throw new Error('条目未找到');

  const json = item.toJSON();
  const fields = json.fields || {};
  const creators = json.creators || [];
  const yearMatch = fields.date ? String(fields.date).match(YEAR_RE) : null;

  const metaLines = [
    `标题: ${fields.title || '(无标题)'}`,
    `作者: ${creators.map(creatorDisplay).join('; ') || '未知'}`,
    `期刊/来源: ${fields.publicationTitle || '未知'}`,
    `年份: ${yearMatch ? yearMatch[0] : '未知'}`,
    `卷期页码: ${volumeIssuePages(fields) || '未知'}`,
    `DOI: ${fields.DOI || '无'}`,
  ].join('\n');

  const ft = await getFullText(key);
  let fulltextBlock = '（全文尚未解析，仅有摘要/元数据可用）';
  if (ft.state === 'done' && ft.markdown) {
    const markdown = ft.markdown.length > config.chat.maxMarkdownChars
      ? ft.markdown.slice(0, config.chat.maxMarkdownChars) + '\n\n[...全文过长，已截断...]'
      : ft.markdown;
    fulltextBlock = markdown;
  } else if (fields.abstractNote) {
    fulltextBlock = `（全文尚未解析，仅提供摘要）\n${fields.abstractNote}`;
  }

  return `你是一个学术论文阅读助手，只根据下面提供的这篇论文的信息回答用户问题。如果论文信息中没有足够依据，请明确说明，不要编造内容。回答使用中文，除非用户用其他语言提问。

## 论文元数据
${metaLines}

## 论文全文（可能已截断）
<fulltext>
${fulltextBlock}
</fulltext>`;
}

/**
 * Trim+normalize prior conversation turns (from the client) to a plain
 * `{role, content}` array bounded by config.chat.maxHistoryMessages.
 */
export function trimHistory(history) {
  return Array.isArray(history)
    ? history.slice(-config.chat.maxHistoryMessages).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      }))
    : [];
}
