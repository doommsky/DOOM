/** Board 24 icon set · 24 px grid · 1.8 stroke · round caps. Decorative by default (aria-hidden). */
const PATHS = {
  pulse: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.3',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M16.5 16.5L20 20M11 17.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z',
  shield: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z',
  shieldCheck: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  package: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  archive: 'M3 4h18v5H3zM5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  terminal: 'M3 4h18v16H3zM7 9.5l3 2.5-3 2.5M13 15h4',
  chip: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  gpu: 'M2 7h20v10H2zM5 17v3M19 17v3M8 10v4M16 10v4',
  disk: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0',
  restart: 'M12 3v8M6.3 7.5a8 8 0 1 0 11.4 0',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  grid: 'M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 5l12 7-12 7z',
  stop: 'M6 6h12v12H6z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.3',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.5 4.5 0 0 0 7 18z',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 17, stroke = 1.8, label, className, style }: { name: IconName; size?: number; stroke?: number; label?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} className={className} style={style} focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
