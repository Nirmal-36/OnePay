import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ContactRound, Pencil, Plus, ShieldCheck, Trash2, UserRoundPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiErrorMessage, apiFieldError } from '../api/auth';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import type { DemoRecipient } from '../types';
import { isValidUpiId } from '../types';
import { Avatar } from '../components/Avatar';
import { Button, TextInput } from '../components/Controls';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';

interface RecipientForm { name: string; upiId: string }

export default function RecipientsPage() {
  const { recipients, addRecipient, updateRecipient, removeRecipient, paymentDataLoading } = useDemo();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DemoRecipient | null>(null);
  const [form, setForm] = useState<RecipientForm>({ name: '', upiId: '' });
  const [errors, setErrors] = useState<RecipientForm>({ name: '', upiId: '' });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<DemoRecipient | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  const filteredRecipients = useMemo(() => recipients.filter((recipient) =>
    `${recipient.name} ${recipient.upiId}`.toLowerCase().includes(search.trim().toLowerCase()),
  ), [recipients, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', upiId: '' });
    setErrors({ name: '', upiId: '' });
    setEditorOpen(true);
  };

  const openEdit = (recipient: DemoRecipient) => {
    setEditing(recipient);
    setForm({ name: recipient.name, upiId: recipient.upiId });
    setErrors({ name: '', upiId: '' });
    setEditorOpen(true);
  };

  const submitRecipient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: RecipientForm = { name: '', upiId: '' };
    if (form.name.trim().length < 2) nextErrors.name = 'Enter at least 2 characters.';
    if (!isValidUpiId(form.upiId)) nextErrors.upiId = 'Enter a valid mock UPI ID, such as friend@onepay.';
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.upiId) return;

    setSaving(true);
    try {
      if (editing) await updateRecipient(editing.id, { name: form.name.trim(), upiId: form.upiId.trim().toLowerCase() });
      else await addRecipient({ name: form.name.trim(), upiId: form.upiId.trim().toLowerCase() });
      setEditorOpen(false);
      showToast(editing ? 'Demo recipient updated.' : 'Demo recipient added.', 'success');
    } catch (error) {
      const upiError = apiFieldError(error, 'upi_id');
      const nameError = apiFieldError(error, 'display_name');
      setErrors({ name: nameError ?? '', upiId: upiError ?? '' });
      if (!upiError && !nameError) showToast(apiErrorMessage(error, 'Could not save this recipient.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemovingBusy(true);
    try {
      await removeRecipient(removing.id);
      showToast(`${removing.name} was removed from your demo recipients.`, 'success');
      setRemoving(null);
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not remove this recipient.'), 'error');
    } finally {
      setRemovingBusy(false);
    }
  };

  const updateField = (field: keyof RecipientForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  return (
    <>
      <PageHeader eyebrow="YOUR CONTACTS · DEMO MODE" title="Manage recipients" description="Add, edit, or remove mock UPI recipients saved to your OnePay account." action={<Button icon={<UserRoundPlus size={17} />} onClick={openCreate}>Add recipient</Button>} />

      <div className="recipient-page-note"><ShieldCheck size={18} /><span>OnePay resolves only built-in mock handles and @onepay / @mock demo IDs. No real UPI directory is queried.</span></div>
      <section className="card recipient-manager-card">
        <div className="recipient-manager-toolbar">
          <div><h2>Saved demo recipients</h2><p>{recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'} · private to your account</p></div>
          <label className="recipient-search"><span className="visually-hidden">Search recipients</span><input type="search" placeholder="Search name or UPI ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        {paymentDataLoading && recipients.length === 0 ? <div className="recipient-empty"><ContactRound size={24} /><p>Loading your saved demo recipients…</p></div>
          : filteredRecipients.length ? <div className="recipient-list">
            {filteredRecipients.map((recipient) => <article className="recipient-manager-row" key={recipient.id}>
              <span className={`recipient-manager-avatar person-${recipient.color}`}><Avatar name={recipient.name} size="md" /></span>
              <div className="recipient-manager-copy"><strong>{recipient.name}</strong><span>{recipient.upiId}</span>{recipient.isDefault && <small>OnePay sample contact</small>}</div>
              <div className="recipient-manager-actions"><button type="button" className="icon-button" aria-label={`Edit ${recipient.name}`} onClick={() => openEdit(recipient)}><Pencil size={17} /></button><button type="button" className="icon-button danger-icon-button" aria-label={`Remove ${recipient.name}`} onClick={() => setRemoving(recipient)}><Trash2 size={17} /></button></div>
            </article>)}
          </div>
          : <div className="recipient-empty"><ContactRound size={25} /><strong>{search ? 'No matching recipients' : 'No saved recipients yet'}</strong><p>{search ? 'Try another name or UPI ID.' : 'Add a mock recipient to make future demo payments quicker.'}</p>{!search && <Button size="sm" icon={<Plus size={16} />} onClick={openCreate}>Add recipient</Button>}</div>}
      </section>
      <div className="recipient-page-footer"><Link to="/send"><ArrowLeft size={15} />Back to send money</Link><span>No PIN, OTP, or banking credentials are collected.</span></div>

      <Modal open={editorOpen} title={editing ? 'Edit demo recipient' : 'Add a demo recipient'} subtitle="Only supported mock handles can be saved." onClose={() => { if (!saving) setEditorOpen(false); }} size="sm"
        footer={<><Button variant="secondary" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" form="recipient-form" busy={saving} icon={<Check size={16} />}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add recipient'}</Button></>}>
        <form id="recipient-form" className="recipient-form" onSubmit={(event) => void submitRecipient(event)} noValidate>
          <TextInput label="Display name" id="recipient-name" name="name" value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="e.g. Riya Shah" maxLength={80} autoComplete="off" error={errors.name || undefined} />
          <TextInput label="Mock UPI ID" id="recipient-upi" name="upiId" value={form.upiId} onChange={(event) => updateField('upiId', event.target.value)} placeholder="name@onepay" maxLength={64} autoComplete="off" hint="Try @onepay, @mock, or a built-in OnePay sample handle." error={errors.upiId || undefined} />
          <div className="demo-inline-notice"><ShieldCheck size={17} /><p>Recipient data belongs to your account. These mock IDs cannot route real money.</p></div>
        </form>
      </Modal>

      <Modal open={Boolean(removing)} title="Remove demo recipient?" subtitle="This only removes the saved contact from your OnePay list." onClose={() => { if (!removingBusy) setRemoving(null); }} size="sm"
        footer={<><Button variant="secondary" onClick={() => setRemoving(null)} disabled={removingBusy}>Keep recipient</Button><Button variant="danger" onClick={() => void confirmRemove()} busy={removingBusy} icon={<Trash2 size={16} />}>Remove</Button></>}>
        <div className="remove-recipient-summary"><span className="recipient-manager-avatar"><Avatar name={removing?.name ?? ''} size="md" /></span><div><strong>{removing?.name}</strong><span>{removing?.upiId}</span></div></div>
      </Modal>
    </>
  );
}
