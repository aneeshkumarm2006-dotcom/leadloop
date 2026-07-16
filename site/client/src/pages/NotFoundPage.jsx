import { useNavigate } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';
import Button from '../components/ui/Button';
import useAuthStore from '../store/authStore';

/**
 * NotFoundPage — rendered for any unmatched route.
 * See Stage 20.9.
 */
const NotFoundPage = () => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const handleHome = () => {
    navigate(isAuthenticated ? '/dashboard' : '/login', { replace: true });
  };

  const handleBack = () => {
    // If there's history, go back; otherwise home.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      handleHome();
    }
  };

  return (
    <main
      role="main"
      className="min-h-screen w-full flex items-center justify-center bg-base px-4 py-10"
    >
      <div
        className="w-full max-w-md text-center bg-surface"
        style={{
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-card)',
          padding: '40px 32px',
        }}
      >
        <div
          className="inline-flex items-center justify-center mx-auto"
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent-light)',
          }}
          aria-hidden="true"
        >
          <Compass size={28} color="var(--color-accent)" strokeWidth={2} />
        </div>

        <h1
          className="font-display font-bold mt-5 text-[color:var(--color-text-primary)]"
          style={{ fontSize: 32, lineHeight: 1.2 }}
        >
          404
        </h1>
        <p
          className="font-display font-semibold mt-1 text-[color:var(--color-text-primary)]"
          style={{ fontSize: 18 }}
        >
          Page not found
        </p>
        <p
          className="font-body mt-2 text-[color:var(--color-text-secondary)]"
          style={{ fontSize: 14, lineHeight: 1.5 }}
        >
          The page you're looking for doesn't exist or has been moved.
        </p>

        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            icon={ArrowLeft}
            iconPosition="left"
            onClick={handleBack}
          >
            Go back
          </Button>
          <Button variant="primary" onClick={handleHome}>
            {isAuthenticated ? 'Back to dashboard' : 'Back to login'}
          </Button>
        </div>
      </div>
    </main>
  );
};

export default NotFoundPage;
