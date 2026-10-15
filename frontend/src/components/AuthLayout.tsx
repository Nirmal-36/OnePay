import type { PropsWithChildren, ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Brand } from './Brand';

interface AuthLayoutProps extends PropsWithChildren {
  eyebrow: string;
  title: string;
  description: string;
  footer?: ReactNode;
}

export function AuthLayout({ eyebrow, title, description, footer, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <div className="auth-decoration auth-decoration-one" aria-hidden="true" />
      <div className="auth-decoration auth-decoration-two" aria-hidden="true" />
      <header className="auth-header">
        <Brand />
        <span className="auth-mode-pill"><span className="demo-pulse" />Secure account access</span>
      </header>
      <div className="auth-content">
        <section className="card auth-card">
          <div className="auth-card-heading">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
          {footer && <div className="auth-card-footer">{footer}</div>}
        </section>
        <aside className="auth-security-note">
          <span className="auth-security-icon"><ShieldCheck size={18} /></span>
          <div>
            <strong>Your account password is for OnePay only.</strong>
            <p>Never enter or share a banking PIN, banking password, OTP, or card security code here. Payments in OnePay remain simulated.</p>
          </div>
        </aside>
      </div>
      <footer className="auth-footer">OnePay · Account authentication is separate from simulated payment activity.</footer>
    </main>
  );
}
