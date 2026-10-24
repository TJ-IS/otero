import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { verifyDoiProofPath } from '@/lib/merkle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Search,
  GitBranch,
  RefreshCw,
  ShieldX,
  Hash,
  ArrowRight,
  Check,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

function shortHash(hash) {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export function MerkleTreeView() {
  const { t } = useTranslation(['dashboard', 'common']);
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
      toast.error(t('merkle.queryFailed', { message: err.message }));
    } finally {
      setVerifying(false);
    }
  }, [doiInput, t]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleVerify();
  };

  const handleRebuild = async () => {
    if (!canEdit) {
      toast.error(t('common:connectWhitelistFirst'));
      return;
    }
    try {
      await api.rebuildMerkleTree();
      refreshRoot();
      toast.success(t('merkle.rebuilt'));
    } catch (err) {
      toast.error(t('merkle.rebuildFailed', { message: err.message }));
    }
  };

  const clearQuery = () => {
    setDoiInput('');
    setResult(null);
    setClientVerification(null);
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-page flex-col overflow-hidden bg-background px-4 sm:px-6 lg:px-8">
      <div className="shrink-0 pb-4 pt-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-brand">
          {t('common:nav.dashboard')}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          {t('nav.merkle')}
        </h1>
      </div>
      <header className="flex shrink-0 items-center gap-2 border-y border-border/80 py-3">
        <div className="relative flex h-8 flex-1 max-w-md min-w-[160px] items-center">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('merkle.doiPlaceholder')}
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
              title={t('common:clear')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {rootInfo && (
            <Badge
              variant="outline"
              className="hidden font-mono text-xs font-normal md:inline-flex"
            >
              Root {shortHash(rootInfo.root)} · {rootInfo.leafCount} DOIs
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleRebuild}
            disabled={!canEdit}
            title={canEdit ? t('merkle.rebuildTitle') : t('merkle.rebuildNeedWallet')}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto py-4">
        <div className="mx-auto max-w-2xl">
          {!result && !verifying && (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <GitBranch className="size-8 opacity-30" />
              <p className="mt-3 text-sm">{t('merkle.emptyHint')}</p>
              <p className="mt-1 text-xs">{t('merkle.emptyHint2')}</p>
            </div>
          )}

          {verifying && (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <RefreshCw className="size-6 animate-spin opacity-60" />
              <p className="text-sm">{t('merkle.querying')}</p>
            </div>
          )}

          {result && !result.exists && (
            <div className="rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-10 text-center">
              <ShieldX className="mx-auto mb-3 size-10 text-destructive" />
              <p className="font-medium text-destructive">{t('merkle.notInDb')}</p>
              <code className="mt-1 block break-all text-xs text-muted-foreground">
                {result.doi}
              </code>
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
  const { t } = useTranslation('dashboard');
  const allStepsVerified = clientVerification?.steps.every((s) => s.verified) ?? false;
  const rootVerified = clientVerification?.rootVerified ?? false;
  const fullyVerified = allStepsVerified && rootVerified;

  return (
    <div className="space-y-3">
      {/* Summary block */}
      <div
        className={`rounded-sm border px-4 py-3 ${fullyVerified ? 'border-success/40 bg-success/5' : 'bg-background'}`}
      >
        <div className="flex items-center gap-3">
          {fullyVerified ? (
            <div className="flex size-8 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="size-4 text-success" />
            </div>
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-muted">
              <ShieldX className="size-4 text-destructive" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {fullyVerified ? t('merkle.verified') : t('merkle.verifying')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('merkle.pathSteps', { count: proof.siblings.length })}
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">DOI</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {doi}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">Leaf Hash</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {proof.leafHash}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">Merkle Root</span>
            <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {proof.root}
            </code>
          </div>
        </div>
      </div>

      {/* Verification status */}
      {clientVerification && (
        <div
          className={`rounded-sm border px-4 py-3 text-sm ${fullyVerified ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'}`}
        >
          <div className="flex items-center gap-2 font-medium">
            {fullyVerified ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <ShieldX className="size-4 text-destructive" />
            )}
            {t('merkle.clientVerify')}
          </div>
          <ul className="mt-2 space-y-1">
            <li className="flex items-center gap-2 text-muted-foreground">
              <StepStatus verified={allStepsVerified} />
              {t('merkle.stepHash', {
                status: allStepsVerified ? t('merkle.stepsMatch') : t('merkle.stepsMismatch'),
              })}
              <span className="text-xs">
                {t('merkle.stepsCount', { count: clientVerification.steps.length })}
              </span>
            </li>
            <li className="flex items-center gap-2 text-muted-foreground">
              <StepStatus verified={rootVerified} />
              {t('merkle.rootEquals', {
                status: rootVerified ? t('merkle.rootMatch') : t('merkle.rootMismatch'),
              })}
            </li>
          </ul>
        </div>
      )}

      {/* Step-by-step path */}
      <div className="rounded-sm border bg-background px-4 py-3">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Hash className="size-4" />
          {t('merkle.proofPath')}
        </h2>

        <div className="space-y-1">
          <PathStep label="Leaf" subtitle="hash(DOI)" hash={proof.leafHash} highlight />

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
    <Check className="size-3.5 text-success" />
  ) : (
    <X className="size-3.5 text-destructive" />
  );
}

function PathStep({
  label,
  subtitle,
  hash,
  highlight,
  isRoot,
  siblingHash,
  siblingSide,
  clientVerified,
}) {
  const { t } = useTranslation('dashboard');
  return (
    <div
      className={`rounded-sm border p-3 ${highlight ? (isRoot ? 'border-primary bg-primary/5' : 'border-accent bg-accent/5') : 'border-border bg-muted/30'}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {clientVerified !== undefined && <StepStatus verified={clientVerified} />}
        </div>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      <code className="mt-1.5 block break-all font-mono text-xs">{hash}</code>
      {siblingHash && (
        <div className="mt-2 border-t pt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`rounded-sm px-1.5 py-0.5 font-medium ${siblingSide === 'left' ? 'bg-brand/10 text-brand' : 'bg-warning/15 text-warning'}`}
            >
              {siblingSide === 'left' ? t('merkle.leftSibling') : t('merkle.rightSibling')}
            </span>
          </div>
          <code className="mt-1 block break-all font-mono text-xs text-muted-foreground">
            {siblingHash}
          </code>
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
