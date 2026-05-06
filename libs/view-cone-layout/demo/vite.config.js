import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // Inline %VITE_*% placeholders inside HTML files so the keys live only in .env
  // (.env is gitignored). Vite's built-in HTML transform handles JS modules,
  // but the <script> tag setting window.SNAPCLOUD_PROJECT in preview.html / index.html
  // is plain HTML — this plugin substitutes the placeholders at serve time.
  const htmlEnv = {
    name: 'inject-html-env',
    transformIndexHtml(html) {
      return html.replace(/%VITE_([A-Z0-9_]+)%/g, (_, key) => env[`VITE_${key}`] ?? '');
    },
  };

  return {
    server: {
      port: 5180,
      // localhost-only — never bind to all interfaces, that exposes the anon key
      // (and JPEG stream) to the LAN.
      host: 'localhost',
      strictPort: true,
    },
    plugins: [htmlEnv],
  };
});
