import { memo, Suspense, lazy, useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Save, Trash2, FileText, Plus, X, ExternalLink, Download, Copy, Check, ChevronUp, ChevronDown, BookOpen, Sparkles, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { ITEM_TYPES, ITEM_TYPE_LABELS, itemTitle, ALLOWED_PUBLICATION_TITLES, NOT_ARCHIVED } from '@/lib/items';
import { CalibratePanel } from './CalibratePanel';

// Lazy-load the full-text viewer: it pulls in react-markdown + remark-gfm +
// remark-math + rehype-katex + katex CSS (~heavy). Only needed when the user
// opens the "全文" tab.
const FullTextView = lazy(() => import('./FullTextView').then(m => ({ default: m.FullTextView })));

// Field definitions by type. The union of all sections for each type MUST
// match the DB schema (src/db/seed.js ITEM_TYPES[].fields) so that every
// field the AI calibration can touch is editable here. Fields that don't fit
// a semantic section go into "other".
const FIELDS_BY_TYPE = {
  journalArticle: {
    basic: ['title', 'date', 'shortTitle'],
    publication: ['publicationTitle', 'publicationTitleAbbrev', 'volume', 'issue', 'pages'],
    identifiers: ['DOI', 'ISSN', 'url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'libraryCatalog', 'archive', 'archiveLocation', 'extra'],
  },
  preprint: {
    basic: ['title', 'date'],
    publication: ['repository'],
    identifiers: ['DOI', 'arXivID', 'url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  book: {
    basic: ['title', 'date', 'edition', 'shortTitle'],
    publication: ['publisher', 'place', 'series', 'seriesNumber', 'volume', 'numPages'],
    identifiers: ['ISBN', 'url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'callNumber', 'libraryCatalog', 'extra'],
  },
  bookSection: {
    basic: ['title', 'date', 'bookTitle', 'edition', 'shortTitle'],
    publication: ['publisher', 'place', 'series', 'seriesNumber', 'volume', 'pages'],
    identifiers: ['ISBN', 'url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  conferencePaper: {
    basic: ['title', 'date', 'conferenceName', 'shortTitle'],
    publication: ['proceedingsTitle', 'place', 'publisher', 'pages'],
    identifiers: ['DOI', 'ISBN', 'url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  thesis: {
    basic: ['title', 'date', 'thesisType', 'shortTitle'],
    publication: ['university', 'place', 'numPages'],
    identifiers: ['url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  report: {
    basic: ['title', 'date', 'reportType', 'reportNumber', 'shortTitle'],
    publication: ['publisher', 'place', 'series', 'pages'],
    identifiers: ['url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  document: {
    basic: ['title', 'date'],
    publication: ['publisher', 'numPages', 'pages'],
    identifiers: ['DOI', 'ISBN', 'url', 'accessDate'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
};

const FIELD_LABELS = {
  title: '标题', abstractNote: '摘要', publicationTitle: '期刊',
  publicationTitleAbbrev: '期刊缩写', volume: '卷', issue: '期', pages: '页码',
  date: '日期', DOI: 'DOI', ISBN: 'ISBN', ISSN: 'ISSN', url: 'URL',
  accessDate: '引用日期', language: '语言', shortTitle: '短标题', extra: '附加信息',
  bookTitle: '书名', conferenceName: '会议名称', proceedingsTitle: '会议录',
  place: '地点', publisher: '出版社', numPages: '页数',
  series: '系列', seriesNumber: '系列编号', edition: '版次', thesisType: '学位类型',
  university: '大学', reportType: '报告类型', reportNumber: '报告编号',
  repository: '仓库', arXivID: 'arXiv ID', rights: '权限',
  libraryCatalog: '目录', archive: '存档', archiveLocation: '存档位置',
  callNumber: '索书号',
};

const CREATOR_TYPES = ['author', 'editor', 'translator', 'contributor'];

// Fields that should span the full row in the two-column grid (long content).
const FULL_WIDTH_FIELDS = new Set([
  'title', 'abstractNote', 'extra', 'url',
  'publicationTitle', 'bookTitle', 'conferenceName', 'proceedingsTitle',
  'publisher', 'university', 'repository', 'place', 'series',
]);

const Field = memo(function Field({ name, value, onChange, multiline }) {
  return (
    <div className={FULL_WIDTH_FIELDS.has(name) ? 'col-span-2' : ''}>
      <Label className="text-xs text-muted-foreground">{FIELD_LABELS[name] || name}</Label>
      {multiline ? (
        <Textarea
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="mt-1 min-h-[100px] text-sm"
        />
      ) : (
        <Input
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="mt-1 h-8 text-sm"
        />
      )}
    </div>
  );
});

const Section = memo(function Section({ title, action, children }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
});

function ExportModal({ open, onOpenChange, format, content }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>导出 {format === 'bibtex' ? 'BibTeX' : 'RIS'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {content || '加载中...'}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="outline">关闭</Button>
          </DialogClose>
          <Button onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const ItemDetail = memo(function ItemDetail({ itemKey, onDeleted, onChanged, onDirtyChange }) {
  const { data: item, error, loading, refresh } = useAsync(() => api.getItem(itemKey), [itemKey]);
  const { data: attachments } = useAsync(() => api.getItemAttachments(itemKey), [itemKey]);
  const { data: fulltext, refresh: refreshFulltext } = useAsync(() => api.getFulltext(itemKey), [itemKey]);

  const [draft, setDraft] = useState(null);
  const [creatorsDraft, setCreatorsDraft] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('detail');
  const [activePdfKey, setActivePdfKey] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('bibtex');
  const [exportContent, setExportContent] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [calibrateLoading, setCalibrateLoading] = useState(false);
  const [calibrateResult, setCalibrateResult] = useState(null);
  const [calibrateError, setCalibrateError] = useState(null);

  useEffect(() => {
    if (!item) return;
    setDraft({ fields: { ...item.fields }, itemType: item.itemType });
    setCreatorsDraft(item.creators || []);
    setDirty(false);
    setTab('detail');
    const pdfs = (attachments || []).filter(a => (a.contentType || '').includes('pdf'));
    setActivePdfKey(pdfs[0]?.key || null);
  }, [item, attachments]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // AIS Basket rule: a journalArticle without a DOI can only be filed under
  // "未归档". When DOI is missing, force publicationTitle to NOT_ARCHIVED so
  // the constrained selector cannot assign it to a real basket journal.
  // Mark dirty so the corrected value is persisted on save.
  useEffect(() => {
    if (!draft) return;
    if (draft.itemType !== 'journalArticle') return;
    const doiMissing = !draft.fields?.DOI;
    if (doiMissing && draft.fields?.publicationTitle !== NOT_ARCHIVED) {
      setDraft(d => ({ ...d, fields: { ...d.fields, publicationTitle: NOT_ARCHIVED } }));
      setDirty(true);
    }
  }, [draft?.itemType, draft?.fields?.DOI, draft?.fields?.publicationTitle]);

  const pdfAttachments = (attachments || []).filter(a => (a.contentType || '').includes('pdf'));
  const previewUrl = activePdfKey ? `/api/attachments/${activePdfKey}/file` : null;

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  if (!item || !draft) return null;

  const setField = (name, value) => {
    setDraft(d => ({ ...d, fields: { ...d.fields, [name]: value } }));
    setDirty(true);
  };
  const setItemType = (value) => {
    setDraft(d => ({ ...d, itemType: value }));
    setDirty(true);
  };
  const setCreator = (idx, patch) => {
    setCreatorsDraft(list => list.map((c, i) => i === idx ? { ...c, ...patch } : c));
    setDirty(true);
  };
  const addCreator = () => {
    setCreatorsDraft(list => [...list, { firstName: '', lastName: '', creatorType: 'author', fieldMode: 0 }]);
    setDirty(true);
  };
  const removeCreator = (idx) => {
    setCreatorsDraft(list => list.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const moveCreator = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= creatorsDraft.length) return;
    const arr = [...creatorsDraft];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setCreatorsDraft(arr);
    setDirty(true);
  };

  const save = async () => {
    try {
      const fieldsPayload = {};
      for (const [k, v] of Object.entries(draft.fields)) {
        if (v === '' || v == null) fieldsPayload[k] = null;
        else fieldsPayload[k] = v;
      }
      await api.updateItem(item.key, {
        itemType: draft.itemType,
        fields: fieldsPayload,
        creators: creatorsDraft.map((c, i) => ({ ...c, orderIndex: i })),
      });
      toast.success('已保存');
      setDirty(false);
      refresh();
      onChanged();
    } catch (err) {
      toast.error(`保存失败: ${err.message}`);
    }
  };

  const revert = () => {
    if (!item) return;
    setDraft({ fields: { ...item.fields }, itemType: item.itemType });
    setCreatorsDraft(item.creators || []);
    setDirty(false);
    toast.info('已恢复');
  };

  const del = async () => {
    try {
      await api.deleteItem(item.key);
      onDeleted();
    } catch (err) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const fields = FIELDS_BY_TYPE[draft.itemType] || FIELDS_BY_TYPE.document;
  // journalArticle without a DOI is locked to "未归档" (see the effect above).
  const doiMissing = draft.itemType === 'journalArticle' && !draft.fields?.DOI;

  const openExport = async (format) => {
    if (!item) return;
    setExportFormat(format);
    setExportContent('');
    setExportOpen(true);
    try {
      const text = await api.fetchItemExport(item.key, format);
      setExportContent(text);
    } catch (err) {
      setExportContent(`导出失败: ${err.message}`);
    }
  };

  const openPreview = (attKey) => {
    setActivePdfKey(attKey);
    setTab('pdf');
  };

  const fulltextState = fulltext?.state || 'idle';
  const fulltextActive = ['submitting', 'pending', 'running', 'converting'].includes(fulltextState);
  const triggerParse = async () => {
    if (parseBusy || fulltextActive) return;
    setParseBusy(true);
    const force = fulltextState === 'done' || fulltextState === 'failed';
    try {
      await api.parseFulltext(itemKey, { force });
      toast.success('已提交解析任务');
      setTab('fulltext');
      refreshFulltext();
    } catch (err) {
      toast.error(`提交失败: ${err.message}`);
    } finally {
      setParseBusy(false);
    }
  };

  const triggerCalibrate = async () => {
    if (calibrateLoading) return;
    if (fulltextState !== 'done') {
      toast.warning('请先解析全文后再校准');
      setTab('fulltext');
      return;
    }
    setCalibrateOpen(true);
    setCalibrateLoading(true);
    setCalibrateError(null);
    setCalibrateResult(null);
    try {
      const res = await api.calibrateItem(itemKey);
      setCalibrateResult(res);
    } catch (err) {
      setCalibrateError(err.message);
    } finally {
      setCalibrateLoading(false);
    }
  };

  const applyCalibration = ({ fields, creators }) => {
    if (!draft) return;
    const newFields = { ...draft.fields };
    let fieldCount = 0;
    for (const [k, v] of Object.entries(fields)) {
      newFields[k] = v === '' ? null : v;
      fieldCount++;
    }
    setDraft({ ...draft, fields: newFields });
    // Merge accepted creators into the existing creatorsDraft by orderIndex.
    if (creators && creators.length > 0) {
      const merged = [...creatorsDraft];
      for (const c of creators) {
        const idx = typeof c.orderIndex === 'number' ? c.orderIndex : -1;
        if (idx >= 0 && idx < merged.length) {
          merged[idx] = { ...merged[idx], ...c };
        } else {
          merged.push(c);
        }
      }
      setCreatorsDraft(merged);
    }
    setDirty(true);
    setCalibrateOpen(false);
    setTab('detail');
    toast.success(`已应用到草稿（${fieldCount} 字段${creators?.length ? `，${creators.length} 作者` : ''}），请核对后保存`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Dirty indicator bar */}
      {dirty && (
        <div className="bg-yellow-500/20 dark:bg-yellow-600/30 border-b border-yellow-500/40 px-3 py-1 text-xs text-yellow-900 dark:text-yellow-100 flex items-center gap-2">
          <span className="font-medium">未保存的修改</span>
        </div>
      )}

      {/* Header with actions */}
      <div className="flex flex-wrap items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm" title={itemTitle(item)}>{itemTitle(item)}</div>
          <div className="text-xs text-muted-foreground">
            {ITEM_TYPE_LABELS[item.itemType] || item.itemType}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {pdfAttachments.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={triggerParse}
              disabled={parseBusy || fulltextActive}
              title={fulltextActive ? '解析进行中' : fulltextState === 'done' ? '重新解析为 Markdown 全文' : fulltextState === 'failed' ? '重新解析' : '解析为 Markdown 全文'}
            >
              {fulltextActive || parseBusy
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Sparkles className="size-3.5" />}
              <span className="hidden sm:inline">
                {fulltextActive ? '解析中' : fulltextState === 'done' ? '重新解析' : fulltextState === 'failed' ? '重试' : '解析全文'}
              </span>
            </Button>
          )}
          {pdfAttachments.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={triggerCalibrate}
              disabled={calibrateLoading || fulltextState !== 'done'}
              title={fulltextState !== 'done' ? '需先解析全文后才能校准' : '用 AI 对比全文校准元数据'}
            >
              {calibrateLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
              <span className="hidden sm:inline">AI 校准</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => openExport('bibtex')} title="导出 BibTeX">
            <Download className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => openExport('ris')} title="导出 RIS">
            <Download className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} title="删除">
            <Trash2 className="size-3.5" />
          </Button>
          {dirty && (
            <Button size="sm" variant="outline" onClick={revert} title="取消">
              <X className="size-3.5" />
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty} title="保存">
            <Save className="size-3.5" />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="detail">详情</TabsTrigger>
          {pdfAttachments.length > 0 && (
            <TabsTrigger value="pdf">PDF</TabsTrigger>
          )}
          {pdfAttachments.length > 0 && (
            <TabsTrigger value="fulltext">全文</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="detail" className="min-h-0 flex-1 overflow-hidden mt-2">
          <ScrollArea className="h-full">
            <div className="space-y-4 px-4 pb-6">
              {/* Basic info */}
              <Section title="基本信息">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">类型</Label>
                    <Select value={draft.itemType} onValueChange={setItemType}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ITEM_TYPES.map(t => (
                          <SelectItem key={t} value={t}>{ITEM_TYPE_LABELS[t] || t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {fields.basic?.map(name => (
                    <Field
                      key={name}
                      name={name}
                      value={draft.fields[name]}
                      onChange={v => setField(name, v)}
                    />
                  ))}
                </div>
              </Section>

              {fields.publication && fields.publication.length > 0 && (
                <Section title="发表信息">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {fields.publication.map(name => (
                      name === 'publicationTitle' ? (
                        <div key={name} className="col-span-2">
                          <Label className="text-xs text-muted-foreground">期刊</Label>
                          <Select
                            value={draft.fields.publicationTitle || ''}
                            onValueChange={v => setField('publicationTitle', v)}
                            disabled={doiMissing}
                          >
                            <SelectTrigger className="mt-1 h-8 text-sm">
                              <SelectValue placeholder={doiMissing ? NOT_ARCHIVED : '选择期刊'} />
                            </SelectTrigger>
                            <SelectContent>
                              {ALLOWED_PUBLICATION_TITLES.map(j => (
                                <SelectItem key={j} value={j}>{j}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {doiMissing && (
                            <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                              DOI 缺失，仅可归入「未归档」
                            </p>
                          )}
                        </div>
                      ) : (
                        <Field
                          key={name}
                          name={name}
                          value={draft.fields[name]}
                          onChange={v => setField(name, v)}
                        />
                      )
                    ))}
                  </div>
                </Section>
              )}

              {fields.identifiers && fields.identifiers.length > 0 && (
                <Section title="标识符">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {fields.identifiers.map(name => (
                      <Field
                        key={name}
                        name={name}
                        value={draft.fields[name]}
                        onChange={v => setField(name, v)}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {fields.abstract && fields.abstract.includes('abstractNote') && (
                <Section title="摘要">
                  <Field
                    name="abstractNote"
                    value={draft.fields.abstractNote}
                    onChange={v => setField('abstractNote', v)}
                    multiline
                  />
                </Section>
              )}

              {/* Creators */}
              <Section
                title="作者"
                action={
                  <Button size="sm" variant="ghost" onClick={addCreator} className="h-7 text-xs">
                    <Plus className="size-3.5" /> 添加
                  </Button>
                }
              >
                <div className="space-y-2">
                  {creatorsDraft.map((c, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Input
                          placeholder="姓"
                          value={c.lastName || ''}
                          onChange={e => setCreator(idx, { lastName: e.target.value, fieldMode: 0 })}
                          className="h-8 text-sm"
                        />
                        <Input
                          placeholder="名"
                          value={c.firstName || ''}
                          onChange={e => setCreator(idx, { firstName: e.target.value, fieldMode: 0 })}
                          className="h-8 text-sm"
                        />
                        <div className="col-span-2">
                          <Select
                            value={c.creatorType || 'author'}
                            onValueChange={v => setCreator(idx, { creatorType: v })}
                          >
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CREATOR_TYPES.map(t => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => moveCreator(idx, -1)}
                          disabled={idx === 0}
                          className="h-6 w-6"
                          title="上移"
                        >
                          <ChevronUp className="size-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => moveCreator(idx, 1)}
                          disabled={idx === creatorsDraft.length - 1}
                          className="h-6 w-6"
                          title="下移"
                        >
                          <ChevronDown className="size-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeCreator(idx)}
                          className="h-6 w-6"
                          title="删除"
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {creatorsDraft.length === 0 && (
                    <div className="text-xs text-muted-foreground">暂无作者</div>
                  )}
                </div>
              </Section>

              {fields.other && fields.other.length > 0 && (
                <Section title="其他">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {fields.other.map(name => (
                      <Field
                        key={name}
                        name={name}
                        value={draft.fields[name]}
                        onChange={v => setField(name, v)}
                        multiline={name === 'extra'}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Attachments */}
              <Section title="附件">
                <div className="space-y-1">
                  {(attachments || []).map(a => {
                    const isPdf = (a.contentType || '').includes('pdf');
                    const filename = a.path ? a.path.split('/').pop() : a.key;
                    return (
                      <button
                        key={a.key}
                        onClick={() => isPdf ? openPreview(a.key) : undefined}
                        disabled={!isPdf}
                        className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors enabled:hover:bg-accent/60 disabled:cursor-default"
                        title={filename}
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-xs">{filename}</span>
                        <Badge variant="secondary" className="text-[10px]">{a.contentType || 'file'}</Badge>
                        {isPdf && <ExternalLink className="size-3 text-muted-foreground" />}
                      </button>
                    );
                  })}
                  {(attachments || []).length === 0 && (
                    <div className="text-xs text-muted-foreground">无附件</div>
                  )}
                </div>
              </Section>
            </div>
          </ScrollArea>
        </TabsContent>

        {pdfAttachments.length > 0 && (
          <TabsContent value="pdf" className="min-h-0 flex-1 overflow-hidden p-3 pt-0">
            <div className="flex h-full flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs">PDF</Label>
                <Select value={activePdfKey || ''} onValueChange={setActivePdfKey}>
                  <SelectTrigger className="h-7 max-w-[200px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pdfAttachments.map(a => (
                      <SelectItem key={a.key} value={a.key} className="text-xs">
                        {a.path ? a.path.split('/').pop() : a.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" /> 新窗口
                  </a>
                )}
              </div>
              {previewUrl ? (
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  title="PDF preview"
                  className="flex-1 w-full rounded-md border bg-muted/30"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  无可预览的 PDF
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {pdfAttachments.length > 0 && (
          <TabsContent value="fulltext" className="min-h-0 flex-1 overflow-hidden mt-2">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>}>
              <FullTextView itemKey={item.key} hasPdf={pdfAttachments.length > 0} />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        format={exportFormat}
        content={exportContent}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该条目？</AlertDialogTitle>
            <AlertDialogDescription>
              移入回收站，可恢复。附件与元数据将一并标记为已删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={del}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CalibratePanel
        open={calibrateOpen}
        onOpenChange={setCalibrateOpen}
        result={calibrateResult}
        loading={calibrateLoading}
        error={calibrateError}
        onApply={applyCalibration}
      />
    </div>
  );
});
