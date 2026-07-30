import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-TW': { translation: zhTW },
  },
  lng: localStorage.getItem('i18n_lang') || 'zh-TW',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;

/** Toggle language and persist preference */
export function setLanguage(lang: 'en' | 'zh-TW') {
  localStorage.setItem('i18n_lang', lang);
  i18n.changeLanguage(lang);
}

/** Get current language */
export function getLanguage(): 'en' | 'zh-TW' {
  return (i18n.language as 'en' | 'zh-TW') || 'zh-TW';
}
