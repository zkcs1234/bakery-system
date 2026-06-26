import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const email = process.env.DIAG_EMAIL ?? 'admin@bakery.com';
const password = process.env.DIAG_PASSWORD ?? 'Admin@1234';

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
}

// Auth client — for sign in operations
const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Service role client — for admin queries
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('--- BakeryOS login diagnosis ---');
  console.log({ email });

  // 1) try sign in (to verify password/Auth credentials)
  const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  console.log('\n[1] signInWithPassword result');
  if (authErr) {
    console.log('authErr:', authErr.message);
  } else {
    console.log('auth ok, user.id:', authData.user?.id);
  }

  const userId = authData.user?.id;

  // 2) check profile row in our `users` table
  console.log('\n[2] profile lookup in public.users');
  if (!userId) {
    console.log('No auth user id (skipping profile lookup).');
    return;
  }

  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('id, email, role, branch_id, mixer_team, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) {
    console.log('profileErr:', profileErr.message);
  } else {
    console.log('profile:', profile);
    console.log('is_active:', profile?.is_active);
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

