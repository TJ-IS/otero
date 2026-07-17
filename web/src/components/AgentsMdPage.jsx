import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['docs', 'common']);
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
          toast.error(t('agents.loadFailed', { message: err.message }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleCopy = async () => {
    if (!agentsMd) return;
    try {
      await copyText(agentsMd);
      setCopied(true);
      toast.success(t('agents.copiedMd'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('agents.copyFailed'));
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">AGENTS.md</h2>
            <p className="text-sm text-muted-foreground">
              {t('agents.hint')}
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
              {copied ? t('agents.copied') : t('agents.copy')}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/api/open/v1/SKILL.md" target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                {t('agents.rawFile')}
              </a>
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
            {t('agents.loading')}
          </div>
        ) : (
          <CodeBlock className="max-h-[calc(100dvh-12rem)] overflow-y-auto">
            {agentsMd || t('agents.empty')}
          </CodeBlock>
        )}
      </section>
    </main>
  );
}
