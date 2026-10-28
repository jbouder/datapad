import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import appleTouchIcon from '../public/apple-touch-icon.png?inline';
import faviconSvg from '../public/favicon.svg?raw';
import icon192 from '../public/icon-192.png?inline';
import icon512 from '../public/icon-512.png?inline';
import maskable from '../public/icon-maskable-512.png?inline';
import manifestText from '../public/site.webmanifest?raw';

/**
 * The home-screen icon (#219). Every path, assets included, is behind
 * Cloudflare Access, and a phone fetching an icon on its own, without the
 * session cookie, gets the sign-in page and draws a letter instead. So the
 * icons a phone installs from are embedded as data: URLs (nothing to
 * fetch), and the manifest, which the page fetches, goes with the cookie.
 * `npm run icons` writes them; this keeps them in step with public/.
 */

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

const manifest = JSON.parse(manifestText) as {
  description: string;
  icons: Icon[];
};

/** The base64 after a data: URL's comma. */
function payload(url: string): string {
  return url.slice(url.indexOf(',') + 1);
}

/** The SVG as written (Vite's `?inline` would tidy it first). */
const favicon = `data:image/svg+xml;base64,${btoa(faviconSvg)}`;

describe('the installed app icon', () => {
  it('links the manifest with credentials', () => {
    expect(html).toMatch(
      /<link rel="manifest" href="\/site\.webmanifest" crossorigin="use-credentials" \/>/,
    );
  });

  it('embeds the apple-touch-icon, the same image as the file', () => {
    const link = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html);
    expect(link?.[1]).toMatch(/^data:image\/png;base64,/);
    expect(payload(link?.[1] ?? '')).toBe(payload(appleTouchIcon));
  });

  it('embeds every manifest icon, each the same image as its file', () => {
    const expected: Record<string, string> = {
      '192x192 any': icon192,
      '512x512 any': icon512,
      '512x512 maskable': maskable,
      'any any': favicon,
    };
    expect(manifest.icons).toHaveLength(Object.keys(expected).length);
    for (const icon of manifest.icons) {
      const file = expected[`${icon.sizes} ${icon.purpose}`];
      expect(file, `${icon.sizes} ${icon.purpose}`).toBeDefined();
      expect(icon.src.startsWith(`data:${icon.type};base64,`)).toBe(true);
      expect(payload(icon.src)).toBe(payload(file ?? ''));
    }
  });

  it('describes what Datapad holds now', () => {
    for (const text of [
      manifest.description,
      ...Array.from(
        html.matchAll(
          /(?:name|property)="(?:og:)?description" content="([^"]+)"/g,
        ),
        (m) => m[1],
      ),
    ]) {
      expect(text).not.toMatch(/events/);
      expect(text).toMatch(/meetings/);
    }
  });
});
