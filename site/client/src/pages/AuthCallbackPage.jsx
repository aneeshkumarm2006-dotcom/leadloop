import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuthStore from '../store/authStore';

const AuthCallbackPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      navigate('/login?error=auth_failed', { replace: true });
      return;
    }

    // Store token, then fetch user to decide where to route next
    login(token);
    fetchCurrentUser().then((user) => {
      if (!user) {
        navigate('/login?error=auth_failed', { replace: true });
        return;
      }

      // If the user arrived via an invite link (or any protected page) before
      // being redirected to login, honour that original destination.
      const savedRedirect = sessionStorage.getItem('postLoginRedirect');
      sessionStorage.removeItem('postLoginRedirect');

      if (savedRedirect) {
        navigate(savedRedirect, { replace: true });
        return;
      }

      const hasOrg =
        Array.isArray(user.organisations) && user.organisations.length > 0;
      navigate(hasOrg ? '/workspace' : '/onboarding', { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-base">
      <p className="font-body text-[color:var(--color-text-secondary)]">
        Signing you in…
      </p>
    </div>
  );
};

export default AuthCallbackPage;
