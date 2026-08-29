import { memo, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Save, Trash2, FileText, Plus, X, ExternalLink, Copy, Check, ChevronUp, ChevronDown, Sparkles, Loader2, Wand2, Braces, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { ITEM_TYPES, ITEM_TYPE_LABELS, itemTitle, ALLOWED_PUBLICATION_TITLES, UNFILED } from '@/lib/items';
import { CalibratePanel } from './CalibratePanel';
import { CrossrefPanel } from './CrossrefPanel';
import { ItemPublicCard } from './ItemPublicCard';
import { LoadingSkeleton } from '@/components/ui/async-states';
import { useAuth } from '@/contexts/AuthContext';

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
    publication: ['publicationTitle', 'volume', 'issue', 'pages'],
    identifiers: ['DOI', 'ISSN', 'url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'libraryCatalog', 'archive', 'archiveLocation', 'extra'],
  },
  preprint: {
    basic: ['title', 'date'],
    publication: ['repository'],
    identifiers: ['DOI', 'arXivID', 'url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  book: {
    basic: ['title', 'date', 'edition', 'shortTitle'],
    publication: ['publisher', 'place', 'series', 'seriesNumber', 'volume', 'numPages'],
    identifiers: ['ISBN', 'url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'callNumber', 'libraryCatalog', 'extra'],
  },
  bookSection: {
    basic: ['title', 'date', 'bookTitle', 'edition', 'shortTitle'],
    publication: ['publisher', 'place', 'series', 'seriesNumber', 'volume', 'pages'],
    identifiers: ['ISBN', 'url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  conferencePaper: {
    basic: ['title', 'date', 'conferenceName', 'shortTitle'],
    publication: ['proceedingsTitle', 'place', 'publisher', 'pages'],
    identifiers: ['DOI', 'ISBN', 'url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  thesis: {
    basic: ['title', 'date', 'thesisType', 'shortTitle'],
    publication: ['university', 'place', 'numPages'],
    identifiers: ['url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  report: {
    basic: ['title', 'date', 'reportType', 'reportNumber', 'shortTitle'],
    publication: ['publisher', 'place', 'series', 'pages'],
    identifiers: ['url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
  document: {
    basic: ['title', 'date'],
    publication: ['publisher', 'numPages', 'pages'],
    identifiers: ['DOI', 'ISBN', 'url'],
    abstract: ['abstractNote'],
    other: ['language', 'rights', 'extra'],
  },
};

const CREATOR_TYPES = ['author', 'editor', 'translator', 'contributor'];

// Fields that should span the full row in the two-column grid (long content).
const FULL_WIDTH_FIELDS = new Set([
  'title', 'abstractNote', 'extra', 'url',
  'publicationTitle', 'bookTitle', 'conferenceName', 'proceedingsTitle',
  'publisher', 'university', 'repository', 'place', 'series',
]);

// Derive an external jump URL for identifier fields (DOI / url). Returns null
// for fields that have no meaningful external target.
function fieldHref(name, value) {
  const v = (value || '').trim();
  if (!v) return null;
  if (name === 'DOI') return `https://doi.org/${v}`;
  if (name === 'url' && /^https?:\/\//i.test(v)) return v;
  return null;
}

const Field = memo(function Field({ name, value, onChange, multiline, readOnly }) {
  const { t } = useTranslation('item');
  const href = useMemo(() => fieldHref(name, value), [name, value]);
  return (
    <div className={FULL_WIDTH_FIELDS.has(name) ? 'col-span-2' : ''}>
      <Label className="text-xs text-muted-foreground">{t(`field.${name}`, { defaultValue: name })}</Label>
      <div className="relative mt-1">
        {multiline ? (
          <Textarea
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            readOnly={readOnly}
            className={`min-h-[100px] text-sm ${href ? 'pr-8' : ''} ${readOnly ? 'bg-muted/50 cursor-not-allowed' : ''}`}
          />
        ) : (
          <Input
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            readOnly={readOnly}
            className={`h-8 text-sm ${href ? 'pr-8' : ''} ${readOnly ? 'bg-muted/50 cursor-not-allowed' : ''}`}
          />
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
            title={t('detail.jump')}
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
});

const Section = memo(function Section({ title, action, children }) {
  return (
    <section className="space-y-3 border-t border-border/80 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
});

function ExportModal({ open, onOpenChange, format, content }) {
  const { t } = useTranslation(['item', 'common']);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('detail.copiedClipboard'));
    } catch {
      toast.error(t('common:copyFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('detail.exportTitle', { format: format === 'bibtex' ? 'BibTeX' : 'RIS' })}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded-sm border border-border/80 bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {content || t('common:loadingDots')}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="outline">{t('common:close')}</Button>
          </DialogClose>
          <Button onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? t('common:copied') : t('detail.copy')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const ItemDetail = memo(function ItemDetail({ itemKey, onDeleted, onChanged, onDirtyChange }) {
  const { t } = useTranslation(['item', 'common']);
  const { canEdit, ready } = useAuth();
  const { data: item, error, loading, refresh } = useAsync((signal) => api.getItem(itemKey, { signal }), [itemKey]);
  const { data: attachments } = useAsync((signal) => api.getItemAttachments(itemKey, { signal }), [itemKey]);
  const { data: fulltext, refresh: refreshFulltext } = useAsync((signal) => api.getFulltext(itemKey, { signal }), [itemKey]);

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
  const [crossrefOpen, setCrossrefOpen] = useState(false);
  const [crossrefLoading, setCrossrefLoading] = useState(false);
  const [crossrefResult, setCrossrefResult] = useState(null);
  const [crossrefError, setCrossrefError] = useState(null);
  const [signedPdfUrl, setSignedPdfUrl] = useState(null);

  useEffect(() => {
    if (!item) return;
    // AIS Basket: journalArticle without DOI can only sit under UNFILED.
    // Normalize in the draft on load so the UI is correct, but do NOT mark
    // dirty — otherwise opening many unfiled items traps the panel behind
    // "未保存的修改" and blocks switching/closing.
    const fields = { ...item.fields };
    if (item.itemType === 'journalArticle' && !fields.DOI && fields.publicationTitle !== UNFILED) {
      fields.publicationTitle = UNFILED;
    }
    setDraft({ fields, itemType: item.itemType });
    setCreatorsDraft(item.creators || []);
    setDirty(false);
    setTab('detail');
    const pdfs = (attachments || []).filter(a => (a.contentType || '').includes('pdf'));
    setActivePdfKey(pdfs[0]?.key || null);
  }, [item, attachments]);

  useEffect(() => {
    onDirtyChange?.(canEdit ? dirty : false);
  }, [dirty, canEdit, onDirtyChange]);

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

  useEffect(() => {
    if (tab !== 'pdf' || !activePdfKey || !itemKey || !canEdit) {
      setSignedPdfUrl(null);
      return undefined;
    }
    let cancelled = false;
    api.getItemPdfUrl(itemKey, { attachment: activePdfKey })
      .then((result) => {
        if (!cancelled) setSignedPdfUrl(result.absoluteUrl || result.url || null);
      })
      .catch(() => {
        if (!cancelled) setSignedPdfUrl(null);
      });
    return () => { cancelled = true; };
  }, [tab, activePdfKey, itemKey, canEdit]);

  const openSignedPdf = async () => {
    if (!itemKey || !activePdfKey) return;
    try {
      const result = await api.getItemPdfUrl(itemKey, { attachment: activePdfKey });
      const url = result.absoluteUrl || result.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(t('common:loadFailed', { message: err.message }));
    }
  };

  if (!ready || loading) {
    return (
      <div className={canEdit ? 'flex h-full items-center justify-center p-8' : 'px-8 py-10'}>
        <LoadingSkeleton variant="lines" className="w-full max-w-xl" />
      </div>
    );
  }
  if (error) return <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">{t('common:loadFailed', { message: error.message })}</div>;
  if (!canEdit) {
    if (!item) return null;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ItemPublicCard item={item} />
      </div>
    );
  }
  if (!item || !draft) return null;

  const setField = (name, value) => {
    if (!canEdit) return;
    setDraft(d => {
      const fields = { ...d.fields, [name]: value };
      // Clearing DOI on a journalArticle must drop it back to UNFILED.
      if (
        d.itemType === 'journalArticle'
        && name === 'DOI'
        && !value
        && fields.publicationTitle !== UNFILED
      ) {
        fields.publicationTitle = UNFILED;
      }
      return { ...d, fields };
    });
    setDirty(true);
  };
  const setItemType = (value) => {
    if (!canEdit) return;
    setDraft(d => {
      const fields = { ...d.fields };
      if (value === 'journalArticle' && !fields.DOI && fields.publicationTitle !== UNFILED) {
        fields.publicationTitle = UNFILED;
      }
      return { ...d, itemType: value, fields };
    });
    setDirty(true);
  };
  const setCreator = (idx, patch) => {
    if (!canEdit) return;
    setCreatorsDraft(list => list.map((c, i) => i === idx ? { ...c, ...patch } : c));
    setDirty(true);
  };
  const addCreator = () => {
    if (!canEdit) return;
    setCreatorsDraft(list => [...list, { firstName: '', lastName: '', creatorType: 'author', fieldMode: 0 }]);
    setDirty(true);
  };
  const removeCreator = (idx) => {
    if (!canEdit) return;
    setCreatorsDraft(list => list.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const moveCreator = (idx, dir) => {
    if (!canEdit) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= creatorsDraft.length) return;
    const arr = [...creatorsDraft];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setCreatorsDraft(arr);
    setDirty(true);
  };

  const save = async () => {
    if (!canEdit) return;
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
      toast.success(t('detail.saved'));
      setDirty(false);
      refresh();
      onChanged();
    } catch (err) {
      toast.error(t('detail.saveFailed', { message: err.message }));
    }
  };

  const revert = () => {
    if (!item || !canEdit) return;
    setDraft({ fields: { ...item.fields }, itemType: item.itemType });
    setCreatorsDraft(item.creators || []);
    setDirty(false);
    toast.info(t('detail.reverted'));
  };

  const del = async () => {
    if (!canEdit) return;
    try {
      await api.deleteItem(item.key);
      onDeleted();
    } catch (err) {
      toast.error(t('detail.deleteFailed', { message: err.message }));
    }
  };

  const fields = FIELDS_BY_TYPE[draft.itemType] || FIELDS_BY_TYPE.document;
  // journalArticle without a DOI is locked to UNFILED ("待归档") (see the effect above).
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
      setExportContent(t('detail.exportFailed', { message: err.message }));
    }
  };

  const openPreview = (attKey) => {
    setActivePdfKey(attKey);
    setTab('pdf');
  };

  const fulltextState = fulltext?.state || 'idle';
  const fulltextActive = ['submitting', 'pending', 'running', 'converting'].includes(fulltextState);
  const triggerParse = async () => {
    if (!canEdit || parseBusy || fulltextActive) return;
    setParseBusy(true);
    const force = fulltextState === 'done' || fulltextState === 'failed';
    try {
      await api.parseFulltext(itemKey, { force });
      toast.success(t('fulltext.submitted'));
      setTab('fulltext');
      refreshFulltext();
    } catch (err) {
      toast.error(t('fulltext.submitFailed', { message: err.message }));
    } finally {
      setParseBusy(false);
    }
  };

  const triggerCalibrate = async () => {
    if (!canEdit || calibrateLoading) return;
    if (fulltextState !== 'done') {
      toast.warning(t('detail.parseBeforeCalibrate'));
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
    if (!draft || !canEdit) return;
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
    const parts = [t('detail.fieldCount', { count: fieldCount })];
    if (creators?.length) parts.push(t('detail.creatorCount', { count: creators.length }));
    toast.success(t('detail.appliedDraft', { parts: parts.join('，') }));
  };

  const triggerCrossref = async () => {
    if (!canEdit || crossrefLoading) return;
    const doi = (draft?.fields?.DOI || '').trim();
    if (!doi) {
      toast.warning(t('detail.fillDoiFirst'));
      return;
    }
    setCrossrefOpen(true);
    setCrossrefLoading(true);
    setCrossrefError(null);
    setCrossrefResult(null);
    try {
      // Compare against the current draft (may include unsaved DOI/fields).
      const res = await api.enrichFromCrossref(itemKey, {
        doi,
        fields: draft.fields,
        creators: creatorsDraft,
        itemType: draft.itemType,
      });
      setCrossrefResult(res);
    } catch (err) {
      setCrossrefError(err.message);
    } finally {
      setCrossrefLoading(false);
    }
  };

  const applyCrossref = ({ fields, creators, itemType }) => {
    if (!draft || !canEdit) return;
    const newFields = { ...draft.fields };
    let fieldCount = 0;
    for (const [k, v] of Object.entries(fields || {})) {
      newFields[k] = v === '' ? null : v;
      fieldCount++;
    }
    // AIS Basket: if CrossRef filled a real journal but DOI is present, keep it.
    // If somehow DOI missing after apply, force UNFILED.
    if ((!newFields.DOI) && draft.itemType === 'journalArticle') {
      newFields.publicationTitle = UNFILED;
    }
    const nextType = itemType || draft.itemType;
    setDraft({ fields: newFields, itemType: nextType });
    if (creators) {
      setCreatorsDraft(creators);
    }
    setDirty(true);
    setCrossrefOpen(false);
    setTab('detail');
    const parts = [];
    if (fieldCount) parts.push(t('detail.fieldCount', { count: fieldCount }));
    if (creators) parts.push(t('detail.creatorCount', { count: creators.length }));
    if (itemType) parts.push(t('detail.typePart'));
    toast.success(t('detail.appliedDraft', { parts: parts.join('，') || t('detail.noChanges') }));
  };

  const parseTitle = fulltextActive
    ? t('fulltext.titleActive')
    : fulltextState === 'done'
      ? t('fulltext.titleReparse')
      : fulltextState === 'failed'
        ? t('fulltext.reparse')
        : t('fulltext.titleParse');

  return (
    <div className="flex h-full flex-col">
      {/* Dirty indicator bar */}
      {canEdit && dirty && (
        <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/15 px-3 py-1 text-xs text-foreground">
          <span className="font-medium">{t('common:unsavedChanges')}</span>
        </div>
      )}

      {/* Header with actions */}
      <div className="flex flex-wrap items-start gap-3 border-b border-border/80 p-4 pr-14">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-semibold" title={itemTitle(item)}>{itemTitle(item)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {ITEM_TYPE_LABELS[item.itemType] || item.itemType}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" asChild title={t('detail.openDedicated')}>
            <Link to={`/items/${itemKey}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
          {canEdit && pdfAttachments.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={triggerParse}
              disabled={parseBusy || fulltextActive}
              title={parseTitle}
            >
              {fulltextActive || parseBusy
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Sparkles className="size-3.5" />}
            </Button>
          )}
          {canEdit && pdfAttachments.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={triggerCalibrate}
              disabled={calibrateLoading || fulltextState !== 'done'}
              title={fulltextState !== 'done' ? t('fulltext.titleCalibrateNeed') : t('fulltext.titleCalibrate')}
            >
              {calibrateLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => openExport('bibtex')} title={t('fulltext.exportBibtex')}>
            <Braces className="size-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => openExport('ris')} title={t('fulltext.exportRis')}>
            <FileText className="size-3.5" />
          </Button>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)} title={t('common:delete')}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
          {canEdit && dirty && (
            <Button size="sm" variant="outline" onClick={revert} title={t('common:cancel')}>
              <X className="size-3.5" />
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={save} disabled={!dirty} title={t('common:save')}>
              <Save className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="mx-4 mt-1 h-auto w-auto justify-start rounded-none border-b border-border/80 bg-transparent p-0">
          <TabsTrigger value="detail" className="rounded-none border-b-2 border-transparent px-1 py-2 shadow-none data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand data-[state=active]:shadow-none">{t('detail.tabDetail')}</TabsTrigger>
          {pdfAttachments.length > 0 && (
            <TabsTrigger value="pdf" className="ml-5 rounded-none border-b-2 border-transparent px-1 py-2 shadow-none data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand data-[state=active]:shadow-none">{t('detail.tabPdf')}</TabsTrigger>
          )}
          {pdfAttachments.length > 0 && (
            <TabsTrigger value="fulltext" className="ml-5 rounded-none border-b-2 border-transparent px-1 py-2 shadow-none data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand data-[state=active]:shadow-none">{t('detail.tabFulltext')}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="detail" className="min-h-0 flex-1 overflow-hidden mt-2">
          <ScrollArea className="h-full">
            <div className="max-w-4xl space-y-5 px-4 pb-6 pt-2">
              {/* Basic info */}
              <Section title={t('detail.basic')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">{t('detail.type')}</Label>
                    <Select value={draft.itemType} onValueChange={setItemType} disabled={!canEdit}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ITEM_TYPES.map(type => (
                          <SelectItem key={type} value={type}>{ITEM_TYPE_LABELS[type] || type}</SelectItem>
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
                      readOnly={!canEdit}
                    />
                  ))}
                </div>
              </Section>

              {fields.publication && fields.publication.length > 0 && (
                <Section title={t('detail.publication')}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                    {fields.publication.map(name => (
                      name === 'publicationTitle' ? (
                        <div key={name} className="col-span-2">
                          <Label className="text-xs text-muted-foreground">{t('detail.journal')}</Label>
                          <Select
                            value={draft.fields.publicationTitle || ''}
                            onValueChange={v => setField('publicationTitle', v)}
                            disabled={doiMissing || !canEdit}
                          >
                            <SelectTrigger className="mt-1 h-8 text-sm">
                              <SelectValue placeholder={doiMissing ? t('common:unfiled') : t('detail.selectJournal')} />
                            </SelectTrigger>
                            <SelectContent>
                              {ALLOWED_PUBLICATION_TITLES.map(j => (
                                <SelectItem key={j} value={j}>
                                  {j === UNFILED ? t('common:unfiled') : j}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {doiMissing && (
                            <p className="mt-1 text-xs text-warning">
                              {t('detail.doiMissingUnfiled')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Field
                          key={name}
                          name={name}
                          value={draft.fields[name]}
                          onChange={v => setField(name, v)}
                          readOnly={!canEdit}
                        />
                      )
                    ))}
                  </div>
                </Section>
              )}

              {fields.identifiers && fields.identifiers.length > 0 && (
                <Section title={t('detail.identifiers')}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                    {fields.identifiers.map(name => (
                      name === 'DOI' ? (
                        <div key={name} className="col-span-2">
                          <Label className="text-xs text-muted-foreground">{t(`field.${name}`, { defaultValue: name })}</Label>
                          <div className="mt-1 flex items-center gap-1.5">
                            <div className="relative flex-1 min-w-0">
                              <Input
                                value={draft.fields.DOI || ''}
                                onChange={e => setField('DOI', e.target.value)}
                                readOnly={!canEdit}
                                className={`h-8 text-sm pr-8 ${!canEdit ? 'bg-muted/50 cursor-not-allowed' : ''}`}
                              />
                              {fieldHref('DOI', draft.fields.DOI) && (
                                <a
                                  href={fieldHref('DOI', draft.fields.DOI)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                                  title={t('detail.jumpDoi')}
                                  onClick={e => e.stopPropagation()}
                                >
                                  <ExternalLink className="size-3.5" />
                                </a>
                              )}
                            </div>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 px-2"
                                onClick={triggerCrossref}
                                disabled={crossrefLoading || !(draft.fields.DOI || '').trim()}
                                title={t('crossref.resolveTitle')}
                              >
                                {crossrefLoading
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <Globe className="size-3.5" />}
                                <span className="ml-1 text-xs">CrossRef</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <Field
                          key={name}
                          name={name}
                          value={draft.fields[name]}
                          onChange={v => setField(name, v)}
                          readOnly={!canEdit}
                        />
                      )
                    ))}
                  </div>
                </Section>
              )}

              {fields.abstract && fields.abstract.includes('abstractNote') && (
                <Section title={t('detail.abstract')}>
                  <Field
                    name="abstractNote"
                    value={draft.fields.abstractNote}
                    onChange={v => setField('abstractNote', v)}
                    multiline
                    readOnly={!canEdit}
                  />
                </Section>
              )}

              {/* Creators */}
              <Section
                title={t('detail.authors')}
                action={
                  canEdit ? (
                    <Button size="sm" variant="ghost" onClick={addCreator} className="h-7 text-xs">
                      <Plus className="size-3.5" /> {t('detail.addAuthor')}
                    </Button>
                  ) : null
                }
              >
                <div className="space-y-2">
                  {creatorsDraft.map((c, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Input
                          placeholder={t('detail.lastName')}
                          value={c.lastName || ''}
                          onChange={e => setCreator(idx, { lastName: e.target.value, fieldMode: 0 })}
                          readOnly={!canEdit}
                          className={`h-8 text-sm ${!canEdit ? 'bg-muted/50 cursor-not-allowed' : ''}`}
                        />
                        <Input
                          placeholder={t('detail.firstName')}
                          value={c.firstName || ''}
                          onChange={e => setCreator(idx, { firstName: e.target.value, fieldMode: 0 })}
                          readOnly={!canEdit}
                          className={`h-8 text-sm ${!canEdit ? 'bg-muted/50 cursor-not-allowed' : ''}`}
                        />
                        <div className="col-span-2">
                          <Select
                            value={c.creatorType || 'author'}
                            onValueChange={v => setCreator(idx, { creatorType: v })}
                            disabled={!canEdit}
                          >
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CREATOR_TYPES.map(ctype => (
                                <SelectItem key={ctype} value={ctype}>{ctype}</SelectItem>
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
                          disabled={idx === 0 || !canEdit}
                          className="h-6 w-6"
                          title={t('detail.moveUp')}
                        >
                          <ChevronUp className="size-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => moveCreator(idx, 1)}
                          disabled={idx === creatorsDraft.length - 1 || !canEdit}
                          className="h-6 w-6"
                          title={t('detail.moveDown')}
                        >
                          <ChevronDown className="size-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeCreator(idx)}
                          disabled={!canEdit}
                          className="h-6 w-6"
                          title={t('common:delete')}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {creatorsDraft.length === 0 && (
                    <div className="text-xs text-muted-foreground">{t('detail.noAuthors')}</div>
                  )}
                </div>
              </Section>

              {fields.other && fields.other.length > 0 && (
                <Section title={t('detail.other')}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                    {fields.other.map(name => (
                      <Field
                        key={name}
                        name={name}
                        value={draft.fields[name]}
                        onChange={v => setField(name, v)}
                        multiline={name === 'extra'}
                        readOnly={!canEdit}
                      />
                    ))}
                  </div>
                </Section>
              )}

              {/* Attachments */}
              <Section title={t('detail.attachments')}>
                <div className="divide-y divide-border border-y border-border">
                  {(attachments || []).map(a => {
                    const isPdf = (a.contentType || '').includes('pdf');
                    const filename = a.path ? a.path.split('/').pop() : a.key;
                    return (
                      <button
                        key={a.key}
                        onClick={() => isPdf ? openPreview(a.key) : undefined}
                        disabled={!isPdf}
                        className="flex w-full items-center gap-2 px-1 py-2 text-left text-sm transition-colors enabled:hover:bg-accent/50 disabled:cursor-default"
                        title={filename}
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-xs">{filename}</span>
                        <Badge variant="secondary" className="font-normal">{a.contentType || 'file'}</Badge>
                        {isPdf && <ExternalLink className="size-3 text-muted-foreground" />}
                      </button>
                    );
                  })}
                  {(attachments || []).length === 0 && (
                    <div className="text-xs text-muted-foreground">{t('detail.noAttachments')}</div>
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
                {activePdfKey ? (
                  <button
                    type="button"
                    onClick={openSignedPdf}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" /> {t('detail.newWindow')}
                  </button>
                ) : null}
              </div>
              {signedPdfUrl ? (
                <iframe
                  key={signedPdfUrl}
                  src={signedPdfUrl}
                  title="PDF preview"
                  className="w-full flex-1 rounded-sm border border-border/80 bg-muted/30"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  {t('detail.noPdfPreview')}
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {pdfAttachments.length > 0 && (
          <TabsContent value="fulltext" className="min-h-0 flex-1 overflow-hidden mt-2">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('common:loadingDots')}</div>}>
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

      <AlertDialog open={canEdit && deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('detail.deleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={del}>{t('common:delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CalibratePanel
        open={canEdit && calibrateOpen}
        onOpenChange={setCalibrateOpen}
        result={calibrateResult}
        loading={calibrateLoading}
        error={calibrateError}
        onApply={applyCalibration}
      />

      <CrossrefPanel
        open={canEdit && crossrefOpen}
        onOpenChange={setCrossrefOpen}
        result={crossrefResult}
        loading={crossrefLoading}
        error={crossrefError}
        onApply={applyCrossref}
      />
    </div>
  );
});
