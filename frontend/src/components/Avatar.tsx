import type { DemoProfile } from '../types';

export function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'NP';
}

export function Avatar({ name, size = 'md', className = '' }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span className={`avatar avatar-${size} ${className}`} aria-hidden="true">{getInitials(name)}</span>;
}

export function ProfileAvatar({ profile, size = 'md' }: { profile: DemoProfile; size?: 'sm' | 'md' | 'lg' }) {
  return <Avatar name={profile.name} size={size} />;
}
