/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'html2pdf.js' {
  const html2pdf: any;
  export default html2pdf;
}

/** Build id stamped by vite.config.ts ('dev' outside production builds) */
declare const __APP_BUILD__: string;
