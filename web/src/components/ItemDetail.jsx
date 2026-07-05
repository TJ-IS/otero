import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { Save, Trash2, FileText, Plus, X, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { ITEM_TYPES, ITEM_TYPE_LABELS } from '@/lib/items';

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

export function ItemDetail({ itemKey, onDeleted, onChanged }) {
  const { data: item, error, loading, refresh } = useAsync(() => api.getItem(itemKey), [itemKey]);
  const { data: attachments } = useAsync(() => api.getItemAttachments(itemKey), [itemKey]);

  const [draft, setDraft] = useState(null);
  const [creatorsDraft, setCreatorsDraft] = useState([]);
  const [tagsDraft, setTagsDraft] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('detail');
  const [activePdfKey, setActivePdfKey] = useState(null);

  // Re-seed the editable draft whenever the loaded item changes.
  useEffect(() => {
    if (!item) return;
    setDraft({ fields: { ...item.fields }, itemType: item.itemType });
    setCreatorsDraft(item.creators || []);
    setTagsDraft(item.tags || []);
    setDirty(false);
    setTab('detail');
    setActivePdfKey(null);
  }, [item]);

  const pdfAttachments = (attachments || []).filter(a => (a.contentType || '').includes('pdf'));
  const previewUrl = activePdfKey ? `/api/attachments/${activePdfKey}/file` : null;

  if (loading) return <div className="p-4 text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="p-4 text-sm text-destructive">加载失败: {error.message}</div>;
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
  const addTag = () => {
    const name = newTag.trim();
    if (!name) return;
    if (tagsDraft.some(t => t.tag === name)) return;
    setTagsDraft(list => [...list, { tag: name, type: 0 }]);
    setNewTag('');
    setDirty(true);
  };
  const removeTag = (idx) => {
    setTagsDraft(list => list.filter((_, i) => i !== idx));
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
        tags: tagsDraft,
      });
      toast.success('已保存');
      setDirty(false);
      refresh();
      onChanged();
    } catch (err) {
      toast.error(`保存失败: ${err.message}`);
    }
  };

  const del = async () => {
    if (!confirm('删除该条目？（移入回收站，可恢复）')) return;
    try {
      await api.deleteItem(item.key);
      onDeleted();
    } catch (err) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const fields = FIELDS_BY_TYPE[draft.itemType] || FIELDS_BY_TYPE.document;

  const openPreview = (attKey) => {
    setActivePdfKey(attKey);
    setTab('pdf');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b p-3">
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">{ITEM_TYPE_LABELS[item.itemType] || item.itemType}</div>
          <div className="text-xs text-muted-foreground">key: {item.key}</div>
        </div>
        <Button size="sm" variant="outline" onClick={del}>
          <Trash2 className="size-4" /> 删除
        </Button>
        <Button size="sm" onClick={save} disabled={!dirty}>
          <Save className="size-4" /> 保存
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-3 mt-3 w-fit">
          <TabsTrigger value="detail">详情</TabsTrigger>
          {pdfAttachments.length > 0 && (
            <TabsTrigger value="pdf">PDF 预览</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="detail" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="mb-1 block">类型</Label>
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
                  <Label>作者</Label>
                  <Button size="sm" variant="ghost" onClick={addCreator}>
                    <Plus className="size-4" /> 添加
                  </Button>
                </div>
                <div className="space-y-2">
                  {creatorsDraft.map((c, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        placeholder="姓"
                        className="flex-1"
                        value={c.lastName || ''}
                        onChange={e => setCreator(idx, { lastName: e.target.value, fieldMode: 0 })}
                      />
                      <Input
                        placeholder="名"
                        className="flex-1"
                        value={c.firstName || ''}
                        onChange={e => setCreator(idx, { firstName: e.target.value, fieldMode: 0 })}
                      />
                      <Input
                        placeholder="角色"
                        className="w-28"
                        value={c.creatorType || 'author'}
                        onChange={e => setCreator(idx, { creatorType: e.target.value })}
                      />
                      <Button size="icon" variant="ghost" onClick={() => removeCreator(idx)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {creatorsDraft.length === 0 && (
                    <div className="text-xs text-muted-foreground">暂无作者</div>
                  )}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="mb-2 block">标签</Label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {tagsDraft.map((t, idx) => (
                    <Badge key={idx} variant="secondary" className="gap-1">
                      {t.tag}
                      <button onClick={() => removeTag(idx)} className="text-muted-foreground hover:text-destructive">
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  {tagsDraft.length === 0 && (
                    <span className="text-xs text-muted-foreground">暂无标签</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="新标签..."
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag()}
                  />
                  <Button size="sm" variant="outline" onClick={addTag}>添加</Button>
                </div>
              </div>

              <Separator />

              <div>
                <Label className="mb-2 block">附件</Label>
                <div className="space-y-1">
                  {(attachments || []).map(a => {
                    const isPdf = (a.contentType || '').includes('pdf');
                    return (
                      <button
                        key={a.key}
                        onClick={() => isPdf ? openPreview(a.key) : undefined}
                        disabled={!isPdf}
                        className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors enabled:hover:bg-accent/60 disabled:cursor-default"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{a.path}</span>
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
          <TabsContent value="pdf" className="flex-1 overflow-hidden p-3 pt-0">
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">PDF</Label>
                <select
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  value={activePdfKey || pdfAttachments[0]?.key || ''}
                  onChange={e => setActivePdfKey(e.target.value)}
                >
                  {pdfAttachments.map(a => (
                    <option key={a.key} value={a.key}>{a.path}</option>
                  ))}
                </select>
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
    </div>
  );
}
