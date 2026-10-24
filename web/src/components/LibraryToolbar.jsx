import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Check,
  ChevronDown,
  Upload,
  RefreshCw,
  Search,
  X,
  ListChecks,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { ITEM_TYPE_LABELS, UNFILED, filterTitle } from '@/lib/items';
import { MineruTaskLog } from './MineruTaskLog';
import { useAuth } from '../contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';

function displayJournalName(name, t) {
  return name === UNFILED ? t('unfiled', { ns: 'common' }) : name;
}

const JournalPicker = memo(function JournalPicker({ filter, onFilterChange, version }) {
  const { t } = useTranslation(['library', 'common']);
  const { canEdit } = useAuth();
  const { data: journals } = useAsync((signal) => api.listJournals({ signal }), [version, canEdit]);
  const current = filter?.journal;
  const label = current ? displayJournalName(current, t) : t('journals.all');

  const select = (value) => {
    if (current === value) return;
    onFilterChange({ type: null, journal: value, collection: null });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 max-w-[14rem] shrink-0 justify-between gap-1.5 font-normal sm:max-w-[18rem]"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{t('journals.heading')}</span>
          {journals?.length ? (
            <span className="font-mono tabular-nums">{journals.length}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => select(null)} className="justify-between">
          <span>{t('journals.all')}</span>
          {!current ? <Check className="size-3.5 text-brand" /> : null}
        </DropdownMenuItem>
        {(journals || []).length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t('journals.empty')}</div>
        ) : (
          (journals || []).map((journal) => (
            <DropdownMenuItem
              key={journal.name}
              onClick={() => select(journal.name)}
              className="justify-between gap-3"
            >
              <span className="min-w-0 truncate">{displayJournalName(journal.name, t)}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {journal.itemCount}
                </span>
                {current === journal.name ? <Check className="size-3.5 text-brand" /> : null}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/**
 * Page-level heading and controls for the library. This is page content, not a
 * second header bar: the title identifies where you are, the row below acts.
 */
export const LibraryToolbar = memo(function LibraryToolbar({
  filter,
  onImported,
  refreshItems,
  onSearch,
  onFilterChange,
  journalsVersion,
  fileInputRef: externalRef,
  onSelectItem,
  total,
  loading,
}) {
  const { t } = useTranslation(['library', 'common']);
  const internalRef = useRef(null);
  const fileInput = externalRef || internalRef;
  const [searchValue, setSearchValue] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [batchParsing, setBatchParsing] = useState(false);
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  const title = filterTitle(filter);

  useEffect(() => {
    if (!canEdit) setLogOpen(false);
  }, [canEdit]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchValue !== (filter?.search || '')) onSearch(searchValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, filter?.search, onSearch]);

  useEffect(() => {
    if (filter?.journal || filter?.collection || filter?.search == null) setSearchValue('');
  }, [filter?.journal, filter?.collection, filter?.search]);

  const handleFiles = async (files) => {
    for (const file of files) {
      const tid = toast.loading(t('import.loading', { name: file.name }));
      try {
        const result = await api.uploadPdf(file);
        toast.success(
          t('import.success', { title: result.parent?.fields?.title || t('import.unrecognized') }),
          {
            id: tid,
            description: t('import.type', {
              type: ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—',
            }),
          },
        );
        onImported(result);
      } catch (err) {
        toast.error(t('import.failed', { message: err.message }), { id: tid });
      }
    }
  };

  const onFileInputChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    await handleFiles(files);
  };

  const clearSearch = () => {
    setSearchValue('');
    onSearch('');
  };

  const batchParseAll = useCallback(async () => {
    if (!canEdit) {
      toast.error(t('common:connectWhitelistFirst'));
      return;
    }
    if (!total || batchParsing) return;
    setBatchParsing(true);
    const tid = toast.loading(t('table.collecting'));
    try {
      const keys = await api.listItemKeys({
        type: filter?.type,
        journal: filter?.journal,
        collection: filter?.collection,
        search: filter?.search,
        year: filter?.year,
      });
      if (!keys.length) {
        toast.info(t('table.nothingToParse'), { id: tid });
        return;
      }
      toast.loading(t('table.queuing', { count: keys.length }), { id: tid });
      const res = await api.parseFulltextBatch(keys);
      const s = res.summary || {};
      const parts = [];
      if (s.queued) parts.push(t('table.queued', { count: s.queued }));
      if (s.skippedDone) parts.push(t('table.skippedDone', { count: s.skippedDone }));
      if (s.skippedRunning) parts.push(t('table.skippedRunning', { count: s.skippedRunning }));
      if (s.noPdf) parts.push(t('table.noPdf', { count: s.noPdf }));
      if (s.notFound) parts.push(t('table.notFound', { count: s.notFound }));
      const summary = parts.length ? parts.join('，') : t('table.noOp');
      if (s.queued > 0) {
        toast.success(t('table.batchSuccess', { summary }), { id: tid });
      } else {
        toast.info(t('table.batchInfo', { summary }), { id: tid });
      }
    } catch (err) {
      toast.error(t('table.batchFailed', { message: err.message }), { id: tid });
    } finally {
      setBatchParsing(false);
    }
  }, [
    canEdit,
    total,
    batchParsing,
    filter?.type,
    filter?.journal,
    filter?.collection,
    filter?.search,
    filter?.year,
    t,
  ]);

  return (
    <div className="shrink-0 space-y-4 pb-4 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-brand">
            {t('common:nav.library')}
          </p>
          <h1
            className="mt-1 truncate font-display text-2xl font-semibold tracking-tight"
            title={title}
          >
            {title}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-3 pb-1">
          {canEdit && total > 0 ? (
            <button
              type="button"
              onClick={batchParseAll}
              disabled={batchParsing}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              title={t('table.batchParseTitle')}
            >
              {batchParsing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {t('table.batchParse')}
            </button>
          ) : null}
          <span className="text-xs tabular-nums text-muted-foreground">
            {loading ? t('common:loadingDots') : t('table.itemCount', { count: total })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <JournalPicker filter={filter} onFilterChange={onFilterChange} version={journalsVersion} />
        {filter?.year ? (
          <button
            type="button"
            onClick={() => onFilterChange({ year: null })}
            title={t('clearYear')}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 border border-border px-2.5 text-sm tabular-nums text-foreground transition-colors hover:border-brand hover:text-brand active:scale-[0.98]"
          >
            {t('yearChip', { year: filter.year })}
            <X className="size-3.5" />
          </button>
        ) : null}
        <div className="relative flex h-9 min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={t('search.placeholder')}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchValue.trim()) {
                e.preventDefault();
                navigate(`/search?q=${encodeURIComponent(searchValue.trim())}`);
              }
            }}
            className="h-9 w-full bg-transparent pl-8 pr-8 shadow-none focus-visible:border-brand focus-visible:ring-0"
          />
          {searchValue ? (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 text-muted-foreground transition-colors hover:text-brand"
              title={t('search.clear')}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshItems}
            title={t('common:refreshList')}
            className="size-9 text-muted-foreground hover:text-brand"
          >
            <RefreshCw className="size-4" />
          </Button>
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLogOpen(true)}
              title={t('nav.mineruLog')}
              className="size-9 text-muted-foreground hover:text-brand"
            >
              <ListChecks className="size-4" />
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <Button size="sm" onClick={() => fileInput.current?.click()} className="h-9 gap-1.5">
                <Upload className="size-3.5" />
                <span className="hidden sm:inline">{t('importPdf')}</span>
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={onFileInputChange}
              />
            </>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <MineruTaskLog open={logOpen} onOpenChange={setLogOpen} onSelectItem={onSelectItem} />
      ) : null}
    </div>
  );
});
