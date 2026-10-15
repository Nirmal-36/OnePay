import { useState, type FormEvent } from 'react';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiErrorMessage, apiFieldError, authApi } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { Button, TextInput } from '../components/Controls';

export default function PasswordResetPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setFieldError(undefined);
    setMessage('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await authApi.requestPasswordReset({ email: email.trim() });
      setMessage(response.message);
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'We could not submit that request. Please try again.'));
      setFieldError(apiFieldError(requestError, 'email'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="ACCOUNT RECOVERY"
      title="Reset your password"
      description="Enter your OnePay account email. If an account exists, the account service will send reset instructions."
      footer={<>Remembered it? <Link to="/login">Return to sign in</Link></>}
    >
      {message ? (
        <div className="auth-success-panel" role="status">
          <span><MailCheck size={22} /></span>
          <strong>Check your inbox</strong>
          <p>{message}</p>
          <p>If your address matches an active account, you’ll receive a one-time link. For local development, reset emails appear in the backend terminal.</p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error && <div className="auth-form-error" role="alert">{error}</div>}
          <TextInput
            label="Email address"
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => { setEmail(event.target.value); setFieldError(undefined); }}
            error={fieldError}
            required
          />
          <Button type="submit" className="button-full" size="lg" busy={submitting} icon={<MailCheck size={17} />}>
            {submitting ? 'Sending request…' : 'Send reset instructions'}
          </Button>
          <Link to="/login" className="auth-back-link"><ArrowLeft size={15} /> Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}
