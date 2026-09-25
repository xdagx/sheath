// Test helper: "chooses" a folder in an <input type=file webkitdirectory> of the extension.
// Playwright's own directory upload never completes in persistent browser contexts (the only
// kind that can load an extension), so the files are handed to the page with the same
// webkitRelativePath values a real folder pick produces, and a change event is dispatched.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

export async function pickFolder(locator, dir) {
  const root = basename(dir);
  const entries = walk(dir).map((p) => ({ path: `${root}/${relative(dir, p).split(sep).join('/')}`, data: readFileSync(p).toString('base64') }));
  await locator.evaluate((input, list) => {
    const files = list.map((e) => {
      const f = new File([Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0))], e.path.split('/').pop());
      Object.defineProperty(f, 'webkitRelativePath', { value: e.path });
      return f;
    });
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, entries);
}
