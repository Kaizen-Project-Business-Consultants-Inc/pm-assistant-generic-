interface PresenceUser {
  userId: string;
  username: string;
}

interface PresenceAvatarsProps {
  variant: 'avatars';
  users: PresenceUser[];
  maxVisible?: number;
  label?: string;
}

interface PresenceChipProps {
  variant: 'chip';
  users: PresenceUser[];
  label?: string;
}

type PresenceIndicatorProps = PresenceAvatarsProps | PresenceChipProps;

function getInitials(username: string): string {
  return username
    .split(/[\s._-]+/)
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

export function PresenceIndicator(props: PresenceIndicatorProps) {
  if (props.users.length === 0) return null;

  if (props.variant === 'avatars') {
    const { users, maxVisible = 5, label = 'viewing' } = props;
    return (
      <div className="flex items-center mr-1" aria-label={`${users.length} user${users.length !== 1 ? 's' : ''} ${label}`}>
        <div className="flex -space-x-2">
          {users.slice(0, maxVisible).map((user) => (
            <div
              key={user.userId}
              className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/40 border-2 border-white dark:border-gray-800 flex items-center justify-center"
              title={`${user.username} is ${label}`}
            >
              <span className="text-[10px] font-semibold text-primary-700 dark:text-primary-300">
                {getInitials(user.username)}
              </span>
            </div>
          ))}
          {users.length > maxVisible && (
            <div
              className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 border-2 border-white dark:border-gray-900 flex items-center justify-center"
              title={`${users.length - maxVisible} more ${label}`}
            >
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                +{users.length - maxVisible}
              </span>
            </div>
          )}
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1.5 whitespace-nowrap">{label}</span>
      </div>
    );
  }

  // chip variant — for editing indicators
  const { users, label = 'editing' } = props;
  return (
    <span role="status" aria-live="polite" className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none" />
      <span className="truncate max-w-[120px] sm:max-w-none">
        {users.map((u) => u.username).join(', ')}
      </span>{' '}{label}
    </span>
  );
}
