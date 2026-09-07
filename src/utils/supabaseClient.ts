import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const getTabAuthStorageKey = () => {
  const tabIdKey = 'cal-dudu-auth-tab-id';
  let tabId = window.sessionStorage.getItem(tabIdKey);

  if (!tabId) {
    tabId = crypto.randomUUID();
    window.sessionStorage.setItem(tabIdKey, tabId);
  }

  return `cal-dudu-auth-${tabId}`;
};

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Running in local mode only.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: window.sessionStorage,
        storageKey: getTabAuthStorageKey(),
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function getCurrentUser() {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn('getCurrentUser error:', error);
      return null;
    }
    return data?.user || null;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

export async function getAdminStatus(): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return false;

    const session = await supabase.auth.getSession();
    const appMetadata = session.data.session?.user.app_metadata;
    return appMetadata?.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}
