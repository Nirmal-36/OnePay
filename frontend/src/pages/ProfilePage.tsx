import { useState, type FormEvent } from 'react';
import { ArrowRight, BellRing, Check, CircleHelp, LockKeyhole, Save, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DemoProfile } from '../types';
import { isValidUpiId } from '../types';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { Avatar } from '../components/Avatar';
import { Button, TextInput } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

export default function ProfilePage() {
  const { profile, updateProfile, preferences, updatePreferences } = useDemo();
  const { showToast } = useToast();
  const [form, setForm] = useState<DemoProfile>(profile);
  const [errors, setErrors] = useState<Partial<Record<keyof DemoProfile, string>>>({});
  const [saved, setSaved] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (form.name.trim().length < 2 || form.name.trim().length > 60) nextErrors.name = 'Enter a name between 2 and 60 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (!isValidUpiId(form.upiId)) nextErrors.upiId = 'Enter a UPI ID in the format name@bank. This checks format only.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setSaved(false);
      return;
    }
    const nextProfile = { name: form.name.trim(), email: form.email.trim(), upiId: form.upiId.trim() };
    updateProfile(nextProfile);
    setForm(nextProfile);
    setSaved(true);
    showToast('Demo profile updated for this session.', 'success');
  };

  const updateField = (field: keyof DemoProfile, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaved(false);
  };

  return (
    <>
      <PageHeader eyebrow="ACCOUNT" title="Profile & settings" description="Manage the sample details shown in your OnePay demo." />
      <div className="profile-layout">
        <section className="card profile-card">
          <div className="profile-card-top"><div className="profile-person"><Avatar name={profile.name} size="lg" /><div><span className="eyebrow">DEMO PROFILE</span><h2>{profile.name}</h2><p>{profile.email}</p></div></div><span className="profile-demo-pill"><span className="demo-pulse" />Demo</span></div>
          <div className="profile-divider" />
          <form className="profile-form" onSubmit={onSubmit} noValidate>
            <div className="profile-form-heading"><span className="form-heading-icon"><UserRound size={18} /></span><div><h3>Personal details</h3><p>These details are stored in memory for this session only.</p></div></div>
            <TextInput label="Display name" id="profile-name" name="name" type="text" autoComplete="name" maxLength={60} value={form.name} onChange={(event) => updateField('name', event.target.value)} error={errors.name} />
            <TextInput label="Email address" id="profile-email" name="email" type="email" autoComplete="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} error={errors.email} hint="Use a sample email address only." />
            <TextInput label="Demo UPI ID" id="profile-upi" name="upiId" type="text" autoComplete="off" value={form.upiId} onChange={(event) => updateField('upiId', event.target.value)} error={errors.upiId} hint="Format check only. This ID is not verified or connected to a bank." />
            <div className="profile-secret-callout"><LockKeyhole size={17} /><span>Never enter a real banking PIN, password, OTP, or card security code in this demo.</span></div>
            <div className="profile-form-actions"><span>{saved ? <span className="saved-inline"><Check size={15} />Saved for this session</span> : 'Your changes are not saved to an account or server.'}</span><Button type="submit" icon={<Save size={16} />}>Save changes</Button></div>
          </form>
        </section>

        <aside className="profile-side-column">
          <section className="card settings-card"><div className="section-heading"><div><h2>Preferences</h2><p>Local demo settings</p></div></div>
            <label className="setting-row"><span className="setting-row-icon setting-bell"><BellRing size={17} /></span><span><strong>In-app notifications</strong><small>Show demo alerts in OnePay</small></span><input type="checkbox" checked={preferences.inAppAlerts} onChange={(event) => { updatePreferences({ inAppAlerts: event.target.checked }); showToast(`New demo alerts ${event.target.checked ? 'enabled' : 'muted'}.`, 'info'); }} /></label>
            <label className="setting-row"><span className="setting-row-icon setting-mask"><ShieldCheck size={17} /></span><span><strong>Mask balances</strong><small>Hide demo funds on the dashboard</small></span><input type="checkbox" checked={preferences.maskBalance} onChange={(event) => { updatePreferences({ maskBalance: event.target.checked }); showToast(`Balance masking ${event.target.checked ? 'enabled' : 'disabled'}.`, 'info'); }} /></label>
            <p className="settings-note">Preferences apply across this demo session and reset when you reload.</p>
          </section>
          <section className="card account-links-card"><h2>Need something else?</h2><Link to="/notifications" className="account-link-row"><span className="shortcut-icon shortcut-yellow"><BellRing size={17} /></span><span><strong>Notifications</strong><small>Your updates and demo alerts</small></span><ArrowRight size={16} /></Link><Link to="/help" className="account-link-row"><span className="shortcut-icon shortcut-blue"><CircleHelp size={17} /></span><span><strong>Help & support</strong><small>FAQs and a sample request form</small></span><ArrowRight size={16} /></Link></section>
          <div className="profile-security-note"><ShieldCheck size={18} /><div><strong>No real account connection</strong><span>There is no bank, identity, or payment provider linked to OnePay.</span></div></div>
        </aside>
      </div>
    </>
  );
}
