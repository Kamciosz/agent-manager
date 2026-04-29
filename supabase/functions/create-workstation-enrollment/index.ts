// @ts-ignore Deno resolves URL imports in the Supabase Edge runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const DEFAULT_ALLOWED_ORIGINS = ['https://kamciosz.github.io', 'http://localhost', 'http://127.0.0.1']
const MAX_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

function randomToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `amst_${bytesToHex(bytes)}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text)
    if (!isPlainObject(value)) throw new HttpError(400, 'JSON body must be an object')
    return value
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Invalid JSON body')
  }
}

function optionalText(value: unknown, fieldName: string, maxLength: number) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new HttpError(400, `${fieldName} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) throw new HttpError(400, `${fieldName} is too long`)
  return trimmed
}

function parseUses(value: unknown) {
  if (value === undefined || value === null || value === '') return 1
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new HttpError(400, 'usesAllowed must be an integer between 1 and 50')
  }
  return parsed
}

function normalizeExpiresAt(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }
  if (typeof value !== 'string') throw new HttpError(400, 'expiresAt must be an ISO timestamp')
  const date = new Date(value)
  const time = date.getTime()
  const now = Date.now()
  if (!Number.isFinite(time) || time <= now) throw new HttpError(400, 'expiresAt must be a future ISO timestamp')
  if (time - now > MAX_TOKEN_TTL_MS) throw new HttpError(400, 'expiresAt cannot be more than 7 days in the future')
  return date.toISOString()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: isOriginAllowed(req.headers.get('Origin')) ? 204 : 403, headers: responseHeaders(req) })
  const blocked = originGuard(req)
  if (blocked) return blocked
  if (req.method !== 'POST') return jsonResponse(req, 405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = req.headers.get('Authorization') || ''
    const userJwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!userJwt) return jsonResponse(req, 401, { error: 'Missing user Authorization header' })

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const { data: userData, error: userError } = await admin.auth.getUser(userJwt)
    if (userError || !userData.user) return jsonResponse(req, 401, { error: 'Invalid user session' })
    if (userData.user.app_metadata?.role === 'workstation' || userData.user.user_metadata?.role === 'workstation') {
      return jsonResponse(req, 403, { error: 'Workstation accounts cannot create enrollment tokens' })
    }

    const body = await readPayload(req)
    const token = randomToken()
    const tokenHash = await sha256Hex(token)
    const row = {
      token_hash: tokenHash,
      created_by_user_id: userData.user.id,
      assigned_workstation_name: optionalText(body.workstationName, 'workstationName', 120),
      expires_at: normalizeExpiresAt(body.expiresAt),
      uses_allowed: parseUses(body.usesAllowed),
    }

    const { data, error } = await admin
      .from('workstation_enrollment_tokens')
      .insert(row)
      .select('id, created_by_user_id, assigned_workstation_name, expires_at, uses_allowed, used_count, revoked_at, created_at')
      .single()
    if (error) throw error

    return jsonResponse(req, 200, { token, enrollment: data })
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse(req, error.status, { error: error.message })
    console.error('[create-workstation-enrollment]', error)
    return jsonResponse(req, 500, { error: errorMessage(error) })
  }
})
