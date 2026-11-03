const P: Record<string, string> = {
  list: 'M4 6h16M4 12h16M4 18h10',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zm0 14a2 2 0 0 1 2-2h13',
  sync: 'M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18 3v4.5h-4.5M6 21v-4.5h4.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.3-4.3',
  x: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 4l9 16H3L12 4zm0 6v4m0 3h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
