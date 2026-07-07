import { useState, useCallback, useRef, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
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
import { ChevronRight, ChevronLeft } from 'lucide-react';

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 360;
const MIN_DETAIL = 300;
const MAX_DETAIL = 640;

export default function App() {
  const [filter, setFilter] = useState({ type: null, journal: null, collection: null, search: null });
  const [selectedKey, setSelectedKey] = useState(null);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [sidebarVersion, setSidebarVersion] = useState(0);

  // Left sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(220);

  // Right detail panel (persistent, not Sheet)
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailWidth, setDetailWidth] = useState(400);
  const [detailDirty, setDetailDirty] = useState(false);

  // Confirm switch when dirty
  const [confirmSwitchTarget, setConfirmSwitchTarget] = useState(null);

  // Drag state refs
  const sidebarResizing = useRef(false);
  const detailResizing = useRef(false);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
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
      if (sidebarResizing.current) {
        const w = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, clientX));
        setSidebarWidth(w);
      }
      if (detailResizing.current) {
        const panelRight = window.innerWidth - clientX;
        const w = Math.max(MIN_DETAIL, Math.min(MAX_DETAIL, panelRight));
        setDetailWidth(w);
      }
    };

    const handleMouseMove = (e) => {
      if (!sidebarResizing.current && !detailResizing.current) return;
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
      if (sidebarResizing.current) {
        sidebarResizing.current = false;
        setIsSidebarResizing(false);
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

  const startSidebarResize = useCallback((e) => {
    e.preventDefault();
    sidebarResizing.current = true;
    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const startDetailResize = useCallback((e) => {
    e.preventDefault();
    detailResizing.current = true;
    setIsDetailResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Left sidebar */}
      <div
        className={cn(
          'shrink-0 border-r bg-muted/30 overflow-hidden',
          isSidebarResizing ? 'transition-none' : 'transition-[width] duration-200',
        )}
        style={{ width: sidebarOpen ? Math.max(MIN_SIDEBAR, sidebarWidth) : 0 }}
      >
        <div className="flex h-full w-full" style={{ minWidth: MIN_SIDEBAR }}>
          <Sidebar
            filter={filter}
            onFilterChange={onFilterChange}
            version={sidebarVersion}
            onRefresh={refreshSidebar}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      {/* Sidebar resize handle */}
      {sidebarOpen && (
        <div
          onMouseDown={startSidebarResize}
          className="w-1 shrink-0 bg-border cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
        />
      )}

      {/* Center: main content */}
      <main className="relative flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Floating expand button when sidebar is collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-0 top-2 z-20 flex items-center justify-center rounded-r-md border border-l-0 bg-background px-0.5 py-1 text-muted-foreground shadow-sm hover:text-foreground hover:bg-muted/60 transition-colors"
            title="展开侧栏"
          >
            <ChevronRight className="size-3" />
          </button>
        )}
        <TopBar
          filter={filter}
          onImported={onImported}
          refreshItems={refreshItems}
          onSearch={onSearch}
          sidebarVersion={sidebarVersion}
          fileInputRef={fileInputRef}
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

      {/* Detail panel resize handle (left edge of detail panel) */}
      {detailOpen && (
        <div
          onMouseDown={startDetailResize}
          className="w-1 shrink-0 bg-border cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
        />
      )}

      {/* Right detail panel */}
      {detailOpen && (
        <div
          className={cn(
            'shrink-0 border-l bg-background flex flex-col overflow-hidden',
            isDetailResizing ? 'transition-none' : 'transition-[width] duration-200',
          )}
          style={{ width: Math.max(MIN_DETAIL, detailWidth) }}
        >
          {/* Detail panel header with collapse button */}
          <div className="flex h-10 items-center justify-end border-b px-2">
            <button
              onClick={() => { setDetailOpen(false); setSelectedKey(null); }}
              className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="关闭详情"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
          {selectedKey ? (
            <div className="flex-1 overflow-hidden">
              <ItemDetail
                itemKey={selectedKey}
                onDeleted={onItemDeleted}
                onChanged={refreshItems}
                onDirtyChange={setDetailDirty}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
              请在左侧选择一个条目
            </div>
          )}
        </div>
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

      <Toaster richColors position="bottom-right" />
    </div>
  );
}
