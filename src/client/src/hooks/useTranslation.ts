import { useCallback } from 'react';
import { useLocaleStore } from '../stores/localeStore';
import en from '../i18n/en.json';

/** Look a dotted key up in one bundle */
function lookup(bundle: unknown, key: string): string | undefined {
  let val: any = bundle;
  for (const part of key.split('.')) {
    if (val && typeof val === 'object' && part in val) val = val[part];
    else return undefined;
  }
  return typeof val === 'string' ? val : undefined;
}

export function useTranslation() {
  const translations = useLocaleStore((s) => s.translations);

  const t = useCallback(
    // The chosen language, else English, else the key (a missing key is caught by i18nKeys.test)
    (key: string): string => lookup(translations, key) ?? lookup(en, key) ?? key,
    [translations]
  );

  return { t };
}
