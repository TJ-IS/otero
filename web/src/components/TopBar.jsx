import { memo, useRef, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, RefreshCw, Search, X, Moon, Sun, PanelLeft, ListChecks, GitBranch } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import { useAsync } from '@/hooks/useAsync';
import { MineruTaskLog } from './MineruTaskLog';
import { WalletButton } from './WalletButton';
import { useAuth } from '../contexts/AuthContext';

export const TopBar = memo(function TopBar({ filter, onImported, refreshItems, onSearch, sidebarOpen = false, onToggleSidebar, fileInputRef: externalRef, onSelectItem }) {
  const internalRef = useRef(null);
  const fileInput = externalRef || internalRef;
  const searchRef = useRef(null);
  const [searchValue, setSearchValue] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchValue !== (filter?.search || '')) {
        onSearch(searchValue);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, filter?.search, onSearch]);

  // Clear search when filter changes
  useEffect(() => {
    if (filter?.journal || filter?.collection) {
      setSearchValue('');
    }
  }, [filter?.journal, filter?.collection]);

  // Clear the input when the filter's search is reset to null externally
  // (e.g. by selecting a different journal/collection in the sidebar). We
  // intentionally do NOT depend on `searchValue` here: depending on it would
  // wipe out each keystroke during the 300ms debounce window, because at
  // that moment searchValue is non-empty but filter.search is still null.
  useEffect(() => {
    if (filter?.search == null) {
      setSearchValue('');
    }
  }, [filter?.search]);

  const handleFiles = async (files) => {
    for (const file of files) {
      const tid = toast.loading(`正在导入 ${file.name}...`);
      try {
        const result = await api.uploadPdf(file);
        toast.success(`已导入: ${result.parent?.fields?.title || '(未识别)'}`, {
          id: tid,
          description: `类型: ${ITEM_TYPE_LABELS[result.parent?.itemType] || result.parent?.itemType || '—'}`,
        });
        onImported(result);
      } catch (err) {
        toast.error(`导入失败: ${err.message}`, { id: tid });
      }
    }
  };

  const onFileInputChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';
    await handleFiles(files);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const clearSearch = () => {
    setSearchValue('');
    onSearch('');
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSidebar}
          title={sidebarOpen ? '折叠侧栏' : '展开侧栏'}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}
      <div className="relative flex h-8 flex-1 max-w-md min-w-[160px] items-center">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          placeholder="搜索标题、作者、DOI..."
          value={searchValue}
          onChange={e => setSearchValue(e.target.value)}
          onKeyDown={e => {
            // Enter jumps to the dedicated search page with the typed query,
            // which offers richer result cards + snippet highlighting.
            if (e.key === 'Enter' && searchValue.trim()) {
              e.preventDefault();
              navigate(`/search?q=${encodeURIComponent(searchValue.trim())}`);
            }
          }}
          className="h-8 w-full pl-8 pr-8"
        />
        {searchValue && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            title="清除搜索"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          asChild
          title="打开搜索页"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Link to="/search">
            <Search className="size-4" />
            <span className="hidden sm:inline">搜索</span>
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          asChild
          title="Merkle Tree 可视化"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Link to="/merkle">
            <GitBranch className="size-4" />
            <span className="hidden sm:inline">Merkle</span>
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLogOpen(true)}
          title="MinerU 解析任务日志"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ListChecks className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button variant="outline" size="sm" onClick={refreshItems} title="刷新列表">
          <RefreshCw className="size-4" />
        </Button>
        <WalletButton />
        <Button size="sm" onClick={() => canEdit ? fileInput.current?.click() : toast.error('请先连接白名单钱包')} disabled={!canEdit}>
          <Upload className="size-4" />
          <span className="hidden sm:inline">导入 PDF</span>
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={onFileInputChange}
          disabled={!canEdit}
        />
      </div>

      <MineruTaskLog open={logOpen} onOpenChange={setLogOpen} onSelectItem={onSelectItem} />
    </header>
  );
});
