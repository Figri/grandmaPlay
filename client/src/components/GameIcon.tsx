/** 大厅游戏卡片的插画（纯 SVG） */
export function GameIcon({ id }: { id: string }) {
  switch (id) {
    case 'gomoku':
      return (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="4" y="4" width="56" height="56" rx="10" fill="#e9bf7d" />
          {[14, 24, 34, 44, 54].map((v) => (
            <g key={v} stroke="#7a4f22" strokeWidth="1.6">
              <line x1={v - 4} y1="10" x2={v - 4} y2="54" />
              <line x1="10" y1={v - 4} x2="54" y2={v - 4} />
            </g>
          ))}
          <circle cx="20" cy="30" r="6.5" fill="#2a2420" />
          <circle cx="30" cy="20" r="6.5" fill="#fff" stroke="#7a4f22" strokeWidth="1.2" />
          <circle cx="30" cy="40" r="6.5" fill="#2a2420" />
          <circle cx="40" cy="30" r="6.5" fill="#fff" stroke="#7a4f22" strokeWidth="1.2" />
          <circle cx="40" cy="50" r="6.5" fill="#2a2420" />
        </svg>
      );
    case 'doudizhu':
      return (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="4" y="4" width="56" height="56" rx="10" fill="#f6d7c8" />
          <g transform="rotate(-16 32 40)">
            <rect x="14" y="14" width="22" height="32" rx="3" fill="#fff" stroke="#c44" strokeWidth="1.6" />
            <text x="18" y="27" fontSize="10" fill="#c44" fontWeight="bold">A</text>
          </g>
          <g transform="rotate(4 32 40)">
            <rect x="22" y="12" width="22" height="32" rx="3" fill="#fff" stroke="#333" strokeWidth="1.6" />
            <text x="26" y="25" fontSize="10" fill="#333" fontWeight="bold">K</text>
          </g>
          <g transform="rotate(20 32 40)">
            <rect x="30" y="14" width="22" height="32" rx="3" fill="#fff" stroke="#c44" strokeWidth="1.6" />
            <text x="34" y="27" fontSize="9" fill="#c44" fontWeight="bold">王</text>
          </g>
        </svg>
      );
    case 'guandan':
      return (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="4" y="4" width="56" height="56" rx="10" fill="#d8ecd9" />
          <rect x="12" y="16" width="20" height="30" rx="3" fill="#fff" stroke="#2c7a4b" strokeWidth="1.6" />
          <rect x="22" y="12" width="20" height="30" rx="3" fill="#fff" stroke="#2c7a4b" strokeWidth="1.6" />
          <rect x="32" y="18" width="20" height="30" rx="3" fill="#fff" stroke="#c44" strokeWidth="1.6" />
          <text x="37" y="38" fontSize="13" fill="#c44" fontWeight="bold">2</text>
        </svg>
      );
    case 'tractor':
      return (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="4" y="4" width="56" height="56" rx="10" fill="#dfe6f7" />
          <rect x="12" y="14" width="18" height="26" rx="3" fill="#fff" stroke="#3c63b0" strokeWidth="1.6" />
          <rect x="22" y="14" width="18" height="26" rx="3" fill="#fff" stroke="#3c63b0" strokeWidth="1.6" />
          <rect x="32" y="14" width="18" height="26" rx="3" fill="#fff" stroke="#c44" strokeWidth="1.6" />
          <circle cx="22" cy="50" r="5" fill="#3c63b0" />
          <circle cx="42" cy="50" r="5" fill="#3c63b0" />
          <rect x="16" y="42" width="32" height="5" rx="2" fill="#3c63b0" />
        </svg>
      );
    case 'tetris':
      return (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="4" y="4" width="56" height="56" rx="10" fill="#efe1f7" />
          {[
            [12, 38, '#9a6bc0'],
            [22, 38, '#9a6bc0'],
            [32, 38, '#9a6bc0'],
            [22, 28, '#9a6bc0'],
            [36, 18, '#e0703d'],
            [36, 28, '#e0703d'],
            [46, 28, '#e0703d'],
            [42, 46, '#3f9a72'],
            [32, 48, '#3f9a72'],
          ].map(([x, y, c], i) => (
            <rect key={i} x={x as number} y={y as number} width="9" height="9" rx="2" fill={c as string} />
          ))}
        </svg>
      );
    case 'snake':
      return (
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect x="4" y="4" width="56" height="56" rx="10" fill="#e2f2d6" />
          <path d="M14 46h16a6 6 0 0 0 0-12H22a6 6 0 0 1 0-12h20" fill="none" stroke="#5f9a3f" strokeWidth="7" strokeLinecap="round" />
          <circle cx="44" cy="22" r="5" fill="#5f9a3f" />
          <circle cx="45.5" cy="20.5" r="1.3" fill="#fff" />
          <circle cx="48" cy="44" r="4" fill="#e0503d" />
        </svg>
      );
    default:
      return null;
  }
}
