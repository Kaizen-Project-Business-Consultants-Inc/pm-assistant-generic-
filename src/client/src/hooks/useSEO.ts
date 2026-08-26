import { useEffect } from 'react';

interface SEOOptions {
  title: string;
  description: string;
  canonical?: string;
  jsonLd?: Record<string, unknown>;
}

const BASE_TITLE = 'Kovarti PM';
const BASE_URL = 'https://kovarti.com';

export function useSEO({ title, description, canonical, jsonLd }: SEOOptions) {
  useEffect(() => {
    // Title
    document.title = title.includes(BASE_TITLE) ? title : `${title} | ${BASE_TITLE}`;

    // Meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', description);
    }

    // OG tags
    const setMeta = (property: string, content: string) => {
      let el = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
      if (el) el.setAttribute('content', content);
    };
    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);

    // Canonical
    if (canonical) {
      const url = canonical.startsWith('http') ? canonical : `${BASE_URL}${canonical}`;
      setMeta('og:url', url);
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (link) link.href = url;
    }

    // JSON-LD
    let scriptEl: HTMLScriptElement | null = null;
    if (jsonLd) {
      scriptEl = document.createElement('script');
      scriptEl.type = 'application/ld+json';
      scriptEl.text = JSON.stringify(jsonLd);
      document.head.appendChild(scriptEl);
    }

    return () => {
      // Reset title on unmount
      document.title = `${BASE_TITLE} — AI-Powered Project Management`;
      if (scriptEl) document.head.removeChild(scriptEl);
    };
  }, [title, description, canonical, jsonLd]);
}
