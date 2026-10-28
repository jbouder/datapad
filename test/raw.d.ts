/** Vite's `?raw` imports: the file's text. */
declare module '*?raw' {
  const text: string;
  export default text;
}

/** Vite's `import.meta.glob`, as the tests use it: files' text by path. */
interface ImportMeta {
  glob<T>(
    pattern: string | string[],
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, T>;
  /** Without options: each file's path, nothing loaded until asked. */
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
}

/** Vite's `?inline` asset imports: the file as a data: URL. */
declare module '*?inline' {
  const url: string;
  export default url;
}
