import { signal } from '@preact/signals';

/** Minimal hash router: "#/send?to=abc" -> { path: '/send', query: { to: 'abc' } } */
export interface Route {
  path: string;
  query: Record<string, string>;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path = '/', qs = ''] = raw.split('?');
  const query: Record<string, string> = {};
  new URLSearchParams(qs).forEach((v, k) => (query[k] = v));
  return { path, query };
}

export const route = signal<Route>(parse(location.hash));
export const navDirection = signal<'forward' | 'back'>('forward');

const stack: string[] = [location.hash || '#/'];

window.addEventListener('hashchange', () => {
  const h = location.hash || '#/';
  const idx = stack.lastIndexOf(h);
  if (idx >= 0 && idx === stack.length - 2) {
    stack.pop();
    navDirection.value = 'back';
  } else {
    stack.push(h);
    navDirection.value = 'forward';
  }
  route.value = parse(h);
});

export function navigate(path: string, query?: Record<string, string>, replace = false): void {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  const hash = `#${path}${qs}`;
  if (replace) {
    history.replaceState(null, '', hash);
    stack[stack.length - 1] = hash;
    navDirection.value = 'forward';
    route.value = parse(hash);
  } else if (location.hash !== hash) {
    location.hash = hash;
  } else {
    route.value = parse(hash);
  }
}

export function goBack(fallback = '/home'): void {
  if (stack.length > 1) history.back();
  else navigate(fallback, undefined, true);
}
