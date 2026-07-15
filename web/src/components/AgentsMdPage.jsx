import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function CodeBlock({ children, className }) {
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all',
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function AgentsMdPage() {
  const [agentsMd, setAgentsMd] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/open/v1/SKILL.md')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setAgentsMd(text);
      })
      .catch((err) => {
        if (!cancelled) {
          setAgentsMd('');
          toast.error(`加载 AGENTS.md 失败: ${err.message}`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    if (!agentsMd) return;
    try {
      await copyText(agentsMd);
      setCopied(true);
      toast.success('已复制 AGENTS.md');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">AGENTS.md</h2>
            <p className="text-sm text-muted-foreground">
              复制下方内容保存为 <code className="text-xs">AGENTS.md</code> 或{' '}
              <code className="text-xs">SKILL.md</code>
              ，供其他 Agent 访问本站开放数据。
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!agentsMd || loading}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? '已复制' : '复制'}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/api/open/v1/SKILL.md" target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                原始文件
              </a>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : (
          <CodeBlock className="max-h-[calc(100dvh-12rem)] overflow-y-auto">
            {agentsMd || '（空）'}
          </CodeBlock>
        )}
      </section>
    </main>
  );
}
