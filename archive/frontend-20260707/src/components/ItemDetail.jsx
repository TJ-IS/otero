import { useEffect, useState } from 'react';
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
import { Save, Trash2, FileText, Plus, X, ExternalLink, Download, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { ITEM_TYPES, ITEM_TYPE_LABELS, itemTitle } from '@/lib/items';

// Common editable fields, keyed by item type. Mirrors src/db/seed.js.
const FIELDS_BY_TYPE = {
  journalArticle: ['title', 'abstractNote', 'publicationTitle', 'volume', 'issue', 'pages', 'date', 'DOI', 'ISSN', 'url', 'language', 'shortTitle', 'extra'],
  preprint: ['title', 'abstractNote', 'date', 'DOI', 'url', 'repository', 'extra'],
  book: ['title', 'abstractNote', 'numPages', 'series', 'volume', 'edition', 'place', 'publisher', 'date', 'ISBN', 'url', 'language', 'extra'],
  bookSection: ['title', 'abstractNote', 'bookTitle', 'series', 'volume', 'edition', 'place', 'publisher', 'pages', 'date', 'ISBN', 'url', 'extra'],
  conferencePaper: ['title', 'abstractNote', 'proceedingsTitle', 'conferenceName', 'place', 'publisher', 'pages', 'date', 'DOI', 'url', 'ISBN', 'extra'],
  thesis: ['title', 'abstractNote', 'thesisType', 'university', 'place', 'date', 'numPages', 'url', 'language', 'extra'],
  report: ['title', 'abstractNote', 'reportType', 'reportNumber', 'series', 'place', 'publisher', 'pages', 'date', 'url', 'extra'],
  document: ['title', 'abstractNote', 'date', 'DOI', 'ISBN', 'url', 'language', 'publisher', 'extra', 'numPages', 'pages'],
};

const FIELD_LABELS = {
  title: '标题',
  abstractNote: '摘要',
  publicationTitle: '期刊',
  publicationTitleAbbrev: '期刊缩写',
  volume: '卷',
  issue: '期',
  pages: '页',
  date: '日期',
  DOI: 'DOI',
  ISBN: 'ISBN',
  ISSN: 'ISSN',
  url: 'URL',
  accessDate: '访问日期',
  language: '语言',
  rights: '版权',
  shortTitle: '短标题',
  libraryCatalog: '目录库',
  archive: '归档',
  archiveLocation: '归档位置',
  extra: '附加',
  bookTitle: '书名',
  conferenceName: '会议',
  proceedingsTitle: '会议录',
  place: '地点',
  publisher: '出版社',
  numPages: '页数',
  series: '系列',
  edition: '版次',
  thesisType: '学位类型',
  university: '大学',
  reportType: '报告类型',
  reportNumber: '报告号',
  repository: '仓库',
  PMID: 'PMID',
  PMCID: 'PMCID',
};

const MULTILINE = new Set(['abstractNote', 'extra']);

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

export function ItemDetail({ itemKey, onDeleted, onChanged, onDirtyChange }) {
  const { data: item, error, loading, refresh } = useAsync(() => api.getItem(itemKey), [itemKey]);
  const { data: attachments } = useAsync(() => api.getItemAttachments(itemKey), [itemKey]);

  const [draft, setDraft] = useState(null);
  const [creatorsDraft, setCreatorsDraft] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('detail');
  const [activePdfKey, setActivePdfKey] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('bibtex');
  const [exportContent, setExportContent] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Re-seed the editable draft whenever the loaded item changes.
  useEffect(() => {
    if (!item) return;
    setDraft({ fields: { ...item.fields }, itemType: item.itemType });
    setCreatorsDraft(item.creators || []);
    setDirty(false);
    setTab('detail');
    const pdfs = (attachments || []).filter(a => (a.contentType || '').includes('pdf'));
    setActivePdfKey(pdfs[0]?.key || null);
  }, [item, attachments]);

  // Notify parent of dirty state for sheet close confirmation.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Warn before closing tab/window with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const pdfAttachments = (attachments || []).filter(a => (a.contentType || '').includes('pdf'));
  const previewUrl = activePdfKey ? `/api/attachments/${activePdfKey}/file` : null;

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  if (!item) return null;
  // useEffect seeds `draft` after commit; bail until then to avoid null deref.
  if (!draft) return null;

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
    toast.info('已恢复为保存前的状态');
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={itemTitle(item)}>{itemTitle(item)}</div>
          <div className="text-xs text-muted-foreground">
            {ITEM_TYPE_LABELS[item.itemType] || item.itemType} · key: {item.key}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openExport('bibtex')} title="导出 BibTeX">
            <Download className="size-4" /> <span className="hidden sm:inline">BibTeX</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => openExport('ris')} title="导出 RIS">
            <Download className="size-4" /> <span className="hidden sm:inline">RIS</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" /> <span className="hidden sm:inline">删除</span>
          </Button>
          {dirty && (
            <Button size="sm" variant="outline" onClick={revert}>
              <X className="size-4" /> 取消
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty}>
            <Save className="size-4" /> 保存
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="mx-3 mt-3 w-fit">
          <TabsTrigger value="detail">详情</TabsTrigger>
          {pdfAttachments.length > 0 && (
            <TabsTrigger value="pdf">PDF 预览</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="detail" className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="col-span-1 sm:col-span-2">
                  <Label className="mb-1 block text-xs">类型</Label>
                  <Select value={draft.itemType} onValueChange={setItemType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{ITEM_TYPE_LABELS[t] || t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {fields.map(name => (
                  <div key={name} className={MULTILINE.has(name) ? 'col-span-2' : ''}>
                    <Label className="mb-1 block text-xs">{FIELD_LABELS[name] || name}</Label>
                    {MULTILINE.has(name) ? (
                      <Textarea
                        value={draft.fields[name] || ''}
                        onChange={e => setField(name, e.target.value)}
                        className="min-h-[100px]"
                      />
                    ) : (
                      <Input
                        value={draft.fields[name] || ''}
                        onChange={e => setField(name, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>

              <Separator />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs">作者</Label>
                  <Button size="sm" variant="ghost" onClick={addCreator}>
                    <Plus className="size-4" /> 添加
                  </Button>
                </div>
                <div className="space-y-2">
                  {creatorsDraft.map((c, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
                      <Input
                        placeholder="姓"
                        value={c.lastName || ''}
                        onChange={e => setCreator(idx, { lastName: e.target.value, fieldMode: 0 })}
                      />
                      <Input
                        placeholder="名"
                        value={c.firstName || ''}
                        onChange={e => setCreator(idx, { firstName: e.target.value, fieldMode: 0 })}
                      />
                      <Input
                        placeholder="角色"
                        value={c.creatorType || 'author'}
                        onChange={e => setCreator(idx, { creatorType: e.target.value })}
                      />
                      <div className="flex justify-end sm:justify-start">
                        <Button size="icon" variant="ghost" onClick={() => removeCreator(idx)}>
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {creatorsDraft.length === 0 && (
                    <div className="text-xs text-muted-foreground">暂无作者</div>
                  )}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="mb-2 block text-xs">附件</Label>
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
                        <span className="flex-1 truncate">{filename}</span>
                        <Badge variant="secondary">{a.contentType || 'file'}</Badge>
                        {isPdf && (
                          <ExternalLink className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    );
                  })}
                  {(attachments || []).length === 0 && (
                    <div className="text-xs text-muted-foreground">无附件</div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {pdfAttachments.length > 0 && (
          <TabsContent value="pdf" className="min-h-0 flex-1 overflow-hidden p-3 pt-0">
            <div className="flex h-full flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs">PDF</Label>
                <Select value={activePdfKey || ''} onValueChange={setActivePdfKey}>
                  <SelectTrigger className="h-8 max-w-[260px] text-xs">
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
                    <ExternalLink className="size-3.5" /> 新窗口打开
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
    </div>
  );
}
