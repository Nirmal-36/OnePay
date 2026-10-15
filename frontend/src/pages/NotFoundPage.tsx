import { ArrowLeft, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Controls';

export default function NotFoundPage() {
  return (
    <section className="card not-found-card">
      <span className="not-found-icon"><SearchX size={25} /></span>
      <span className="eyebrow">404 · PAGE NOT FOUND</span>
      <h1>This page took a wrong turn.</h1>
      <p>The page you’re looking for isn’t part of this demo workspace.</p>
      <Link to="/"><Button icon={<ArrowLeft size={16} />}>Back to home</Button></Link>
    </section>
  );
}
