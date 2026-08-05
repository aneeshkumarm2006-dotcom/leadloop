import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import AuthScreen from '../components/auth/AuthScreen';

/**
 * Signup shares the Google OAuth flow with login — the backend creates the
 * account on first Google sign-in, so there is no separate credential form.
 * This page just frames that flow as "create an account".
 */
const SignupPage = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const handleGoogleSignUp = () => {
    window.location.href = `${import.meta.env.VITE_API_BASE_URL}/auth/google`;
  };

  return (
    <AuthScreen
      mode="signup"
      title={t('pages.signupTitle')}
      subtitle={t('pages.signupSubtitle')}
      googleLabel={t('pages.signUpWithGoogle')}
      onGoogle={handleGoogleSignUp}
      error={error}
      footer={
        <>
          {t('pages.haveAccount')}{' '}
          <Link
            to="/login"
            className="font-semibold text-[color:var(--color-accent)] hover:underline"
          >
            {t('pages.signInLink')}
          </Link>
        </>
      }
    />
  );
};

export default SignupPage;
