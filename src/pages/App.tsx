import React, { useState, useEffect } from 'react';
import { CustomerPage } from '../components/CustomerPage';
import { AdminPage } from '../components/AdminPage';
import { DatabaseManager } from '../utils/database';
import { REFERENCE_TIME } from '../utils/constants';
import { supabase, getCurrentUser } from '../utils/supabaseClient';

type Mode = 'local' | 'supabase';
type Role = 'customer' | 'admin';

interface AuthState {
  user: any | null;
  isAdmin: boolean;
  isLoading: boolean;
  error: string;
}

const formatLoginError = (message: string) =>
  message === 'Invalid login credentials'
    ? '로그인 정보가 맞지 않습니다. 등록된 사용자 아이디와 비밀번호를 확인하세요.'
    : message;

const loginIdToEmail = (loginId: string) => `${loginId.trim().toLowerCase()}@test.com`;
const getLoginPortalFromPath = (): Role =>
  window.location.pathname.startsWith('/admin') ? 'admin' : 'customer';

const App: React.FC = () => {
  // .env에 Supabase 설정이 있으면 Supabase 모드 (기본값), 없으면 로컬 모드
  const [mode] = useState<Mode>(supabase ? 'supabase' : 'local');
  const [role, setRole] = useState<Role>('customer');
  const [db] = useState(() => new DatabaseManager());
  const [auth, setAuth] = useState<AuthState>({ user: null, isAdmin: false, isLoading: true, error: '' });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginPortal, setLoginPortal] = useState<Role>(getLoginPortalFromPath);
  const [requestedAdminAccess, setRequestedAdminAccess] = useState(() => window.sessionStorage.getItem('cal-dudu-login-portal') === 'admin');
  const isAdminAccountWithoutRole = Boolean(auth.user && requestedAdminAccess && !auth.isAdmin);

  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/customer/login');
    }

    const handlePopState = () => {
      const portal = getLoginPortalFromPath();
      setLoginPortal(portal);
      if (mode === 'local') setRole(portal);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToLogin = (portal: Role) => {
    window.history.pushState({}, '', portal === 'admin' ? '/admin/login' : '/customer/login');
    setLoginPortal(portal);
    setAuth(prev => ({ ...prev, error: '' }));
  };

  // Supabase 모드에서 로그인 상태 확인
  useEffect(() => {
    if (mode !== 'supabase' || !supabase) {
      setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
      return;
    }

    let mounted = true;

    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (mounted) {
          if (user) {
            const isAdmin = user.app_metadata?.role === 'admin';
            const targetRole = isAdmin || requestedAdminAccess ? 'admin' : 'customer';
            setRole(targetRole);
            const expectedPrefix = targetRole === 'admin' ? '/admin/' : '/customer/';
            if (!window.location.pathname.startsWith(expectedPrefix) || window.location.pathname.endsWith('/login')) {
              window.history.replaceState({}, '', targetRole === 'admin' ? '/admin/requests' : '/customer/requests');
            }
            setAuth({ user, isAdmin, isLoading: false, error: '' });
          } else {
            setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
          }
        }
      } catch (err) {
        if (mounted) {
          setAuth({ user: null, isAdmin: false, isLoading: false, error: String(err) });
        }
      }
    };

    checkAuth();

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (mounted) {
        if (session?.user) {
          const isAdmin = session.user.app_metadata?.role === 'admin';
          setRole(isAdmin || requestedAdminAccess ? 'admin' : 'customer');
          setAuth({ user: session.user, isAdmin, isLoading: false, error: '' });
        } else {
          setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
        }
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [mode, requestedAdminAccess]);

  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
    window.history.pushState({}, '', newRole === 'admin' ? '/admin/requests' : '/customer/book');
  };

  const handleResetData = () => {
    if (window.confirm('모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      db.reset();
      window.location.reload();
    }
  };

  const handleGoogleLogin = async () => {
    if (!supabase) return;
    setIsLoggingIn(true);
    setAuth(prev => ({ ...prev, error: '' }));
    try {
      window.sessionStorage.setItem('cal-dudu-login-portal', loginPortal);
      setRequestedAdminAccess(loginPortal === 'admin');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${loginPortal === 'admin' ? '/admin/requests' : '/customer/requests'}`,
        },
      });
      if (error) {
        setAuth(prev => ({ ...prev, error: error.message, isLoading: false }));
        setIsLoggingIn(false);
      }
    } catch (err) {
      setAuth(prev => ({ ...prev, error: String(err), isLoading: false }));
      setIsLoggingIn(false);
    }
  };

  const handleQuickLogin = async (loginId: string) => {
    if (!supabase) return;

    setIsLoggingIn(true);
    setAuth(prev => ({ ...prev, error: '' }));

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginIdToEmail(loginId),
        password: 'password123',
      });

      if (error) {
        setAuth(prev => ({ ...prev, error: formatLoginError(error.message), isLoading: false }));
        return;
      }

      if (!data.user) {
        setAuth(prev => ({ ...prev, error: '로그인 사용자 정보를 받지 못했습니다.', isLoading: false }));
        return;
      }

      const isAdmin = data.user.app_metadata?.role === 'admin';
      if ((loginPortal === 'admin' && !isAdmin) || (loginPortal === 'customer' && isAdmin)) {
        await supabase.auth.signOut();
        setAuth({
          user: null,
          isAdmin: false,
          isLoading: false,
          error: loginPortal === 'admin'
            ? '관리자 권한이 없는 계정입니다.'
            : '관리자 계정은 관리자 로그인 화면을 이용하세요.',
        });
        return;
      }
      setRole(isAdmin ? 'admin' : 'customer');
      window.history.replaceState({}, '', isAdmin ? '/admin/requests' : '/customer/requests');
      setAuth({ user: data.user, isAdmin, isLoading: false, error: '' });
    } catch (err) {
      setAuth(prev => ({ ...prev, error: String(err), isLoading: false }));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;

    try {
      const logoutPortal: Role = auth.isAdmin ? 'admin' : 'customer';
      await supabase.auth.signOut();
      setRole('customer');
      window.history.replaceState({}, '', logoutPortal === 'admin' ? '/admin/login' : '/customer/login');
      setLoginPortal(logoutPortal);
      setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
      setRequestedAdminAccess(false);
      window.sessionStorage.removeItem('cal-dudu-login-portal');
    } catch (err) {
      setAuth({ user: null, isAdmin: false, isLoading: false, error: String(err) });
    }
  };

  // Supabase 모드에서 로그인이 필요한 경우
  if (mode === 'supabase' && !auth.user && auth.isLoading) {
    return (
      <div className="container">
        <div className="header">
          <h1>cal.dudu-works.com</h1>
          <div className="reference-time">
            기준 시각: {REFERENCE_TIME.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (고정)
          </div>
        </div>
        <div className="alert alert-info" style={{ textAlign: 'center' }}>
          로그인 정보를 확인 중입니다...
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>cal.dudu-works.com</h1>
          <div className="reference-time">
            기준 시각: {REFERENCE_TIME.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (고정)
          </div>
        </div>

        <div className="role-selector">
          {mode === 'supabase' && auth.user ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px' }}>
                로그인: {auth.user.email?.replace(/@test\.com$/, '')}{' '}
                {auth.isAdmin && <strong>(관리자)</strong>}
                {isAdminAccountWithoutRole && <strong>(관리자 권한 없음)</strong>}
              </span>
              <button
                className="btn btn-secondary"
                onClick={handleLogout}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                로그아웃
              </button>
            </div>
          ) : mode === 'local' ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', fontSize: '14px' }}>역할</span>
              <button
                className={`btn ${role === 'customer' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleRoleChange('customer')}
                style={{ padding: '8px 16px', fontSize: '14px' }}
              >
                고객
              </button>
              <button
                className={`btn ${role === 'admin' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleRoleChange('admin')}
                style={{ padding: '8px 16px', fontSize: '14px' }}
              >
                어드민
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleResetData}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                데이터 초기화
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {mode === 'local' && (
        <div className="alert alert-info">
          <strong>로컬 모드:</strong> 브라우저 로컬 스토리지에 데이터를 저장합니다. 진짜 인증이 아닌 수업용 데모입니다.
          역할 전환은 이 모드에만 있습니다.
        </div>
      )}

      {mode === 'supabase' && !auth.user && (
        <div>
          {auth.error && (
            <div className="alert alert-error">
              <strong>오류:</strong> {auth.error}
            </div>
          )}

          <div className="login-panel">
            <h2>{loginPortal === 'customer' ? '고객 로그인' : '관리자 로그인'}</h2>
            <p>{loginPortal === 'customer' ? 'Google 계정으로 예약을 신청하고 확인하세요.' : '관리자 권한이 지정된 Google 계정으로 로그인하세요.'}</p>
            <button type="button" className="btn google-login" onClick={handleGoogleLogin} disabled={isLoggingIn}>
              <span aria-hidden="true">G</span>{isLoggingIn ? 'Google로 이동 중...' : 'Google로 계속하기'}
            </button>

            <div className="quick-login">
              <span>또는 테스트</span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleQuickLogin(loginPortal === 'admin' ? 'admin' : 'c01')}
                disabled={isLoggingIn}
              >
                {loginPortal === 'admin' ? '관리자 빠른 로그인' : '고객 C01 빠른 로그인'}
              </button>
            </div>

            <button type="button" className="login-switch" onClick={() => navigateToLogin(loginPortal === 'admin' ? 'customer' : 'admin')} disabled={isLoggingIn}>
              {loginPortal === 'admin' ? '고객 로그인으로 이동' : '관리자 로그인'}
            </button>
          </div>
        </div>
      )}

      {mode === 'supabase' && auth.user && (
        <>
          {isAdminAccountWithoutRole && (
            <div className="alert alert-error">
              <strong>관리자 권한 설정이 필요합니다.</strong>{' '}
              sql/01_set_admin.sql을 실행한 뒤 로그아웃하고 다시 로그인하세요.
            </div>
          )}
          {role === 'customer' && !isAdminAccountWithoutRole && (
            <CustomerPage
              db={db}
              mode={mode}
              userId={auth.user.id}
              loginId={auth.user.email?.replace(/@test\.com$/, '')}
            />
          )}
          {role === 'admin' && auth.isAdmin && <AdminPage db={db} mode={mode} userId={auth.user.id} />}
          {role === 'admin' && !auth.isAdmin && (
            <div className="alert alert-error">
              <strong>오류:</strong> 관리자 권한이 없습니다. app_metadata.role = 'admin'이 필요합니다.
            </div>
          )}
        </>
      )}

      {mode === 'local' && (
        <>
          {role === 'customer' && <CustomerPage db={db} mode={mode} userId="C01" />}
          {role === 'admin' && <AdminPage db={db} mode={mode} userId="ADMIN001" />}
        </>
      )}

    </div>
  );
};

export default App;
