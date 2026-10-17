import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { ArrowRight, Camera, CameraOff, Check, Copy, Download, QrCode, ScanLine, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError, apiErrorMessage } from '../api/auth';
import { paymentApi, type ApiRecipientLookup, type DemoQrResolution, type GeneratedDemoQr } from '../api/payments';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { Button } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

interface VerifiedRecipient {
  recipientId: number | null;
  displayName: string;
  upiId: string;
  qrContent?: string;
}

function fromQrResolution(resolution: DemoQrResolution, qrContent: string): VerifiedRecipient {
  return {
    recipientId: resolution.recipient_id,
    displayName: resolution.display_name,
    upiId: resolution.upi_id,
    qrContent,
  };
}

function fromLookup(recipient: ApiRecipientLookup): VerifiedRecipient {
  return {
    recipientId: recipient.id,
    displayName: recipient.display_name,
    upiId: recipient.upi_id,
  };
}

function cameraWasDenied(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
}

export default function ScanQrPage() {
  const { profile } = useDemo();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [tab, setTab] = useState<'scan' | 'my-qr'>('scan');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [rawCode, setRawCode] = useState('');
  const [resolvingQr, setResolvingQr] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<VerifiedRecipient | null>(null);
  const [manualIdentifier, setManualIdentifier] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [personalQr, setPersonalQr] = useState<GeneratedDemoQr | null>(null);
  const [personalQrError, setPersonalQrError] = useState('');
  const [personalQrLoading, setPersonalQrLoading] = useState(true);

  useEffect(() => () => {
    controlsRef.current?.stop();
  }, []);

  useEffect(() => {
    let active = true;
    setPersonalQrLoading(true);
    setPersonalQrError('');
    paymentApi.generateDemoQr()
      .then((generated) => {
        if (active) setPersonalQr(generated);
      })
      .catch((error: unknown) => {
        if (active) {
          setPersonalQr(null);
          setPersonalQrError(apiErrorMessage(error, 'Could not generate your signed OnePay demo QR.'));
        }
      })
      .finally(() => {
        if (active) setPersonalQrLoading(false);
      });
    return () => { active = false; };
  }, []);

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const processCode = async (value: string) => {
    setRawCode(value);
    setResolvedRecipient(null);
    setCameraError('');
    setResolvingQr(true);
    try {
      const resolution = await paymentApi.resolveDemoQr(value);
      if (!resolution.verified || resolution.mode !== 'demo' || resolution.currency !== 'INR') {
        throw new ApiError('OnePay could not verify this demo payment QR.');
      }
      setResolvedRecipient(fromQrResolution(resolution, value));
    } catch (error) {
      setCameraError(apiErrorMessage(error, 'This QR is not a valid, supported OnePay demo payment code.'));
    } finally {
      setResolvingQr(false);
    }
  };

  const startCamera = async () => {
    setCameraError('');
    setRawCode('');
    setResolvedRecipient(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser. Enter a recipient identifier below instead.');
      return;
    }
    if (!videoRef.current) return;
    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _error, activeControls) => {
        if (!result) return;
        activeControls.stop();
        controlsRef.current = null;
        setScanning(false);
        void processCode(result.getText());
      });
      controlsRef.current = controls;
      setScanning(true);
    } catch (error) {
      setCameraError(cameraWasDenied(error)
        ? 'Camera permission was declined. Allow access or enter a recipient identifier manually.'
        : 'Could not start the camera. Check browser permissions or enter a recipient identifier manually.');
      setScanning(false);
    }
  };

  const tryDemoQr = async () => {
    stopCamera();
    setCameraError('');
    setRawCode('');
    setResolvedRecipient(null);
    try {
      const generated = personalQr ?? await paymentApi.generateDemoQr();
      if (!personalQr) setPersonalQr(generated);
      await processCode(generated.qr_content);
    } catch (error) {
      setCameraError(apiErrorMessage(error, 'Could not verify a OnePay demo QR.'));
    }
  };

  const verifyManualIdentifier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const identifier = manualIdentifier.trim();
    if (!identifier) {
      setManualError('Enter a OnePay demo ID or a saved recipient ID.');
      return;
    }
    stopCamera();
    setManualLoading(true);
    setManualError('');
    setCameraError('');
    setRawCode('');
    setResolvedRecipient(null);
    try {
      const recipient = await paymentApi.lookupRecipient(identifier);
      setResolvedRecipient(fromLookup(recipient));
    } catch (error) {
      setManualError(apiErrorMessage(error, 'No verified OnePay demo recipient matches that identifier.'));
    } finally {
      setManualLoading(false);
    }
  };

  const cancelRecipient = () => {
    setResolvedRecipient(null);
    setRawCode('');
    setCameraError('');
    setManualError('');
  };

  const continueToPayment = () => {
    if (!resolvedRecipient) return;
    const nameParts = resolvedRecipient.displayName.trim().split(/\s+/).filter(Boolean);
    navigate('/send', {
      state: {
        recipient: {
          id: resolvedRecipient.recipientId === null ? resolvedRecipient.upiId : String(resolvedRecipient.recipientId),
          name: resolvedRecipient.displayName,
          upiId: resolvedRecipient.upiId,
          initials: nameParts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
          color: 'lavender',
        },
        ...(resolvedRecipient.qrContent ? { qrContent: resolvedRecipient.qrContent } : {}),
      },
    });
  };

  const downloadQr = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) {
      showToast('Could not prepare the signed demo QR image.', 'error');
      return;
    }
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'onepay-demo-qr.svg';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Signed OnePay demo QR downloaded.', 'success');
  };

  const copyUpi = async () => {
    if (!personalQr) {
      showToast(personalQrError || 'Your OnePay demo QR is not ready yet.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(personalQr.upi_id);
      showToast('Verified OnePay demo ID copied.', 'success');
    } catch {
      showToast(`OnePay demo ID: ${personalQr.upi_id}`, 'info');
    }
  };

  return (
    <>
      <PageHeader eyebrow="SCAN & PAY · SIMULATED" title="Scan QR" description="Scan a signed OnePay demo QR or show your own verified account QR. Nothing connects to a payment network." />

      <div className="scan-tabs" role="tablist" aria-label="QR code options">
        <button type="button" role="tab" aria-selected={tab === 'scan'} className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}><ScanLine size={17} />Scan a QR</button>
        <button type="button" role="tab" aria-selected={tab === 'my-qr'} className={tab === 'my-qr' ? 'active' : ''} onClick={() => { stopCamera(); setTab('my-qr'); }}><QrCode size={17} />My demo QR</button>
      </div>

      {tab === 'scan' ? (
        <div className="scan-layout">
          <section className="card scanner-card">
            <div className="scanner-card-heading"><span className="scanner-heading-icon"><ScanLine size={19} /></span><div><h2>Point your camera at a QR</h2><p>OnePay verifies the code first. Scanning never initiates a payment.</p></div></div>
            <div className={`camera-stage ${scanning ? 'camera-stage-live' : ''}`}>
              <video ref={videoRef} className="camera-video" muted playsInline aria-label="QR scanner camera preview" />
              {!scanning && <div className="camera-placeholder"><span className="camera-placeholder-icon"><Camera size={25} /></span><strong>Camera scanner</strong><span>Allow camera access to scan a signed OnePay demo QR.</span></div>}
              {scanning && <div className="scanner-frame" aria-hidden="true"><span /><span /><span /><span /></div>}
            </div>
            {cameraError && <div className="inline-error" role="alert">{cameraError}</div>}
            {resolvingQr && <div className="qr-resolving" role="status">Verifying QR with OnePay…</div>}
            <div className="scanner-controls">
              {scanning
                ? <Button variant="secondary" onClick={stopCamera} icon={<CameraOff size={17} />}>Stop camera</Button>
                : <Button onClick={() => void startCamera()} icon={<Camera size={17} />}>Start camera</Button>}
              <Button variant="ghost" onClick={() => void tryDemoQr()} icon={<QrCode size={17} />}>Try a verified demo QR</Button>
            </div>
            {resolvedRecipient && <div className="scanned-result" role="status">
              <span className="scanned-result-check"><Check size={18} /></span>
              <div><span>Verified OnePay demo profile · no payment sent</span><strong>{resolvedRecipient.displayName}</strong><small>{resolvedRecipient.upiId}</small></div>
              <div className="scanned-result-actions">
                <Button size="sm" variant="secondary" onClick={cancelRecipient}>Cancel</Button>
                <Button size="sm" onClick={continueToPayment} icon={<ArrowRight size={15} />}>Continue</Button>
              </div>
            </div>}
            {rawCode && !resolvedRecipient && !resolvingQr && cameraError && <div className="scanner-invalid-note"><span>OnePay rejected this QR. It was not used to start a payment.</span><button type="button" onClick={cancelRecipient}>Dismiss</button></div>}

            <div className="qr-manual-divider"><span>or enter it manually</span></div>
            <form className="qr-manual-form" onSubmit={(event) => void verifyManualIdentifier(event)} noValidate>
              <div className="field">
                <label htmlFor="manual-recipient-identifier">Recipient identifier</label>
                <input id="manual-recipient-identifier" name="recipientIdentifier" type="text" value={manualIdentifier} onChange={(event) => { setManualIdentifier(event.target.value); setManualError(''); }} autoComplete="off" placeholder="user2@onepay or saved recipient ID" aria-invalid={Boolean(manualError)} aria-describedby={manualError ? 'manual-recipient-error' : 'manual-recipient-hint'} />
                {manualError ? <span className="field-error" id="manual-recipient-error" role="alert">{manualError}</span> : <span className="field-hint" id="manual-recipient-hint">Manual entry stays available if your camera is denied or unsupported.</span>}
              </div>
              <Button type="submit" variant="secondary" busy={manualLoading} icon={<ShieldCheck size={16} />}>{manualLoading ? 'Verifying…' : 'Verify recipient'}</Button>
            </form>
          </section>

          <aside className="scan-side-column">
            <section className="card scan-tips-card"><span className="scan-tip-icon"><ShieldCheck size={20} /></span><span className="eyebrow">A SAFE DEMO</span><h2>Scan with confidence.</h2><p>Only OnePay-signed INR demo codes are accepted. Review the verified profile and amount before confirming a simulated payment.</p><div className="scan-tip-check"><Check size={16} /><span>No real UPI transfer</span></div><div className="scan-tip-check"><Check size={16} /><span>No PIN or OTP required</span></div></section>
            <section className="card scan-own-qr-card"><div className="scan-mini-qr">{personalQr ? <QRCodeSVG value={personalQr.qr_content} size={56} level="M" /> : <QrCode size={30} aria-hidden="true" />}</div><div><strong>Need your own QR?</strong><p>{personalQrLoading ? 'Preparing your signed QR…' : personalQr ? 'Linked to your verified OnePay profile.' : 'Your signed QR is unavailable.'}</p><button type="button" className="text-link" onClick={() => setTab('my-qr')}>Show my QR <ArrowRight size={15} /></button></div></section>
          </aside>
        </div>
      ) : (
        <div className="my-qr-layout">
          <section className="card my-qr-card">
            <span className="eyebrow">YOUR VERIFIED ONEPAY PROFILE</span>
            <h2>Let someone scan your demo QR.</h2>
            <p>The signed code contains your OnePay account identifier and INR demo-payment details only. It cannot receive a real payment.</p>
            {personalQrError && <div className="inline-error" role="alert">{personalQrError}</div>}
            <div className="qr-code-frame" ref={qrRef}>
              {personalQr ? <QRCodeSVG value={personalQr.qr_content} size={216} level="H" includeMargin title={`Verified OnePay demo QR for ${personalQr.display_name}`} /> : <div className="qr-loading-state" role="status">{personalQrLoading ? 'Generating signed QR…' : 'Signed QR unavailable'}</div>}
            </div>
            <strong className="my-qr-name">{personalQr?.display_name ?? profile.name}</strong>
            <div className="my-qr-upi"><span>{personalQr?.upi_id ?? 'OnePay profile ID unavailable'}</span>{personalQr && <button type="button" className="icon-button tiny-icon-button" onClick={() => void copyUpi()} aria-label="Copy verified OnePay demo ID"><Copy size={16} /></button>}</div>
            <div className="my-qr-actions"><Button onClick={downloadQr} disabled={!personalQr} icon={<Download size={16} />}>Download signed QR</Button><Button variant="secondary" onClick={() => setTab('scan')} icon={<ScanLine size={16} />}>Scan a QR</Button></div>
            <div className="qr-demo-disclaimer"><ShieldCheck size={17} /><span>Demo only · no real payments can be received with this QR.</span></div>
          </section>
          <aside className="card qr-info-card"><span className="qr-info-icon"><QrCode size={21} /></span><h2>Verified by OnePay.</h2><p>The profile name and account identifier are resolved by OnePay’s backend. Altered, unsupported, or unknown payment codes are rejected before review.</p><button type="button" className="text-link" onClick={() => navigate('/profile')}>Review profile details <ArrowRight size={15} /></button></aside>
        </div>
      )}
    </>
  );
}
