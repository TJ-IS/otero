import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import commonZh from '../locales/zh-CN/common.json';
import libraryZh from '../locales/zh-CN/library.json';
import dashboardZh from '../locales/zh-CN/dashboard.json';
import adminZh from '../locales/zh-CN/admin.json';
import docsZh from '../locales/zh-CN/docs.json';
import itemZh from '../locales/zh-CN/item.json';

import commonEn from '../locales/en/common.json';
import libraryEn from '../locales/en/library.json';
import dashboardEn from '../locales/en/dashboard.json';
import adminEn from '../locales/en/admin.json';
import docsEn from '../locales/en/docs.json';
import itemEn from '../locales/en/item.json';

export const SUPPORTED_LANGS = ['zh-CN', 'en'];

function normalizeLanguage(lng) {
  if (!lng) return 'zh-CN';
  const lower = String(lng).toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en';
  return SUPPORTED_LANGS.includes(lng) ? lng : 'zh-CN';
}

function syncDocumentLang(lng) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalizeLanguage(lng);
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: commonZh,
        library: libraryZh,
        dashboard: dashboardZh,
        admin: adminZh,
        docs: docsZh,
        item: itemZh,
      },
      en: {
        common: commonEn,
        library: libraryEn,
        dashboard: dashboardEn,
        admin: adminEn,
        docs: docsEn,
        item: itemEn,
      },
    },
    fallbackLng: 'zh-CN',
    supportedLngs: SUPPORTED_LANGS,
    // Do NOT enable nonExplicitSupportedLngs with hyphenated codes like zh-CN:
    // it breaks resource lookup and leaves t() returning raw keys.
    load: 'currentOnly',
    defaultNS: 'common',
    ns: ['common', 'library', 'dashboard', 'admin', 'docs', 'item'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'otero.lang',
      caches: ['localStorage'],
      convertDetectedLanguage: normalizeLanguage,
    },
    react: {
      useSuspense: false,
    },
  });

syncDocumentLang(i18n.language);
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
