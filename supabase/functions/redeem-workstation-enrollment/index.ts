import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return 'Internal error'
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

function randomPassword() {
  const bytes = new Uint8Array(36)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

function cleanLabel(value: unknown, fallback: string) {
  return (typeof value === 'string' ? value.trim().slice(0, 120) : '') || fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const body = await req.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) return jsonResponse(400, { error: 'Missing enrollment token' })

    const tokenHash = await sha256Hex(token)
    const workstationNameFromBody = cleanLabel(body.workstationName, 'Workstation')
    const claimMetadata = {
      workstationName: workstationNameFromBody,
      hostname: cleanLabel(body.hostname, ''),
      os: cleanLabel(body.os, ''),
      arch: cleanLabel(body.arch, ''),
    }

    const { data: claimedEnrollment, error: claimError } = await admin.rpc('claim_workstation_enrollment_token', {
      p_token_hash: tokenHash,
      p_redeem_metadata: claimMetadata,
    })
    if (claimError) throw claimError

    const enrollment = Array.isArray(claimedEnrollment) ? claimedEnrollment[0] : claimedEnrollment
    if (!enrollment?.id) {
      const { data: inactiveEnrollment, error: tokenError } = await admin
        .from('workstation_enrollment_tokens')
        .select('id, revoked_at, expires_at, used_count, uses_allowed')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (tokenError) throw tokenError
      if (!inactiveEnrollment) return jsonResponse(404, { error: 'Enrollment token not found' })
      if (inactiveEnrollment.revoked_at) return jsonResponse(403, { error: 'Enrollment token was revoked' })
      if (new Date(inactiveEnrollment.expires_at).getTime() <= Date.now()) return jsonResponse(403, { error: 'Enrollment token expired' })
      if (Number(inactiveEnrollment.used_count) >= Number(inactiveEnrollment.uses_allowed)) return jsonResponse(403, { error: 'Enrollment token already used' })
      return jsonResponse(403, { error: 'Enrollment token is not active' })
    }

    const { data: fullEnrollment, error: tokenError } = await admin
      .from('workstation_enrollment_tokens')
      .select('*')
      .eq('id', enrollment.id)
      .maybeSingle()
    if (tokenError) throw tokenError

    const stationPassword = randomPassword()
    const workstationName = cleanLabel(body.workstationName, fullEnrollment?.assigned_workstation_name || 'Workstation')
    const stationEmail = `station-${crypto.randomUUID()}@agent-manager.local`
    const metadata = {
      role: 'workstation',
      owner_user_id: enrollment.created_by_user_id,
      enrollment_token_id: enrollment.id,
      workstation_name: workstationName,
    }

    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: stationEmail,
      password: stationPassword,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: metadata,
    })
    if (createUserError || !createdUser.user) throw createUserError || new Error('Could not create workstation user')

    const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    const { data: sessionData, error: signInError } = await publicClient.auth.signInWithPassword({
      email: stationEmail,
      password: stationPassword,
    })
    if (signInError || !sessionData.session) throw signInError || new Error('Could not create workstation session')

    const redeemMetadata = {
      workstationName,
      hostname: claimMetadata.hostname,
      os: claimMetadata.os,
      arch: claimMetadata.arch,
      redeemedUserId: createdUser.user.id,
    }
    const { error: updateError } = await admin
      .from('workstation_enrollment_tokens')
      .update({
        last_redeemed_metadata: redeemMetadata,
      })
      .eq('id', enrollment.id)
    if (updateError) console.error('[redeem-workstation-enrollment] redeem metadata update failed', updateError)

    return jsonResponse(200, {
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_at: sessionData.session.expires_at,
        expires_in: sessionData.session.expires_in,
        token_type: sessionData.session.token_type,
        user: sessionData.user,
      },
      station: {
        user_id: createdUser.user.id,
        owner_user_id: enrollment.created_by_user_id,
        enrollment_token_id: enrollment.id,
        email: stationEmail,
        workstation_name: workstationName,
      },
    })
  } catch (error) {
    console.error('[redeem-workstation-enrollment]', error)
    return jsonResponse(500, { error: errorMessage(error) })
  }
})
