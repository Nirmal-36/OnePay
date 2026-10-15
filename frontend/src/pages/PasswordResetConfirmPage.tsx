import { useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiErrorMessage, apiFieldError, authApi } from '../api/auth';
import { AuthLayout } from '../components/AuthLayout';
import { Button, TextInput } from '../components/Controls';

export default function PasswordResetConfirmPage() {
  const [searchParams] = useSearchParams();
  const uid = searchParams.get('uid') ?? '';
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string | undefined> = {};
    if (!password) errors.new_password = 'Choose a new OnePay account password.';
    if (password !== confirmPassword) errors.confirm_password = 'The passwords do not match.';
    setFieldErrors(errors);
    setFormError('');
    if (!uid || !token) {
      setFormError('This password-reset link is incomplete. Request a new link to continue.');
      return;
    }
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      const response = await authApi.confirmPasswordReset({
        uid,
        token,
        new_password: password,
        confirm_password: confirmPassword,
      });
      setSuccessMessage(response.message);
    } catch (error) {
      setFormError(apiErrorMessage(error, 'Your password could not be reset. Request a new link and try again.'));
      setFieldErrors({
        new_password: apiFieldError(error, 'new_password'),
        confirm_password: apiFieldError(error, 'confirm_password'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="SECURE ACCOUNT RECOVERY"
      title="Choose a new password"
      description="Set a new password for your OnePay account. This does not change any bank or payment credentials."
      footer={<>Need a fresh link? <Link to="/password-reset">Request another reset</Link></>}
    >
      {successMessage ? (
        <div className="auth-success-panel" role="status">
          <span><LockKeyhole size={22} /></span>
          <strong>Password updated</strong>
          <p>{successMessage}</p>
          <Link to="/login" className="button button-primary button-lg auth-success-link">Continue to sign in <ArrowRight size={16} /></Link>
        </div>
      ) : !uid || !token ? (
        <div className="auth-form-error" role="alert">This password-reset link is missing its one-time token. Request a new link to continue.</div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {formError && <div className="auth-form-error" role="alert">{formError}</div>}
          <TextInput
            label="New OnePay account password"
            id="reset-new-password"
            name="new_password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.new_password}
            hint="Use at least 12 characters and avoid a common password."
            required
          />
          <TextInput
            label="Confirm new password"
            id="reset-confirm-password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={fieldErrors.confirm_password}
            required
          />
          <Button type="submit" className="button-full" size="lg" busy={submitting} icon={<LockKeyhole size={17} />}>
            {submitting ? 'Updating password…' : 'Update password'}
          </Button>
          <p className="auth-form-note">Use a password for OnePay only. Do not enter a banking PIN, banking password, OTP, or card security code.</p>
        </form>
      )}
    </AuthLayout>
  );
}
