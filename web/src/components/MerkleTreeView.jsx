import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { verifyDoiProofPath } from '@/lib/merkle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ArrowLeft, Search, GitBranch, RefreshCw, ShieldCheck, ShieldX,
  Hash, ArrowRight, Check, X, CheckCircle2, Moon, Sun,
} from 'lucide-react';
import { WalletButton } from './WalletButton';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';

function shortHash(hash) {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export function MerkleTreeView() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { canEdit } = useAuth();
  const { data: rootInfo, refresh: refreshRoot } = useAsync(() => api.getMerkleRoot(), []);
  const [doiInput, setDoiInput] = useState('');
  const [result, setResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [clientVerification, setClientVerification] = useState(null);

  const handleVerify = useCallback(async () => {
    const doi = doiInput.trim();
    if (!doi) return;

    setVerifying(true);
    setClientVerification(null);
    try {
      const res = await api.checkMerkleExists(doi);
      setResult(res);

      if (res.exists && res.proof?.path) {
        const verification = await verifyDoiProofPath(doi, res.proof);
        setClientVerification(verification);
      }
    } catch (err) {
      toast.error(`查询失败: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  }, [doiInput]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleVerify();
  };

  const handleRebuild = async () => {
    if (!canEdit) {
      toast.error('请先连接白名单钱包');
      return;
    }
    try {
      await api.rebuildMerkleTree();
      refreshRoot();
      toast.success('Merkle Tree 已重建');
    } catch (err) {
      toast.error(`重建失败: ${err.message}`);
    }
  };

  const clearQuery = () => {
    setDoiInput('');
    setResult(null);
    setClientVerification(null);
  };

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* Header — mirrors SearchPage layout */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          title="返回文库"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <div className="relative flex h-8 flex-1 max-w-md min-w-[160px] items-center">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="输入 DOI，例如 10.1016/j.is.2023.01.001"
            value={doiInput}
            onChange={(e) => setDoiInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-full pl-8 pr-8"
            autoFocus
          />
          {doiInput && (
            <button
              type="button"
              onClick={clearQuery}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title="清除"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {rootInfo && (
            <Badge variant="outline" className="hidden font-mono text-xs font-normal md:inline-flex">
              Root {shortHash(rootInfo.root)} · {rootInfo.leafCount} DOIs
            </Badge>
          )}
          <WalletButton />
          <Button
            size="sm"
            variant="outline"
            onClick={handleRebuild}
            disabled={!canEdit}
            title={canEdit ? '重建 Merkle Tree' : '请先连接白名单钱包'}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <div className="mx-auto max-w-2xl">
          {!result && !verifying && (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <GitBranch className="size-8 opacity-30" />
              <p className="mt-3 text-sm">输入 DOI 验证存在性证明</p>
              <p className="mt-1 text-xs">证明路径从叶子节点逐步哈希到根，可独立验证</p>
            </div>
          )}

          {verifying && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <RefreshCw className="size-6 animate-spin opacity-60" />
              <p className="text-sm">正在查询链上证明…</p>
            </div>
          )}

          {result && !result.exists && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-10 text-center">
              <ShieldX className="mx-auto mb-3 size-10 text-destructive" />
              <p className="font-medium text-destructive">DOI 不在数据库中</p>
              <code className="mt-1 block break-all text-xs text-muted-foreground">{result.doi}</code>
            </div>
          )}

          {result && result.exists && result.proof && (
            <ProofResult
              doi={result.doi}
              proof={result.proof}
              clientVerification={clientVerification}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProofResult({ doi, proof, clientVerification }) {
  const allStepsVerified = clientVerification?.steps.every((s) => s.verified) ?? false;
  const rootVerified = clientVerification?.rootVerified ?? false;
  const fullyVerified = allStepsVerified && rootVerified;

  return (
    <div className="space-y-3">
      {/* Summary block */}
      <div className={`rounded-md border px-4 py-3 ${fullyVerified ? 'border-emerald-500/40 bg-emerald-500/5' : 'bg-background'}`}>
        <div className="flex items-center gap-3">
          {fullyVerified ? (
            <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" />
            </div>
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-muted">
              <ShieldX className="size-4 text-destructive" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {fullyVerified ? '存在性证明验证通过' : '证明验证中…'}
            </p>
            <p className="text-xs text-muted-foreground">
              {proof.siblings.length} 步哈希路径 · 叶子到根
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">DOI</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{doi}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">Leaf Hash</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{proof.leafHash}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">Merkle Root</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{proof.root}</code>
          </div>
        </div>
      </div>

      {/* Verification status */}
      {clientVerification && (
        <div className={`rounded-md border px-4 py-3 text-sm ${fullyVerified ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}`}>
          <div className="flex items-center gap-2 font-medium">
            {fullyVerified ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <ShieldX className="size-4 text-destructive" />
            )}
            客户端独立验证
          </div>
          <ul className="mt-2 space-y-1">
            <li className="flex items-center gap-2 text-muted-foreground">
              <StepStatus verified={allStepsVerified} />
              每一步中间哈希: {allStepsVerified ? '全部匹配' : '存在不匹配'}
              <span className="text-xs">({clientVerification.steps.length} 步)</span>
            </li>
            <li className="flex items-center gap-2 text-muted-foreground">
              <StepStatus verified={rootVerified} />
              最终哈希 = Root: {rootVerified ? '匹配' : '不匹配'}
            </li>
          </ul>
        </div>
      )}

      {/* Step-by-step path */}
      <div className="rounded-md border bg-background px-4 py-3">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Hash className="size-4" />
          证明路径（叶子 → 根）
        </h2>

        <div className="space-y-1">
          <PathStep
            label="Leaf"
            subtitle="hash(DOI)"
            hash={proof.leafHash}
            highlight
          />

          <PathConnector />

          {proof.path.map((step, i) => (
            <div key={i}>
              <PathStep
                label={`Step ${step.step + 1}`}
                subtitle={
                  step.siblingSide === 'left'
                    ? 'hash(sibling + current)'
                    : 'hash(current + sibling)'
                }
                hash={step.outputHash}
                siblingHash={step.siblingHash}
                siblingSide={step.siblingSide}
                clientVerified={clientVerification?.steps[i]?.verified}
              />
              {i < proof.path.length - 1 && <PathConnector />}
            </div>
          ))}

          <PathConnector />

          <PathStep
            label="Root"
            subtitle="Merkle Root"
            hash={proof.root}
            highlight
            isRoot
            clientVerified={rootVerified}
          />
        </div>
      </div>
    </div>
  );
}

function StepStatus({ verified }) {
  return verified ? (
    <Check className="size-3.5 text-emerald-600" />
  ) : (
    <X className="size-3.5 text-destructive" />
  );
}

function PathStep({ label, subtitle, hash, highlight, isRoot, siblingHash, siblingSide, clientVerified }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? (isRoot ? 'border-primary bg-primary/5' : 'border-accent bg-accent/5') : 'border-border bg-muted/30'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {clientVerified !== undefined && (
            <StepStatus verified={clientVerified} />
          )}
        </div>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <code className="mt-1.5 block break-all font-mono text-xs">{hash}</code>
      {siblingHash && (
        <div className="mt-2 border-t pt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`rounded px-1.5 py-0.5 font-medium ${siblingSide === 'left' ? 'bg-blue-500/10 text-blue-600' : 'bg-orange-500/10 text-orange-600'}`}>
              {siblingSide === 'left' ? '← 左兄弟' : '右兄弟 →'}
            </span>
          </div>
          <code className="mt-1 block break-all font-mono text-xs text-muted-foreground">{siblingHash}</code>
        </div>
      )}
    </div>
  );
}

function PathConnector() {
  return (
    <div className="flex justify-center py-1">
      <div className="flex flex-col items-center text-muted-foreground">
        <div className="h-3 w-px bg-border" />
        <ArrowRight className="size-3 rotate-90" />
        <div className="h-3 w-px bg-border" />
      </div>
    </div>
  );
}
