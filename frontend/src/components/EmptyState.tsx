import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({ title, description, action, icon: Icon = Inbox }: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: typeof Inbox;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon size={23} strokeWidth={1.7} aria-hidden="true" /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
