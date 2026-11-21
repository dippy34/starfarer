/** The interface's icons: small line drawings in the current text colour (24 px grid). */
const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z"/>'),
  time: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.3 2"/>'),
  more: svg('<path d="M4 7h7M15 7h5M4 12h2M10 12h10M4 17h10M18 17h2"/><circle cx="13" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="17" r="2"/>'),
  go: svg('<path d="M20.5 3.5 3.5 10.2l7.2 3.1 3.1 7.2z"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.4v.2" stroke-width="2.4"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  centre: svg('<circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>'),
  orbit: svg('<circle cx="12" cy="12" r="3.2"/><path d="M4 9.5a8.5 8.5 0 0 1 15.3-2.3"/><path d="M20 14.5a8.5 8.5 0 0 1-15.3 2.3"/><path d="M19.7 3.5v3.9h-3.9M4.3 20.5v-3.9h3.9"/>'),
  look: svg('<path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  play: svg('<path d="M8 5.2v13.6l11-6.8z" fill="currentColor"/>'),
  pause: svg('<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.8"/>'),
  slower: svg('<path d="m12 6-6.5 6 6.5 6M19 6l-6.5 6 6.5 6"/>'),
  faster: svg('<path d="m12 6 6.5 6-6.5 6M5 6l6.5 6-6.5 6"/>'),
  reverse: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5v4.2h4.2"/><path d="M12 8v4.2l-2.7 1.8"/>'),
  now: svg('<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>'),
  camera: svg('<path d="M4 8.5h3l1.6-2.5h6.8l1.6 2.5h3v10.5H4z"/><circle cx="12" cy="13.3" r="3.3"/>'),
  photo: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="10.5" r="1.6"/><path d="m5.5 17 4.5-4 3 2.5 3-3 3.5 3.5"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.2 1-1.2 1.8"/><path d="M12 16.7v.2" stroke-width="2.4"/>'),
  fullscreen: svg('<path d="M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5"/>'),
  chevron: svg('<path d="m9.5 6 6 6-6 6"/>'),
  // a world with a new moon beside it (what if: src/app/WhatIf.ts)
  moon: svg('<circle cx="9.5" cy="14.5" r="6"/><circle cx="18.2" cy="6" r="2.3"/><path d="M18.2 1.2v1.3M18.2 9.5v1.3M13.4 6h1.3M21.7 6H23"/>'),
  unmake: svg('<circle cx="12" cy="12" r="7.5" stroke-dasharray="2.6 3"/><path d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4"/>'),
  // the powers over a world, and live physics (src/app/LivePhysics.ts): a weight, a pulse, the way back
  mass: svg('<path d="M8.3 9h7.4l3 10.5H5.3z"/><circle cx="12" cy="6.2" r="2.6"/>'),
  live: svg('<path d="M2.5 12h4l2.5-6.5 4.5 13 2.5-6.5h5.5"/>'),
  back: svg('<path d="M9 5.5 4 10.5l5 5"/><path d="M4 10.5h10.5a5 5 0 0 1 0 10H11"/>'),
};

export type IconName = keyof typeof ICON;
