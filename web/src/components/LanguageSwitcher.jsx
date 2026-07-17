import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { code: 'zh-CN', labelKey: 'langZh' },
  { code: 'en', labelKey: 'langEnFull' },
];

export function LanguageSwitcher({ className }) {
  const { i18n, t } = useTranslation('common');
  const current = (i18n.resolvedLanguage || i18n.language || 'zh-CN').startsWith('zh')
    ? 'zh-CN'
    : 'en';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={t('language')}
          className={className || 'shrink-0 text-muted-foreground hover:text-foreground'}
        >
          <Languages className="size-4" />
          <span className="hidden sm:inline text-xs">
            {current === 'zh-CN' ? t('langZh') : t('langEn')}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.code}
            onClick={() => i18n.changeLanguage(opt.code)}
            className={current === opt.code ? 'font-medium' : undefined}
          >
            {t(opt.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
