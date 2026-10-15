import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, LockKeyhole } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiErrorMessage, apiFieldError } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { Button, TextInput } from '../components/Controls';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = {
      email: email.trim() ? undefined : 'Enter your OnePay account email.',
      password: password ? undefined : 'Enter your OnePay account password.',
    };
    setFieldErrors(errors);
    setFormError('');
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
      const destination = from?.pathname ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : '/';
      navigate(destination, { replace: true });
    } catch (error) {
      setFormError(apiErrorMessage(error, 'Sign in could not be completed. Please try again.'));
      setFieldErrors({
        email: apiFieldError(error, 'email'),
        password: apiFieldError(error, 'password'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="WELCOME BACK"
      title="Sign in to OnePay"
      description="Use your OnePay account details to continue to your simulated payment workspace."
      footer={<>New to OnePay? <Link to="/register">Create an account</Link></>}
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {formError && <div className="auth-form-error" role="alert"><LockKeyhole size={17} /><span>{formError}</span></div>}
        <TextInput
          label="Email address"
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
          error={fieldErrors.email}
          required
        />
        <TextInput
          label="OnePay account password"
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); }}
          error={fieldErrors.password}
          required
        />
        <div className="auth-form-link-row"><span><KeyRound size={14} /> OnePay password only</span><Link to="/password-reset">Forgot password?</Link></div>
        <Button type="submit" className="button-full" size="lg" busy={submitting} icon={<ArrowRight size={17} />}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="auth-form-note">Your sign-in is checked securely by the OnePay account service. It is not a bank login.</p>
      </form>
    </AuthLayout>
  );
}
