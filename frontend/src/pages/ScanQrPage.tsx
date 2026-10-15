import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { ArrowRight, Camera, CameraOff, Check, Copy, Download, QrCode, ScanLine, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useDemo } from '../context/DemoProvider';
import { useToast } from '../context/ToastProvider';
import { isValidUpiId } from '../types';
import { Button } from '../components/Controls';
import { PageHeader } from '../components/PageHeader';

interface ParsedCode { upiId: string; name?: string }

function parsePaymentCode(rawValue: string): ParsedCode | null {
  const raw = rawValue.trim();
  if (isValidUpiId(raw)) return { upiId: raw };
  try {
    const url = new URL(raw);
    if (url.protocol === 'upi:' || url.protocol === 'onepay:') {
      const upiId = url.searchParams.get('pa') ?? url.searchParams.get('upi') ?? url.searchParams.get('vpa') ?? '';
      if (isValidUpiId(upiId)) return { upiId, name: url.searchParams.get('pn') ?? url.searchParams.get('name') ?? undefined };
    }
  } catch {
    return null;
  }
  return null;
}

const demoPayload = 'onepay://pay?upi=arjun%40okicici&name=Arjun%20Rao';

export default function ScanQrPage() {
  const { profile } = useDemo();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [tab, setTab] = useState<'scan' | 'my-qr'>('scan');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [rawCode, setRawCode] = useState('');
  const [parsedCode, setParsedCode] = useState<ParsedCode | null>(null);

  useEffect(() => () => {
    controlsRef.current?.stop();
  }, []);

  const processCode = (value: string) => {
    setRawCode(value);
    const parsed = parsePaymentCode(value);
    setParsedCode(parsed);
    if (!parsed) setCameraError('That QR code is not a supported payment request. Try a OnePay demo QR or a valid UPI ID QR.');
    else setCameraError('');
  };

  const startCamera = async () => {
    setCameraError('');
    setParsedCode(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser. You can still try the demo QR below.');
      return;
    }
    if (!videoRef.current) return;
    try {
      const reader = new BrowserQRCodeReader();
      readerRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _error, activeControls) => {
        if (!result) return;
        activeControls.stop();
        controlsRef.current = null;
        setScanning(false);
        processCode(result.getText());
      });
      controlsRef.current = controls;
      setScanning(true);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      setCameraError(errorName === 'NotAllowedError'
        ? 'Camera permission was declined. Allow camera access or try the demo QR.'
        : 'Could not start the camera. Check browser permissions or try the demo QR.');
      setScanning(false);
    }
  };

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const tryDemoQr = () => {
    stopCamera();
    setCameraError('');
    processCode(demoPayload);
  };

  const continueToPayment = () => {
    if (!parsedCode) return;
    navigate(`/send?upi=${encodeURIComponent(parsedCode.upiId)}`);
  };

  const downloadQr = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) {
      showToast('Could not prepare the demo QR image.', 'error');
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
    showToast('Demo QR downloaded.', 'success');
  };

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(profile.upiId);
      showToast('Demo UPI ID copied.', 'success');
    } catch {
      showToast(`Demo UPI ID: ${profile.upiId}`, 'info');
    }
  };

  return (
    <>
      <PageHeader eyebrow="SCAN & PAY · SIMULATED" title="Scan QR" description="Scan a compatible payment QR or show your own demo QR. Nothing connects to a payment network." />

      <div className="scan-tabs" role="tablist" aria-label="QR code options">
        <button type="button" role="tab" aria-selected={tab === 'scan'} className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}><ScanLine size={17} />Scan a QR</button>
        <button type="button" role="tab" aria-selected={tab === 'my-qr'} className={tab === 'my-qr' ? 'active' : ''} onClick={() => { stopCamera(); setTab('my-qr'); }}><QrCode size={17} />My demo QR</button>
      </div>

      {tab === 'scan' ? (
        <div className="scan-layout">
          <section className="card scanner-card">
            <div className="scanner-card-heading"><span className="scanner-heading-icon"><ScanLine size={19} /></span><div><h2>Point your camera at a QR</h2><p>We’ll only read the QR contents. No payment is initiated.</p></div></div>
            <div className={`camera-stage ${scanning ? 'camera-stage-live' : ''}`}>
              <video ref={videoRef} className="camera-video" muted playsInline aria-label="QR scanner camera preview" />
              {!scanning && <div className="camera-placeholder"><span className="camera-placeholder-icon"><Camera size={25} /></span><strong>Camera scanner</strong><span>Allow camera access to scan a QR code.</span></div>}
              {scanning && <div className="scanner-frame" aria-hidden="true"><span /><span /><span /><span /></div>}
            </div>
            {cameraError && <div className="inline-error" role="alert">{cameraError}</div>}
            <div className="scanner-controls">
              {scanning
                ? <Button variant="secondary" onClick={stopCamera} icon={<CameraOff size={17} />}>Stop camera</Button>
                : <Button onClick={startCamera} icon={<Camera size={17} />}>Start camera</Button>}
              <Button variant="ghost" onClick={tryDemoQr} icon={<QrCode size={17} />}>Try a demo QR</Button>
            </div>
            {parsedCode && <div className="scanned-result" role="status">
              <span className="scanned-result-check"><Check size={18} /></span>
              <div><span>QR details read</span><strong>{parsedCode.name ?? 'Payment recipient'}</strong><small>{parsedCode.upiId}</small></div>
              <Button size="sm" onClick={continueToPayment} icon={<ArrowRight size={15} />}>Continue</Button>
            </div>}
            {rawCode && !parsedCode && <div className="scanner-invalid-note"><span>Scanned content wasn’t a supported payment QR.</span><button type="button" onClick={() => { setRawCode(''); setCameraError(''); }}>Dismiss</button></div>}
          </section>

          <aside className="scan-side-column">
            <section className="card scan-tips-card"><span className="scan-tip-icon"><ShieldCheck size={20} /></span><span className="eyebrow">A SAFE DEMO</span><h2>Scan with confidence.</h2><p>Only the QR text is read. Check recipient details before continuing to a clearly labeled demo payment.</p><div className="scan-tip-check"><Check size={16} /><span>No real UPI transfer</span></div><div className="scan-tip-check"><Check size={16} /><span>No PIN or OTP required</span></div></section>
            <section className="card scan-own-qr-card"><div className="scan-mini-qr"><QRCodeSVG value={`onepay://pay?upi=${encodeURIComponent(profile.upiId)}&name=${encodeURIComponent(profile.name)}`} size={56} level="M" /></div><div><strong>Need your own QR?</strong><p>Open your personal demo QR.</p><button type="button" className="text-link" onClick={() => setTab('my-qr')}>Show my QR <ArrowRight size={15} /></button></div></section>
          </aside>
        </div>
      ) : (
        <div className="my-qr-layout">
          <section className="card my-qr-card">
            <span className="eyebrow">YOUR PERSONAL QR</span>
            <h2>Let someone scan your demo QR.</h2>
            <p>This code contains a demo UPI ID only. It can’t accept real payments.</p>
            <div className="qr-code-frame" ref={qrRef}>
              <QRCodeSVG value={`onepay://pay?upi=${encodeURIComponent(profile.upiId)}&name=${encodeURIComponent(profile.name)}`} size={216} level="H" includeMargin title={`OnePay demo QR for ${profile.name}`} />
            </div>
            <strong className="my-qr-name">{profile.name}</strong>
            <div className="my-qr-upi"><span>{profile.upiId}</span><button type="button" className="icon-button tiny-icon-button" onClick={copyUpi} aria-label="Copy demo UPI ID"><Copy size={16} /></button></div>
            <div className="my-qr-actions"><Button onClick={downloadQr} icon={<Download size={16} />}>Download demo QR</Button><Button variant="secondary" onClick={() => setTab('scan')} icon={<ScanLine size={16} />}>Scan a QR</Button></div>
            <div className="qr-demo-disclaimer"><ShieldCheck size={17} /><span>Demo QR · no real payments can be received with this code.</span></div>
          </section>
          <aside className="card qr-info-card"><span className="qr-info-icon"><QrCode size={21} /></span><h2>Made for practice.</h2><p>This is an original OnePay QR format containing your demo UPI ID and display name. It is not a payment address verified by a bank.</p><button type="button" className="text-link" onClick={() => navigate('/profile')}>Review profile details <ArrowRight size={15} /></button></aside>
        </div>
      )}
    </>
  );
}
