import { useState, type FormEvent } from 'react';
import { ArrowRight, BellRing, Check, CircleHelp, LockKeyhole, LogOut, Save, ShieldCheck, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { apiErrorMessage, apiFieldError } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import type { DemoProfile } from '../types';
import { isValidUpiId } from '../types';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { Avatar } from '../components/Avatar';
import { Button, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

export default function ProfilePage() {
  const { profile, updateProfile: updateDemoProfile, preferences, updatePreferences } = useDemo();
  const { updateAccountProfile, signOut } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<DemoProfile>(profile);
  const [errors, setErrors] = useState<Partial<Record<keyof DemoProfile, string>>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (form.name.trim().length < 2 || form.name.trim().length > 60) nextErrors.name = 'Enter a name between 2 and 60 characters.';
    if (!isValidUpiId(form.upiId)) nextErrors.upiId = 'Enter a UPI ID in the format name@bank. This checks format only.';
    setErrors(nextErrors);
    setSaved(false);
    setSaveError('');
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      const accountUser = await updateAccountProfile({ full_name: form.name.trim() });
      const nextProfile = { name: accountUser.full_name, email: accountUser.email, upiId: form.upiId.trim() };
      updateDemoProfile(nextProfile);
      setForm(nextProfile);
      setSaved(true);
      showToast('Account name saved. Your demo UPI ID stays in this session only.', 'success');
    } catch (error) {
      setSaveError(apiErrorMessage(error, 'Your profile could not be updated. Please try again.'));
      setErrors({
        name: apiFieldError(error, 'full_name'),
        upiId: apiFieldError(error, 'upiId'),
      });
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof DemoProfile, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaved(false);
    setSaveError('');
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not sign out. Please try again.'), 'error');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="ACCOUNT" title="Profile & settings" description="Manage your OnePay sign-in profile and local demo preferences." />
      <div className="profile-layout">
        <section className="card profile-card">
          <div className="profile-card-top"><div className="profile-person"><Avatar name={profile.name} size="lg" /><div><span className="eyebrow">ONEPAY ACCOUNT</span><h2>{profile.name}</h2><p>{profile.email}</p></div></div><span className="profile-demo-pill"><span className="demo-pulse" />Signed in</span></div>
          <div className="profile-divider" />
          <form className="profile-form" onSubmit={onSubmit} noValidate>
            <div className="profile-form-heading"><span className="form-heading-icon"><UserRound size={18} /></span><div><h3>Personal details</h3><p>Your display name is saved to your OnePay account; demo details stay in this session.</p></div></div>
            <TextInput label="Display name" id="profile-name" name="name" type="text" autoComplete="name" maxLength={60} value={form.name} onChange={(event) => updateField('name', event.target.value)} error={errors.name} />
            <TextInput label="Email address" id="profile-email" name="email" type="email" autoComplete="email" value={form.email} readOnly hint="This is your OnePay sign-in address and cannot be changed here." />
            <TextInput label="Demo UPI ID" id="profile-upi" name="upiId" type="text" autoComplete="off" value={form.upiId} onChange={(event) => updateField('upiId', event.target.value)} error={errors.upiId} hint="Format check only. This ID is not verified or connected to a bank." />
            <div className="profile-secret-callout"><LockKeyhole size={17} /><span>Never enter a real banking PIN, password, OTP, or card security code in this demo.</span></div>
            <>{saveError && <div className="auth-form-error" role="alert">{saveError}</div>}<div className="profile-form-actions"><span>{saved ? <span className="saved-inline"><Check size={15} />Account name saved · UPI ID kept in session</span> : 'Account name saves to your account; demo UPI ID is session-only.'}</span><Button type="submit" busy={saving} icon={<Save size={16} />}>{saving ? 'Saving…' : 'Save changes'}</Button></div></>
          </form>
        </section>

        <aside className="profile-side-column">
          <section className="card settings-card"><div className="section-heading"><div><h2>Preferences</h2><p>Local demo settings</p></div></div>
            <label className="setting-row"><span className="setting-row-icon setting-bell"><BellRing size={17} /></span><span><strong>In-app notifications</strong><small>Show demo alerts in OnePay</small></span><input type="checkbox" checked={preferences.inAppAlerts} onChange={(event) => { updatePreferences({ inAppAlerts: event.target.checked }); showToast(`New demo alerts ${event.target.checked ? 'enabled' : 'muted'}.`, 'info'); }} /></label>
            <label className="setting-row"><span className="setting-row-icon setting-mask"><ShieldCheck size={17} /></span><span><strong>Mask balances</strong><small>Hide demo funds on the dashboard</small></span><input type="checkbox" checked={preferences.maskBalance} onChange={(event) => { updatePreferences({ maskBalance: event.target.checked }); showToast(`Balance masking ${event.target.checked ? 'enabled' : 'disabled'}.`, 'info'); }} /></label>
            <p className="settings-note">Preferences apply across this demo session and reset when you reload.</p>
          </section>
          <section className="card account-links-card"><h2>Need something else?</h2><Link to="/notifications" className="account-link-row"><span className="shortcut-icon shortcut-yellow"><BellRing size={17} /></span><span><strong>Notifications</strong><small>Your updates and demo alerts</small></span><ArrowRight size={16} /></Link><Link to="/help" className="account-link-row"><span className="shortcut-icon shortcut-blue"><CircleHelp size={17} /></span><span><strong>Help & support</strong><small>FAQs and a sample request form</small></span><ArrowRight size={16} /></Link></section>
          <Button variant="secondary" className="profile-signout" onClick={() => void handleSignOut()} busy={signingOut} icon={<LogOut size={16} />}>{signingOut ? 'Signing out…' : 'Sign out of OnePay'}</Button>
          <div className="profile-security-note"><ShieldCheck size={18} /><div><strong>No real account connection</strong><span>There is no bank, identity, or payment provider linked to OnePay.</span></div></div>
        </aside>
      </div>
    </>
  );
}
