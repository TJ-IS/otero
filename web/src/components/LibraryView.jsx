import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { websiteJsonLd } from '@/lib/seo';
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
import { toast } from 'sonner';
import { ItemTable } from '@/components/ItemTable';
import { ItemDetail } from '@/components/ItemDetail';
import { LibraryToolbar } from '@/components/LibraryToolbar';
import { ItemDetailDialog } from '@/components/ItemDetailDialog';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/SiteHeader';

function parseYearParam(value) {
  if (value == null || value === '') return null;
  if (!/^\d+$/.test(String(value))) return null;
  const year = Number(value);
  if (!Number.isSafeInteger(year) || year < 1500 || year > 2099) return null;
  return year;
}

export function LibraryView() {
  const { t } = useTranslation(['library', 'common']);
  const { canEdit } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  usePageMeta({
    title: t('common:seo.libraryTitle'),
    description: t('common:seo.libraryDescription'),
    canonicalPath: '/library',
    jsonLd: websiteJsonLd(),
  });
  const [filter, setFilter] = useState(() => ({
    type: null,
    journal: searchParams.get('journal') || null,
    collection: null,
    search: null,
    year: parseYearParam(searchParams.get('year')),
  }));
  const [selectedKey, setSelectedKey] = useState(null);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [journalsVersion, setJournalsVersion] = useState(0);
  const [tableStatus, setTableStatus] = useState({ total: 0, loading: true });

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const [confirmSwitchTarget, setConfirmSwitchTarget] = useState(null);

  const refreshItems = useCallback(() => setItemsVersion((v) => v + 1), []);
  const refreshSidebar = useCallback(() => setJournalsVersion((v) => v + 1), []);

  useEffect(() => {
    const urlYear = parseYearParam(searchParams.get('year'));
    setFilter((prev) => (prev.year === urlYear ? prev : { ...prev, year: urlYear }));
  }, [searchParams]);

  const onFilterChange = useCallback((next) => {
    setFilter((prev) => ({ ...prev, ...next }));
    if ('year' in next) {
      const nextParams = new URLSearchParams(searchParams);
      if (next.year) nextParams.set('year', String(next.year));
      else nextParams.delete('year');
      setSearchParams(nextParams, { replace: true });
    }
    setSelectedKey(null);
    setDetailOpen(false);
  }, [searchParams, setSearchParams]);

  const onSearch = useCallback((search) => {
    setFilter((prev) => ({ ...prev, search: search || null }));
    setSelectedKey(null);
    setDetailOpen(false);
  }, []);

  const onImported = useCallback((result) => {
    toast.success(t('import.success', { title: result.parent?.fields?.title || t('import.unrecognized') }), {
      description: t('import.type', { type: ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—' }),
    });
    refreshItems();
    refreshSidebar();
    if (result.parent?.key) {
      setSelectedKey(result.parent.key);
      setDetailOpen(true);
    }
  }, [refreshItems, refreshSidebar, t]);

  const onItemDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDetailOpen(false);
    refreshItems();
    refreshSidebar();
    toast.success(t('itemDeleted'));
  }, [refreshItems, refreshSidebar, t]);

  const onSelect = useCallback((key) => {
    if (key === selectedKey) return;
    if (detailDirty) {
      setConfirmSwitchTarget(key);
      return;
    }
    setSelectedKey(key);
    setDetailOpen(true);
  }, [selectedKey, detailDirty]);

  const confirmSwitch = useCallback(() => {
    if (confirmSwitchTarget) {
      setDetailDirty(false);
      setSelectedKey(confirmSwitchTarget);
      setDetailOpen(true);
      setConfirmSwitchTarget(null);
    }
  }, [confirmSwitchTarget]);

  const fileInputRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        if (!canEdit) {
          toast.error(t('common:connectWhitelistFirst'));
          return;
        }
        fileInputRef.current?.click();
      }
      if (e.key === 'Escape' && detailOpen) {
        if (detailDirty) return;
        setDetailOpen(false);
        setSelectedKey(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailOpen, detailDirty, canEdit, t]);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      <SiteHeader />
      <main
        id="main-content"
        className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col overflow-hidden px-4 sm:px-6 lg:px-8"
        tabIndex={-1}
      >
        <LibraryToolbar
          filter={filter}
          onImported={onImported}
          refreshItems={refreshItems}
          onSearch={onSearch}
          onFilterChange={onFilterChange}
          journalsVersion={journalsVersion}
          fileInputRef={fileInputRef}
          onSelectItem={onSelect}
          total={tableStatus.total}
          loading={tableStatus.loading}
        />
        <ItemTable
          filter={filter}
          version={itemsVersion}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onStatusChange={setTableStatus}
        />
      </main>

      <ItemDetailDialog
        open={detailOpen && !!selectedKey}
        onClose={() => {
          if (detailDirty) {
            toast.message(t('common:unsavedChangesToast'), { description: t('common:unsavedCloseDesc') });
            return;
          }
          setDetailOpen(false);
          setSelectedKey(null);
        }}
      >
        <ItemDetail
          itemKey={selectedKey}
          onDeleted={onItemDeleted}
          onChanged={refreshItems}
          onDirtyChange={setDetailDirty}
        />
      </ItemDetailDialog>

      <AlertDialog open={!!confirmSwitchTarget} onOpenChange={(open) => { if (!open) setConfirmSwitchTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common:unsavedSwitchTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('common:unsavedSwitchDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:continueEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>{t('common:discardAndSwitch')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
