import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-64 h-auto mx-auto mb-6 flex items-center justify-center">
          <img
            src="/assets/shopperlogo.png"
            alt="Bakery Production Management logo"
            className="w-full h-auto object-contain"
          />
        </div>
        <h1 className="font-display text-4xl font-bold text-blue-950 mb-2">404</h1>
        <p className="text-slate-500 mb-6 font-body">Page not found</p>
        <Link to="/" className="btn-primary">
          <Home size={16} />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

