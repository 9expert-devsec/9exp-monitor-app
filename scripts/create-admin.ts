/**
 * Creates the first admin account.
 *
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 *
 * Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local. Creates the
 * auth user (email confirmed) and an `admin` profile with a generated
 * temporary password, which is printed once. The admin must change it at the
 * first sign-in.
 *
 * Refuses if any admin already exists, unless --force is given. Every other
 * account is created from the Users page.
 */

import { parseArgs } from 'node:util'

import { createClient } from '@supabase/supabase-js'
import { config as loadEnv } from 'dotenv'

import { generateTemporaryPassword } from '../src/lib/password'

loadEnv({ path: '.env.local', quiet: true })
loadEnv({ path: '.env', quiet: true })

function fail(message: string): never {
  console.error(`create-admin: ${message}`)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
})

const email = values.email?.trim().toLowerCase()
const fullName = values.name?.trim()
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('pass a valid --email. Usage: npm run create-admin -- --email you@example.com --name "Your Name"')
}
if (!fullName) fail('pass --name "Your Name".')

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) fail('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See .env.example.')

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { count, error: countError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
  if (countError) {
    fail(`could not read profiles (${countError.message}). Has the auth migration been applied?`)
  }
  if ((count ?? 0) > 0 && !values.force) {
    fail(`${count} admin account(s) already exist. Create more from the Users page, or pass --force.`)
  }

  const password = generateTemporaryPassword()
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) fail(`could not create the auth user: ${error?.message ?? 'unknown error'}`)

  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    role: 'admin',
    must_change_password: true,
  })
  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id)
    fail(`could not create the profile, auth user removed again: ${profileError.message}`)
  }

  console.log(`Admin created: ${fullName} <${email}>`)
  console.log('')
  console.log(`  Temporary password: ${password}`)
  console.log('')
  console.log('Shown once — it is not stored anywhere. Sign in at /login; you will be asked to set your own.')
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
