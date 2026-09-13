// Avatar identity hues mapped to identity.* tokens from tailwind.config.js
const AVATAR_COLORS = [
  'bg-identity-1',  // cyan-700
  'bg-identity-2',  // indigo-700
  'bg-identity-3',  // purple-700
  'bg-identity-4',  // fuchsia-700
  'bg-identity-5',  // rose-700
  'bg-identity-6',  // amber-700
  'bg-identity-7',  // lime-700
  'bg-identity-8',  // blue-800
];

// Hex values for inline styles (must match identity.* tokens in tailwind.config.js)
const IDENTITY_HEX = [
  '#0e7490', '#4338ca', '#7e22ce', '#a21caf',
  '#be123c', '#b45309', '#4d7c0f', '#1e40af',
];

function hashName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

export function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
}

export function getAvatarHex(name: string): string {
  return IDENTITY_HEX[hashName(name) % IDENTITY_HEX.length];
}

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: 'w-5 h-5', text: 'text-[8px]' },
  sm: { container: 'w-6 h-6', text: 'text-[9px]' },
  md: { container: 'w-7 h-7', text: 'text-xs' },
  lg: { container: 'w-8 h-8', text: 'text-xs' },
};

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
  title?: string;
  colored?: boolean;
}

export function Avatar({ name, size = 'xs', className = '', title, colored = true }: AvatarProps) {
  const s = SIZE_CLASSES[size];
  const bg = colored
    ? `${getAvatarColor(name)} text-white`
    : 'bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400';

  return (
    <div
      className={`${s.container} rounded-full ${bg} flex items-center justify-center ${s.text} font-bold flex-shrink-0 ${className}`}
      title={title}
    >
      {getInitials(name)}
    </div>
  );
}
