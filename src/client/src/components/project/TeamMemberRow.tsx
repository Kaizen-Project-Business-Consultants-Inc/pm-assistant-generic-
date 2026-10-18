import { Avatar } from '../ui/Avatar';

interface Member {
  userName?: string;
  email?: string;
  role?: string;
}

/**
 * A member's name. The members list sends the person's CURRENT full name as userName (the copy
 * stored when they were added was often their email — U36); the email is the last resort.
 */
export function memberName(m: Member): string {
  return m.userName || m.email || 'Unknown';
}

/** One person on the Overview's Team Members card: initials, full name, email below, role */
export function TeamMemberRow({ member }: { member: Member }) {
  const name = memberName(member);
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
        {member.email && member.email !== name && (
          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{member.email}</p>
        )}
      </div>
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 capitalize">
        {member.role || 'member'}
      </span>
    </div>
  );
}
