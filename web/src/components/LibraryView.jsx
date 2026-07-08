import { useState, useCallback, useRef, useEffect } from 'react';
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
import { cn } from '@/lib/utils';
import { ITEM_TYPE_LABELS } from '@/lib/items';

const SIDEBAR_WIDTH = 260;
const MIN_DETAIL = 300;
const MAX_DETAIL = 640;

export function LibraryView() {
  const [filter, setFilter] = useState({ type: null, journal: '待归档', collection: null, search: null });
  const [selectedKey, setSelectedKey] = useState(null);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [sidebarVersion, setSidebarVersion] = useState(0);

  // Left sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Right detail panel (persistent, not Sheet)
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailWidth, setDetailWidth] = useState(520);
  const [detailDirty, setDetailDirty] = useState(false);

  // Confirm switch when dirty
  const [confirmSwitchTarget, setConfirmSwitchTarget] = useState(null);

  // Drag state refs (detail panel only)
  const detailResizing = useRef(false);
  const [isDetailResizing, setIsDetailResizing] = useState(false);

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
    toast.success(`已导入: ${result.parent?.fields?.title || '(未识别)'}`, {
      description: `类型: ${ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—'}`,
    });
    refreshItems();
    refreshSidebar();
    if (result.parent?.key) {
      setSelectedKey(result.parent.key);
      setDetailOpen(true);
    }
  }, [refreshItems, refreshSidebar]);

  const onItemDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDetailOpen(false);
    refreshItems();
    refreshSidebar();
    toast.success('条目已删除');
  }, [refreshItems, refreshSidebar]);

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
      // Ctrl/Cmd + I: Import PDF
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
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
  }, [detailOpen, detailDirty]);

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
        setIsDetailResizing(false);
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
    setIsDetailResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background">
      {/* Left sidebar — floats over the main content, does not affect layout */}
      {sidebarOpen && (
        <>
          {/* Click-outside scrim: clicking anywhere outside the panel collapses it */}
          <button
            type="button"
            aria-label="折叠侧栏"
            tabIndex={-1}
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 cursor-default bg-black/15 animate-in fade-in duration-150"
          />
          <div
            className="absolute left-3 top-3 bottom-3 z-30 flex"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <div className="relative flex h-full flex-1 flex-col border bg-background shadow-2xl overflow-hidden animate-in slide-in-from-left-full duration-200">
              <Sidebar
                filter={filter}
                onFilterChange={onFilterChange}
                version={sidebarVersion}
                onRefresh={refreshSidebar}
                onCollapse={() => setSidebarOpen(false)}
              />
            </div>
          </div>
        </>
      )}

      {/* Center: main content */}
      <main className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
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
      {detailOpen && (
        <>
          {/* Click-outside scrim: clicking anywhere outside the panel closes it */}
          <button
            type="button"
            aria-label="关闭详情"
            tabIndex={-1}
            onClick={() => {
              if (detailDirty) {
                toast.message('当前条目有未保存的修改', { description: '请先保存或放弃修改后再关闭。' });
                return;
              }
              setDetailOpen(false);
              setSelectedKey(null);
            }}
            className="absolute inset-0 z-20 cursor-default bg-black/15 animate-in fade-in duration-150"
          />
          <div
            className={cn(
              'absolute right-3 top-3 bottom-3 z-30 flex',
              isDetailResizing ? '' : 'transition-[width] duration-200 ease-out',
            )}
            style={{ width: Math.max(MIN_DETAIL, detailWidth) }}
          >
            {/* Left-edge resize handle */}
            <div
              onMouseDown={startDetailResize}
              className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
            />
            <div className="relative flex h-full flex-1 flex-col border bg-background shadow-2xl overflow-hidden animate-in slide-in-from-right-full duration-200">
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
                  请在左侧选择一个条目
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Confirm switch away from dirty item */}
      <AlertDialog open={!!confirmSwitchTarget} onOpenChange={(open) => { if (!open) setConfirmSwitchTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前条目有未保存的修改，切换后将丢失这些改动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>放弃并切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
