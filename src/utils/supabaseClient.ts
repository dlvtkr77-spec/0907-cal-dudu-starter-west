import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Running in local mode only.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function getCurrentUser() {
  if (!supabase) return null;

  try {
    const { data } = await supabase.auth.getUser();
    return data.user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

export async function getAdminStatus(): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return false;

    const session = await supabase.auth.getSession();
    const appMetadata = session.data.session?.user.app_metadata;
    return appMetadata?.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}
