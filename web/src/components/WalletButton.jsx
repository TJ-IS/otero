import { useState } from 'react';
import { Wallet, LogOut, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Button } from './ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.jsx';

function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { t } = useTranslation('common');
  const { address, canEdit, connecting, login, logout } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!address) {
    return (
      <Button variant="outline" size="sm" onClick={login} disabled={connecting} className="gap-1.5">
        <Wallet className="h-4 w-4" />
        <span className="hidden sm:inline">
          {connecting ? t('connecting') : t('connectWallet')}
        </span>
      </Button>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3">
          <Wallet className="h-4 w-4" />
          <span className="hidden sm:inline">{shortenAddress(address)}</span>
          {canEdit && (
            <span className="ml-1 hidden rounded-sm bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success sm:inline">
              {t('editAllowed')}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="font-mono text-xs font-normal text-muted-foreground sm:hidden">
          {shortenAddress(address)}
          {canEdit ? ` · ${t('editAllowed')}` : ''}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="sm:hidden" />
        <DropdownMenuItem onClick={handleCopy} className="gap-2">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? t('copied') : t('copyAddress')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={logout}
          className="gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          {t('disconnectWallet')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
