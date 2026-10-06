import type { JSX } from 'preact';

const paths = {
  send: 'M7 17 17 7M9 7h8v8',
  receive: 'M17 7 7 17M15 17H7V9',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12.5 10 17.5 19 7',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  eyeOff:
    'M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.5 7.1C4 8.8 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a2.5 2.5 0 0 0 3.5 3.5',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.2 2.5 3.5 5.2',
  key: 'M14.5 9.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM13.7 12.3 20 18.5V21h-2.5v-2h-2v-2l-1.6-1.6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  more: 'M12 5.25a.75.75 0 1 1 0 .01M12 12a.75.75 0 1 1 0 .01M12 18.75a.75.75 0 1 1 0 .01',
  cart: 'M3 4h2l2.3 11.2h11.4L21 8H6.2M9.5 20a.75.75 0 1 1 0 .01M17.5 20a.75.75 0 1 1 0 .01',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  shield: 'M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  alert: 'M12 3 2 20h20zM12 10v4M12 17.5v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8L3.5 9.7l5.9-.8z',
  layers: 'M12 3 2.5 8 12 13l9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v3M16.5 13.5h.5',
  paste: 'M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  history: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 8v4.5l3 2',
  swap: 'M7 4 3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  class: cls,
  ...rest
}: {
  name: IconName;
  size?: number;
  class?: string;
} & JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      class={`icon ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Brand mark: a small directed acyclic graph forming an "X". */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" class="logo">
      <defs>
        <linearGradient id="xg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1fb6ff" />
          <stop offset="1" stop-color="#6b5cff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#xg)" />
      <g stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".95">
        <path d="M20 20 44 44M44 20 20 44" />
      </g>
      <g fill="#fff">
        <circle cx="20" cy="20" r="5" />
        <circle cx="44" cy="20" r="5" />
        <circle cx="20" cy="44" r="5" />
        <circle cx="44" cy="44" r="5" />
        <circle cx="32" cy="32" r="6" fill="#0d1b3a" stroke="#fff" stroke-width="3" />
      </g>
    </svg>
  );
}
