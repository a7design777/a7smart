/**
 * Мінімальний набір лінійних іконок — одна товщина штриха, без заливки,
 * у дусі SF Symbols. Замінює емодзі/юнікод-гліфи, які раніше стояли
 * замість системи іконок (⏻ ☀ 🌡 ◐ тощо).
 */
export type IconName =
  | 'devices'
  | 'scenes'
  | 'energy'
  | 'history'
  | 'apartments'
  | 'sun'
  | 'moon'
  | 'circle-half'
  | 'edit'
  | 'check'
  | 'power'
  | 'info'
  | 'plug'
  | 'bulb'
  | 'thermometer'
  | 'waveform'
  | 'camera'
  | 'dot'
  | 'grip'
  | 'close'
  | 'chevron-down'
  | 'chevron-up'
  | 'plus'
  | 'trash'
  | 'bolt'
  | 'droplet'
  | 'flame'
  | 'wind'
  | 'play'
  | 'building';

const PATHS: Record<IconName, string> = {
  devices:
    'M4 4.5h6.2v6.2H4V4.5Zm9.8 0H20v6.2h-6.2V4.5ZM4 13.3h6.2v6.2H4v-6.2Zm9.8 0H20v6.2h-6.2v-6.2Z',
  scenes: 'M12 3.5 13.6 8l4.5 1.6-4.5 1.6L12 15.7l-1.6-4.5L6 9.6l4.5-1.6L12 3.5ZM5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8L5 16Zm14-2 .7 1.8L21.5 16l-1.8.7L19 18.5l-.7-1.8-1.8-.7 1.8-.7L19 14Z',
  energy: 'M4 20V9.5h4V4h8v6.5h4V20H4Zm4 0v-6h8v6',
  history: 'M4 20V11m6 9V6m6 14v-9m6 9V4',
  apartments:
    'M5 21V6l7-3 7 3v15M9 21v-5h6v5M9 11h1m4 0h1M9 8h1m4 0h1',
  sun: 'M12 6.5A5.5 5.5 0 1 0 12 17.5 5.5 5.5 0 0 0 12 6.5ZM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20.5 14.7A8.5 8.5 0 1 1 9.3 3.5a7 7 0 0 0 11.2 11.2Z',
  'circle-half': 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 0v17',
  edit: 'M4 16.9V20h3.1L18 9.1l-3.1-3.1L4 16.9ZM14.9 6l3.1 3.1',
  check: 'M4.5 12.5 9 17l10.5-10.5',
  power: 'M12 3v8M6.5 6.3a7.5 7.5 0 1 0 11 0',
  info: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-8.4V16m0-7.2h.01',
  plug: 'M9 3v5M15 3v5M6.5 8h11v4a5.5 5.5 0 0 1-11 0V8ZM12 17.5V21',
  bulb: 'M9 21h6M9.5 17.2h5M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9v1H14.5v-1c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3Z',
  thermometer:
    'M12 14.5V5a2 2 0 1 0-4 0v9.5a4 4 0 1 0 4 0Z',
  waveform: 'M3 12h2.5l1.8-6.5L10.5 18l2.4-10 1.8 4.5H21',
  camera:
    'M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 3a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z',
  dot: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-down': 'M6 9.5 12 15l6-5.5',
  'chevron-up': 'M6 14.5 12 9l6 5.5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M9 7V5h6v2m-8 0 .8 12.5A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.5L17 7',
  bolt: 'M13 3 5 13.5h5.5L11 21l8-11.5h-5.5L13 3Z',
  droplet: 'M12 3.5S6 10.3 6 14.5a6 6 0 0 0 12 0C18 10.3 12 3.5 12 3.5Z',
  flame:
    'M12 2.5S8 7 8 11a4 4 0 0 0 8 0c0-1-.4-1.8-.9-2.6.6.4 1.9 1.6 1.9 4.1a5 5 0 0 1-10 0c0-4.3 5-10 5-10Z',
  wind: 'M3 8h11a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h9a2 2 0 1 1-2 2',
  play: 'M7 4.8v14.4L19 12 7 4.8Z',
  building: 'M5 21V6l7-3 7 3v15M9 21v-5h6v5M9 11h1m4 0h1M9 8h1m4 0h1',
};

/** Категорія пристрою → іконка. Спільне для карток пристроїв і режиму редагування. */
export const KIND_ICON: Record<
  'switch' | 'light' | 'climate' | 'sensor' | 'camera' | 'unknown',
  IconName
> = {
  switch: 'plug',
  light: 'bulb',
  climate: 'thermometer',
  sensor: 'waveform',
  camera: 'camera',
  unknown: 'dot',
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path
        d={PATHS[name]}
        fill={name === 'play' ? 'currentColor' : 'none'}
        stroke={name === 'play' ? 'none' : undefined}
      />
    </svg>
  );
}
