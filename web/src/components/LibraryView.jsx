import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Sidebar } from '@/components/Sidebar';
import { ItemTable } from '@/components/ItemTable';
import { ItemDetail } from '@/components/ItemDetail';
import { TopBar } from '@/components/TopBar';
import { FloatingDetailPanel } from '@/components/FloatingDetailPanel';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

const SIDEBAR_WIDTH = 260;
const MIN_DETAIL = 360;
const MAX_DETAIL = 640;

export function LibraryView() {
  const { t } = useTranslation(['library', 'common']);
  const { canEdit } = useAuth();
  const isMobile = useIsMobile();

  usePageMeta({
    title: t('common:seo.siteTitle'),
    description: t('common:seo.siteDescription'),
    canonicalPath: '/',
    jsonLd: websiteJsonLd(),
  });
  const [filter, setFilter] = useState({ type: null, journal: null, collection: null, search: null });
  const [selectedKey, setSelectedKey] = useState(null);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [sidebarVersion, setSidebarVersion] = useState(0);

  // Left sidebar
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches,
  );

  // Right detail panel (persistent, not Sheet)
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailWidth, setDetailWidth] = useState(520);
  const [detailDirty, setDetailDirty] = useState(false);

  // Confirm switch when dirty
  const [confirmSwitchTarget, setConfirmSwitchTarget] = useState(null);

  // Drag state refs (detail panel only)
  const detailResizing = useRef(false);

  const refreshItems = useCallback(() => setItemsVersion(v => v + 1), []);
  const refreshSidebar = useCallback(() => setSidebarVersion(v => v + 1), []);

  const onFilterChange = useCallback((next) => {
    setFilter(prev => ({ ...prev, ...next }));
    setSelectedKey(null);
    setDetailOpen(false);
  }, []);

  const onSearch = useCallback((search) => {
    setFilter(prev => ({ ...prev, search: search || null }));
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + I: Import PDF (editors only)
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        if (!canEdit) {
          toast.error(t('common:connectWhitelistFirst'));
          return;
        }
        fileInputRef.current?.click();
      }
      // Escape: Close detail panel
      if (e.key === 'Escape' && detailOpen) {
        if (detailDirty) {
          // Let the dirty check handle it via confirmSwitchTarget
          return;
        }
        setDetailOpen(false);
        setSelectedKey(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailOpen, detailDirty, canEdit, t]);

  // Sidebar drag resize
  useEffect(() => {
    let rafId = null;
    let pendingClientX = null;

    const applyPending = () => {
      rafId = null;
      if (pendingClientX === null) return;
      const clientX = pendingClientX;
      pendingClientX = null;
      if (detailResizing.current) {
        const panelRight = window.innerWidth - clientX;
        const w = Math.max(MIN_DETAIL, Math.min(MAX_DETAIL, panelRight));
        setDetailWidth(w);
      }
    };

    const handleMouseMove = (e) => {
      if (!detailResizing.current) return;
      // Coalesce rapid mousemove events into at most one state update per
      // animation frame, so drag-resize doesn't schedule more re-renders
      // than the browser can actually paint.
      pendingClientX = e.clientX;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyPending);
      }
    };
    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (detailResizing.current) {
        detailResizing.current = false;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startDetailResize = useCallback((e) => {
    e.preventDefault();
    detailResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        {t('skipToList')}
      </a>
      {!isMobile && (
        <aside
          className={cn(
            'motion-library-sidebar hidden h-full shrink-0 border-r bg-background md:flex overflow-hidden',
            !sidebarOpen && 'border-r-0 pointer-events-none',
          )}
          style={{ width: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
          aria-hidden={!sidebarOpen}
        >
          <div style={{ width: SIDEBAR_WIDTH }} className="flex h-full shrink-0">
            <Sidebar
              filter={filter}
              onFilterChange={onFilterChange}
              version={sidebarVersion}
              onRefresh={refreshSidebar}
              onCollapse={() => setSidebarOpen(false)}
            />
          </div>
        </aside>
      )}
      {isMobile && (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[min(20rem,calc(100vw-2.5rem))] max-w-none p-0">
            <SheetTitle className="sr-only">{t('journals.heading')}</SheetTitle>
            <Sidebar
              filter={filter}
              onFilterChange={onFilterChange}
              version={sidebarVersion}
              onRefresh={refreshSidebar}
              onCollapse={() => setSidebarOpen(false)}
              onSelected={() => setSidebarOpen(false)}
              showCollapse={false}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Center: main content */}
      <main id="main-content" className="relative flex flex-1 flex-col min-w-0 overflow-hidden" tabIndex={-1}>
        <TopBar
          filter={filter}
          onImported={onImported}
          refreshItems={refreshItems}
          onSearch={onSearch}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(v => !v)}
          fileInputRef={fileInputRef}
          onSelectItem={onSelect}
        />
        <div className="flex-1 overflow-hidden">
          <ItemTable
            filter={filter}
            version={itemsVersion}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        </div>
      </main>

      {/* Right detail panel — floats over the main content, does not affect layout */}
      <FloatingDetailPanel
        open={detailOpen}
        onClose={() => {
          if (detailDirty) {
            toast.message(t('common:unsavedChangesToast'), { description: t('common:unsavedCloseDesc') });
            return;
          }
          setDetailOpen(false);
          setSelectedKey(null);
        }}
        width={Math.max(MIN_DETAIL, detailWidth)}
        resizeHandle={
          <button
            type="button"
            onMouseDown={startDetailResize}
            aria-label={t('adjustPanelWidth')}
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
          />
        }
      >
        {selectedKey ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ItemDetail
              itemKey={selectedKey}
              onDeleted={onItemDeleted}
              onChanged={refreshItems}
              onDirtyChange={setDetailDirty}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm">
            {t('selectItem')}
          </div>
        )}
      </FloatingDetailPanel>

      {/* Confirm switch away from dirty item */}
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
