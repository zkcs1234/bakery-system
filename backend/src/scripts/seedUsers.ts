/**
 * seedUsers.ts
 * Run: npm run seed
 * Creates auth users + profile rows in Supabase for all roles.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BRANCHES = {
  shoppers:  '10000000-0000-0000-0000-000000000001',
  gallares: '10000000-0000-0000-0000-000000000002',
  panglao: '10000000-0000-0000-0000-000000000003',
  trinidad:  '10000000-0000-0000-0000-000000000004',
};

const SEED_USERS = [
  { email: 'bakeryadmin@gmail.com',       password: 'Admin@1234',  full_name: 'Production Bakery Admin',       role: 'admin',          branch_id: null,           mixer_team: null     },
  { email: 'bakerysupervisor@gmail.com',  password: 'Supervisor@1234',  full_name: 'Bakery Supervisor',  role: 'supervisor',     branch_id: null,           mixer_team: null     },
  { email: 'shoppersbranch@gmail.com',     password: 'SBranch@1234', full_name: 'Shoppers Branch Manager', role: 'branch_manager', branch_id: BRANCHES.shoppers, mixer_team: null     },
  { email: 'gallaresbranch@gmail.com',     password: 'GBranch@1234', full_name: 'Gallares Branch Manager', role: 'branch_manager', branch_id: BRANCHES.gallares, mixer_team: null     },
  { email: 'panglaobranch@gmail.com',     password: 'PBranch@1234', full_name: 'Panglao Branch Manager', role: 'branch_manager', branch_id: BRANCHES.panglao, mixer_team: null     },
  { email: 'trinidadbranch@gmail.com',     password: 'TBranch@1234', full_name: 'Trinidad Branch Manager', role: 'branch_manager', branch_id: BRANCHES.trinidad,  mixer_team: null     },
  { email: 'bakeryscaler@gmail.com',      password: 'Scaler@1234',  full_name: 'Jennifer Halawig',     role: 'scaler',         branch_id: null,           mixer_team: null     },
  { email: 'branchmixer@gmail.com',     password: 'Mixer@1234',  full_name: 'Kenneth Samijon',   role: 'mixer',          branch_id: null,           mixer_team: 'team_a' },
  { email: 'baker1@gmail.com',       password: 'Baker@1234',  full_name: 'Leah Rama',      role: 'baker',          branch_id: null,           mixer_team: null     },
  { email: 'baker2@gmail.com',      password: 'Baker@1234',  full_name: 'Malou Astronomo',     role: 'baker',          branch_id: null,           mixer_team: null     },
  { email: 'baker3@gmail.com',       password: 'Baker@1234',  full_name: 'Melody Garcia',      role: 'baker',          branch_id: null,           mixer_team: null     },
  { email: 'baker4@gmail.com',      password: 'Baker@1234',  full_name: 'Jeanel Rolida',     role: 'baker',          branch_id: null,           mixer_team: null     },
  { email: 'repacker@gmail.com',    password: 'Repacker@1234', full_name: 'Dixie Ortado',       role: 'repacker',       branch_id: null,           mixer_team: null     },
];

async function seed(): Promise<void> {
  console.log('🌱 Starting BakeryOS user seed...\n');

  for (const user of SEED_USERS) {
    try {
      // Create auth user
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      });

      if (authErr) {
        if (authErr.message.includes('already been registered')) {
          console.log(`  ⚠️  Skipped (exists): ${user.email}`);
          continue;
        }
        console.error(`  ❌  Auth error for ${user.email}:`, authErr.message);
        continue;
      }

      const userId = authData.user!.id;

      // Upsert profile
      const { error: profileErr } = await supabase.from('users').upsert({
        id: userId,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id,
        mixer_team: user.mixer_team,
        is_active: true,
      });

      if (profileErr) {
        console.error(`  ❌  Profile error for ${user.email}:`, profileErr.message);
      } else {
        console.log(`  ✅  Created: ${user.email} [${user.role}]${user.mixer_team ? ` (${user.mixer_team})` : ''}`);
      }

    } catch (err) {
      console.error(`  💥  Unexpected error for ${user.email}:`, err);
    }
  }

  console.log('\n✅ Seed complete!');
  console.log('\nTest credentials:');
  console.log('  Admin:      admin@bakery.com / Admin@1234');
  console.log('  Supervisor: supervisor@bakery.com / Super@1234');
  console.log('  Branch Mgr: branch1@bakery.com / Branch@1234');
  console.log('  Scaler:     scaler@bakery.com / Scale@1234');
  console.log('  Mixer A:    mixer.a@bakery.com / Mixer@1234');
  console.log('  Baker:      baker@bakery.com / Baker@1234');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
