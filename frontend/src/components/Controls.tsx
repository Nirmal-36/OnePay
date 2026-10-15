import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'balance-light';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', busy = false, icon, children, className = '', disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={`button button-${variant} button-${size} ${className}`} disabled={disabled || busy} {...props}>
      {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function TextInput({ label, hint, error, id, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const fieldId = id ?? props.name;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined} {...props} />
      {error ? <span className="field-error" id={`${fieldId}-error`}>{error}</span> : hint ? <span className="field-hint" id={`${fieldId}-hint`}>{hint}</span> : null}
    </div>
  );
}

export function SelectInput({ label, children, error, id, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const fieldId = id ?? props.name;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={fieldId}>{label}</label>
      <select id={fieldId} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined} {...props}>{children}</select>
      {error && <span className="field-error" id={`${fieldId}-error`}>{error}</span>}
    </div>
  );
}
