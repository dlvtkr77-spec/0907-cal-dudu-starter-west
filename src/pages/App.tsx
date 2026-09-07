import React, { useState, useEffect } from 'react';
import { CustomerPage } from '../components/CustomerPage';
import { AdminPage } from '../components/AdminPage';
import { DatabaseManager } from '../utils/database';
import { REFERENCE_TIME } from '../utils/constants';
import { supabase, getCurrentUser, getAdminStatus } from '../utils/supabaseClient';

type Mode = 'local' | 'supabase';
type Role = 'customer' | 'admin';

interface AuthState {
  user: any | null;
  isAdmin: boolean;
  isLoading: boolean;
  error: string;
}

const App: React.FC = () => {
  // .env에 Supabase 설정이 있으면 Supabase 모드 (기본값), 없으면 로컬 모드
  const [mode] = useState<Mode>(supabase ? 'supabase' : 'local');
  const [role, setRole] = useState<Role>('customer');
  const [db] = useState(() => new DatabaseManager());
  const [auth, setAuth] = useState<AuthState>({ user: null, isAdmin: false, isLoading: true, error: '' });
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Supabase 모드에서 로그인 상태 확인
  useEffect(() => {
    if (mode !== 'supabase' || !supabase) return;

    const checkAuth = async () => {
      try {
        const user = await getCurrentUser();
        if (user) {
          const isAdmin = await getAdminStatus();
          setAuth({ user, isAdmin, isLoading: false, error: '' });
        } else {
          setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
        }
      } catch (err) {
        setAuth({ user: null, isAdmin: false, isLoading: false, error: String(err) });
      }
    };

    checkAuth();

    // 인증 상태 변경 리스너
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const isAdmin = await getAdminStatus();
        setAuth({ user: session.user, isAdmin, isLoading: false, error: '' });
      } else {
        setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [mode]);

  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
  };

  const handleResetData = () => {
    if (window.confirm('모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      db.reset();
      window.location.reload();
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !loginEmail || !loginPassword) {
      setAuth(prev => ({ ...prev, error: '이메일과 비밀번호를 입력하세요' }));
      return;
    }

    setIsLoggingIn(true);
    setAuth(prev => ({ ...prev, error: '' }));

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) {
        setAuth(prev => ({ ...prev, error: error.message, isLoading: false }));
        setIsLoggingIn(false);
        return;
      }

      if (data.user) {
        const isAdmin = await getAdminStatus();
        setAuth({ user: data.user, isAdmin, isLoading: false, error: '' });
        setLoginEmail('');
        setLoginPassword('');
      }
    } catch (err) {
      setAuth(prev => ({ ...prev, error: String(err), isLoading: false }));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setAuth(prev => ({ ...prev, error: error.message }));
      } else {
        setAuth({ user: null, isAdmin: false, isLoading: false, error: '' });
      }
    } catch (err) {
      setAuth(prev => ({ ...prev, error: String(err) }));
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
                로그인: {auth.user.email} {auth.isAdmin && <strong>(관리자)</strong>}
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
          <div className="alert alert-info">
            <strong>Supabase 모드:</strong> 실제 데이터베이스와 인증이 적용됩니다.
          </div>

          {auth.error && (
            <div className="alert alert-error">
              <strong>오류:</strong> {auth.error}
            </div>
          )}

          <div style={{ maxWidth: '400px', margin: '40px auto', padding: '20px', border: '1px solid #ddd', borderRadius: '4px' }}>
            <h2>Supabase 로그인</h2>
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label>이메일</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="test@example.com"
                  disabled={isLoggingIn}
                  required
                />
              </div>

              <div className="form-group">
                <label>비밀번호</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="비밀번호"
                  disabled={isLoggingIn}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={isLoggingIn}
                style={{ width: '100%' }}
              >
                {isLoggingIn ? '로그인 중...' : '로그인'}
              </button>
            </form>
          </div>
        </div>
      )}

      {mode === 'supabase' && auth.user && (
        <>
          {role === 'customer' && <CustomerPage db={db} mode={mode} userId={auth.user.id} />}
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

      <hr style={{ margin: '40px 0', borderColor: '#ddd' }} />
      <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', paddingBottom: '20px' }}>
        <p>cal.dudu-works.com v1.0 - 수업용 기본 실습 앱</p>
        <p>기본값: 42슬롯(14일 × 3시간대), 고객 1-3개 희망, 어드민 수동 확정</p>
      </div>
    </div>
  );
};

export default App;
