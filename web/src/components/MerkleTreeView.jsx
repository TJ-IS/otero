import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { verifyDoiProofPath } from '@/lib/merkle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ArrowLeft, Search, GitBranch, RefreshCw, ShieldCheck, ShieldX, Hash, ArrowRight } from 'lucide-react';
import { WalletButton } from './WalletButton';
import { useAuth } from '@/contexts/AuthContext';

function shortHash(hash) {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export function MerkleTreeView() {
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

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button size="sm" variant="ghost" asChild className="shrink-0">
          <Link to="/">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">返回</span>
          </Link>
        </Button>
        <GitBranch className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">DOI 存在性证明</h1>

        <div className="ml-auto flex items-center gap-2">
          {rootInfo && (
            <span className="hidden text-sm text-muted-foreground md:inline">
              Root: <code className="font-mono text-xs">{shortHash(rootInfo.root)}</code>
              <span className="ml-2">({rootInfo.leafCount} DOIs)</span>
            </span>
          )}
          <WalletButton />
          <Button size="sm" variant="outline" onClick={handleRebuild} disabled={!canEdit} title={canEdit ? '重建 Merkle Tree' : '请先连接白名单钱包'}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      {/* Search bar */}
      <div className="border-b px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="输入 DOI，例如 10.1016/j.is.2023.01.001"
              value={doiInput}
              onChange={(e) => setDoiInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-10 pl-10"
              autoFocus
            />
          </div>
          <Button onClick={handleVerify} disabled={verifying || !doiInput.trim()} className="h-10">
            {verifying ? '验证中…' : '验证'}
          </Button>
        </div>
      </div>

      {/* Result area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {!result && !verifying && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
              <GitBranch className="size-12 opacity-30" />
              <p>输入一个 DOI 来生成 Merkle 存在性证明</p>
              <p className="text-sm">证明路径将从叶子节点逐步哈希到根，可独立验证</p>
            </div>
          )}

          {verifying && (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              正在查询…
            </div>
          )}

          {result && !result.exists && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
              <ShieldX className="mx-auto mb-3 size-10 text-destructive" />
              <p className="font-medium text-destructive">DOI 不在数据库中</p>
              <code className="mt-2 block break-all text-sm text-muted-foreground">{result.doi}</code>
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
    <div className="space-y-6">
      {/* Summary card */}
      <div className={`rounded-lg border p-5 ${fullyVerified ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'}`}>
        <div className="flex items-center gap-3">
          {fullyVerified ? (
            <ShieldCheck className="size-8 text-green-600" />
          ) : (
            <ShieldX className="size-8 text-destructive" />
          )}
          <div className="flex-1">
            <p className="font-semibold">
              {fullyVerified ? '存在性证明验证通过' : '证明验证中…'}
            </p>
            <p className="text-sm text-muted-foreground">
              {proof.siblings.length} 步哈希路径 · 叶子到根
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">DOI</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{doi}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">Leaf Hash</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{proof.leafHash}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">Merkle Root</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{proof.root}</code>
          </div>
        </div>
      </div>

      {/* Verification status */}
      {clientVerification && (
        <div className={`rounded-lg border p-4 text-sm ${fullyVerified ? 'border-green-500/30 bg-green-500/5 text-green-700' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
          <div className="flex items-center gap-2 font-medium">
            {fullyVerified ? <ShieldCheck className="size-5" /> : <ShieldX className="size-5" />}
            客户端独立验证
          </div>
          <ul className="mt-2 space-y-1">
            <li>
              ✓ 每一步中间哈希: {allStepsVerified ? '全部匹配' : '存在不匹配'}
              <span className="ml-1 text-muted-foreground">({clientVerification.steps.length} 步)</span>
            </li>
            <li>
              ✓ 最终哈希 = Root: {rootVerified ? '匹配' : '不匹配'}
            </li>
          </ul>
        </div>
      )}

      {/* Step-by-step path */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Hash className="size-4" />
          证明路径（叶子 → 根）
        </h2>

        {/* Leaf node */}
        <PathStep
          label="Leaf"
          subtitle={`hash(DOI)`}
          hash={proof.leafHash}
          highlight
        />

        {/* Connection */}
        <PathConnector />

        {/* Each step */}
        {proof.path.map((step, i) => (
          <div key={i}>
            <PathStep
              label={`Step ${step.step + 1}`}
              subtitle={
                step.siblingSide === 'left'
                  ? `hash(sibling + current)`
                  : `hash(current + sibling)`
              }
              hash={step.outputHash}
              siblingHash={step.siblingHash}
              siblingSide={step.siblingSide}
              clientVerified={clientVerification?.steps[i]?.verified}
            />
            {i < proof.path.length - 1 && <PathConnector />}
          </div>
        ))}

        {/* Connection to root */}
        <PathConnector />

        {/* Root node */}
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
  );
}

function PathStep({ label, subtitle, hash, highlight, isRoot, siblingHash, siblingSide, clientVerified }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? (isRoot ? 'border-primary bg-primary/5' : 'border-accent bg-accent/5') : 'border-border bg-card'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{label}</span>
          {clientVerified !== undefined && (
            <span className={`text-xs ${clientVerified ? 'text-green-600' : 'text-destructive'}`}>
              {clientVerified ? '✓' : '✗'}
            </span>
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
    <div className="flex justify-center py-1.5">
      <div className="flex flex-col items-center text-muted-foreground">
        <div className="h-4 w-px bg-border" />
        <ArrowRight className="size-3 rotate-90" />
        <div className="h-4 w-px bg-border" />
      </div>
    </div>
  );
}
