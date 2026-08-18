declare module 'html-to-docx' {
  function HTMLtoDOCX(
    html: string,
    headerHtml: string | null,
    options?: Record<string, any>,
  ): Promise<ArrayBuffer>;
  export default HTMLtoDOCX;
}
