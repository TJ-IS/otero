import { Badge } from '@/components/ui/badge';
import { BookOpen, Library, List } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

export const Sidebar = memo(function Sidebar({ filter, onFilterChange, version, onCollapse, onSelected, showCollapse = true }) {
  // Re-fetch when auth changes: the "待归档" bucket is only returned by the
  // API for whitelisted editors, so login/logout must refresh the list.
  const { canEdit } = useAuth();
  const { data: journals } = useAsync((signal) => api.listJournals({ signal }), [version, canEdit]);

  const isActive = (value) => filter?.journal === value;

  const select = (value) => {
    if (isActive(value)) {
      onSelected?.();
      return;
    }
    onFilterChange({ type: null, journal: value, collection: null });
    onSelected?.();
  };

  return (
    <aside className="flex w-full shrink-0 flex-col bg-muted/30">
      <div className="flex h-12 items-center gap-2 border-b px-4 font-semibold">
        <Library className="size-5" />
        <span className="flex-1">Otero</span>
        {showCollapse && (
          <button onClick={onCollapse} className="text-muted-foreground hover:text-foreground transition-colors" title="折叠侧栏">
            <span className="text-base leading-none">&lsaquo;</span>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-2 py-3">
          <div className="mb-1 flex items-center gap-1.5 px-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">期刊分类</span>
            {journals && journals.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">{journals.length}</Badge>
            )}
          </div>
          <div className="space-y-0.5">
            <SidebarItem
              icon={<List className="size-4" />}
              label="全部期刊"
              active={isActive(null)}
              onClick={() => select(null)}
            />
            {(journals || []).length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">暂无期刊</div>
            )}
            {(journals || []).map(j => (
              <SidebarItem
                key={j.name}
                icon={<BookOpen className="size-4" />}
                label={j.name}
                count={j.itemCount}
                active={isActive(j.name)}
                onClick={() => select(j.name)}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
});

const SidebarItem = memo(function SidebarItem({ icon, label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
      )}
    </button>
  );
});
