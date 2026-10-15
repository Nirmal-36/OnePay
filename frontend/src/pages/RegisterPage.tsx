import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiErrorMessage, apiFieldError } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { Button, TextInput } from '../components/Controls';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string | undefined> = {};
    if (fullName.trim().length < 2) errors.full_name = 'Enter a name with at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Choose a OnePay account password.';
    if (password !== passwordConfirm) errors.password_confirm = 'The passwords do not match.';
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      await signUp({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        password_confirm: passwordConfirm,
      });
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(apiErrorMessage(error, 'Your account could not be created. Please try again.'));
      setFieldErrors({
        full_name: apiFieldError(error, 'full_name'),
        email: apiFieldError(error, 'email'),
        password: apiFieldError(error, 'password'),
        password_confirm: apiFieldError(error, 'password_confirm'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="CREATE YOUR ACCOUNT"
      title="A OnePay account, just for this demo"
      description="Create a sign-in for your simulated wallet workspace. No bank or payment account is connected."
      footer={<>Already have a OnePay account? <Link to="/login">Sign in</Link></>}
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {formError && <div className="auth-form-error" role="alert"><ShieldCheck size={17} /><span>{formError}</span></div>}
        <TextInput
          label="Full name"
          id="register-name"
          name="full_name"
          type="text"
          autoComplete="name"
          maxLength={120}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          error={fieldErrors.full_name}
          required
        />
        <TextInput
          label="Email address"
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />
        <TextInput
          label="OnePay account password"
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          hint="Use at least 12 characters and avoid a common password."
          required
        />
        <TextInput
          label="Confirm OnePay password"
          id="register-password-confirm"
          name="password_confirm"
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          error={fieldErrors.password_confirm}
          required
        />
        <Button type="submit" className="button-full" size="lg" busy={submitting} icon={<ArrowRight size={17} />}>
          {submitting ? 'Creating your account…' : 'Create account'}
        </Button>
        <p className="auth-form-note">This password is only for your OnePay demo account. Never use a banking password, PIN, OTP, or card security code.</p>
      </form>
    </AuthLayout>
  );
}
