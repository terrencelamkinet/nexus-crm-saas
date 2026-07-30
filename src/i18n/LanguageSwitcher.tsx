import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage } from './config';

export default function LanguageSwitcher() {
  const { t } = useTranslation();
  const current = getLanguage();

  return (
    <select
      value={current}
      onChange={(e) => setLanguage(e.target.value as 'en' | 'zh-TW')}
      className="language-switcher"
      aria-label={t('settings.profile.language')}
    >
      <option value="zh-TW">{t('settings.language.zh-TW')}</option>
      <option value="en">{t('settings.language.en')}</option>
    </select>
  );
}
