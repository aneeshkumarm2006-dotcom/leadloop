import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import AuthScreen from '../components/auth/AuthScreen';

const LoginPage = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const handleGoogleSignIn = () => {
    window.location.href = `${import.meta.env.VITE_API_BASE_URL}/auth/google`;
  };

  return (
    <AuthScreen
      mode="login"
      title={t('pages.loginTitle')}
      subtitle={t('pages.loginSubtitle')}
      googleLabel={t('pages.signInWithGoogle')}
      onGoogle={handleGoogleSignIn}
      error={error}
      footer={
        <>
          {t('pages.noAccount')}{' '}
          <Link
            to="/signup"
            className="font-semibold text-[color:var(--color-accent)] hover:underline"
          >
            {t('pages.createAccount')}
          </Link>
        </>
      }
    />
  );
};

export default LoginPage;
