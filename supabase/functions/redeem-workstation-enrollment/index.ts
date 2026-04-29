// @ts-ignore Deno resolves URL imports in the Supabase Edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const DEFAULT_ALLOWED_ORIGINS = ['https://kamciosz.github.io', 'http://localhost', 'http://127.0.0.1']

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  try {
    const url = new URL(trimmed)
    return `${url.protocol}//${url.host}`
  } catch {
    return trimmed
  }
}

function configuredAllowedOrigins() {
  const configured = (Deno.env.get('ALLOWED_APP_ORIGINS') || '')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean)
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured].map(normalizeOrigin))
}

function isOriginAllowed(origin: string | null) {
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  if (configuredAllowedOrigins().has(normalized)) return true
  try {
    const url = new URL(normalized)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function responseHeaders(req: Request) {
  const headers: Record<string, string> = { ...CORS_HEADERS }
  const origin = req.headers.get('Origin')
  if (origin && isOriginAllowed(origin)) headers['Access-Control-Allow-Origin'] = normalizeOrigin(origin)
  if (!origin) headers['Access-Control-Allow-Origin'] = 'null'
  return headers
}

function jsonResponse(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(req), 'Content-Type': 'application/json' },
  })
}

function originGuard(req: Request) {
  return isOriginAllowed(req.headers.get('Origin')) ? null : jsonResponse(req, 403, { error: 'Origin not allowed' })
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text.trim()) throw new HttpError(400, 'JSON body is required')
  try {
    const value = JSON.parse(text)
    if (!isPlainObject(value)) throw new HttpError(400, 'JSON body must be an object')
    return value
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Invalid JSON body')
  }
}

function cleanLabel(value: unknown, fallback: string, fieldName: string) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') throw new HttpError(400, `${fieldName} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) return fallback
  if (trimmed.length > 120) throw new HttpError(400, `${fieldName} is too long`)
  return trimmed
}

function parseEnrollmentToken(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Missing enrollment token')
  const token = value.trim().toLowerCase()
  if (!/^amst_[0-9a-f]{64}$/.test(token)) throw new HttpError(400, 'Invalid enrollment token format')
  return token
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: isOriginAllowed(req.headers.get('Origin')) ? 204 : 403, headers: responseHeaders(req) })
  const blocked = originGuard(req)
  if (blocked) return blocked
  if (req.method !== 'POST') return jsonResponse(req, 405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const body = await readPayload(req)
    const token = parseEnrollmentToken(body.token)

    const tokenHash = await sha256Hex(token)
    const workstationNameFromBody = cleanLabel(body.workstationName, 'Workstation', 'workstationName')
    const claimMetadata = {
      workstationName: workstationNameFromBody,
      hostname: cleanLabel(body.hostname, '', 'hostname'),
      os: cleanLabel(body.os, '', 'os'),
      arch: cleanLabel(body.arch, '', 'arch'),
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
      if (!inactiveEnrollment) return jsonResponse(req, 404, { error: 'Enrollment token not found' })
      if (inactiveEnrollment.revoked_at) return jsonResponse(req, 403, { error: 'Enrollment token was revoked' })
      if (new Date(inactiveEnrollment.expires_at).getTime() <= Date.now()) return jsonResponse(req, 403, { error: 'Enrollment token expired' })
      if (Number(inactiveEnrollment.used_count) >= Number(inactiveEnrollment.uses_allowed)) return jsonResponse(req, 403, { error: 'Enrollment token already used' })
      return jsonResponse(req, 403, { error: 'Enrollment token is not active' })
    }

    const { data: fullEnrollment, error: tokenError } = await admin
      .from('workstation_enrollment_tokens')
      .select('*')
      .eq('id', enrollment.id)
      .maybeSingle()
    if (tokenError) throw tokenError

    const stationPassword = randomPassword()
    const workstationName = cleanLabel(body.workstationName, fullEnrollment?.assigned_workstation_name || 'Workstation', 'workstationName')
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

    if (claimMetadata.hostname) {
      const { error: workstationClaimError } = await admin
        .from('workstations')
        .update({
          display_name: workstationName,
          operator_user_id: enrollment.created_by_user_id,
          owner_user_id: enrollment.created_by_user_id,
          station_user_id: createdUser.user.id,
          enrollment_token_id: enrollment.id,
        })
        .eq('hostname', claimMetadata.hostname)
        .eq('owner_user_id', enrollment.created_by_user_id)
      if (workstationClaimError) console.error('[redeem-workstation-enrollment] workstation claim failed', workstationClaimError)
    }

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

    return jsonResponse(req, 200, {
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
    if (error instanceof HttpError) return jsonResponse(req, error.status, { error: error.message })
    console.error('[redeem-workstation-enrollment]', error)
    return jsonResponse(req, 500, { error: errorMessage(error) })
  }
})
