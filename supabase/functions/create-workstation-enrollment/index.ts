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

function randomToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `amst_${bytesToHex(bytes)}`
}

function clampUses(value: unknown) {
  const parsed = Number.parseInt(String(value || '1'), 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(50, parsed))
}

function normalizeExpiresAt(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    if (Number.isFinite(date.getTime()) && date.getTime() > Date.now()) return date.toISOString()
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = req.headers.get('Authorization') || ''
    const userJwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!userJwt) return jsonResponse(401, { error: 'Missing user Authorization header' })

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(userJwt)
    if (userError || !userData.user) return jsonResponse(401, { error: 'Invalid user session' })
    if (userData.user.app_metadata?.role === 'workstation' || userData.user.user_metadata?.role === 'workstation') {
      return jsonResponse(403, { error: 'Workstation accounts cannot create enrollment tokens' })
    }

    const body = await req.json().catch(() => ({}))
    const token = randomToken()
    const tokenHash = await sha256Hex(token)
    const row = {
      token_hash: tokenHash,
      created_by_user_id: userData.user.id,
      assigned_workstation_name: typeof body.workstationName === 'string' ? body.workstationName.trim().slice(0, 120) || null : null,
      expires_at: normalizeExpiresAt(body.expiresAt),
      uses_allowed: clampUses(body.usesAllowed),
    }

    const { data, error } = await admin
      .from('workstation_enrollment_tokens')
      .insert(row)
      .select('id, created_by_user_id, assigned_workstation_name, expires_at, uses_allowed, used_count, revoked_at, created_at')
      .single()
    if (error) throw error

    return jsonResponse(200, { token, enrollment: data })
  } catch (error) {
    console.error('[create-workstation-enrollment]', error)
    return jsonResponse(500, { error: errorMessage(error) })
  }
})
