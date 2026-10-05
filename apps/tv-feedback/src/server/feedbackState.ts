import { randomUUID } from "node:crypto"

import { key, redis } from "./redis"

const RETENTION_SECONDS = 7 * 24 * 60 * 60
const DAILY_REPORT_LIMIT = 3
const DAILY_QR_LIMIT = 12
const REPORT_BYTES = 60 * 1024 * 1024

export type Grant = {
  id: string
  installationId: string
  day: string
  reference: string
  expiresAt: number
  sessionId?: string
  sessionExpiresAt?: number
  reportId?: string
  revoked?: boolean
}

export type Session = {
  id: string
  secretHash: string
  grantId: string
  expiresAt: number
  admittedBytes: number
  images: number
  videos: number
  reservations: number
}

export type Upload = {
  id: string
  sessionId: string
  kind: "image" | "video"
  filename: string
  type: string
  size: number
  status: "reserved" | "uploading" | "ready" | "rejected" | "removed"
  assetUrl?: string
  finalType?: string
  finalSize?: number
  error?: string
}

export type Submission = {
  reportId: string
  sessionId: string
  idempotencyKey: string
  payloadHash: string
  receiptHash: string
  status: "creating" | "delivered" | "needs_attention"
  issueId?: string
}

async function getJson<T>(kind: string, id: string): Promise<T | null> {
  const value = await redis().get(key(kind, id))
  return value ? (JSON.parse(value) as T) : null
}

export async function challenge(id: string): Promise<{
  nonce: string
  day: string
  attempts: number
} | null> {
  return getJson("challenge", id)
}

export async function createChallenge(
  id: string,
  nonce: string,
  day: string,
  ttlSeconds: number,
): Promise<void> {
  await redis().set(
    key("challenge", id),
    JSON.stringify({ nonce, day, attempts: 0 }),
    "EX",
    ttlSeconds,
    "NX",
  )
}

export async function attemptChallenge(id: string): Promise<{
  nonce: string
  day: string
} | null> {
  const result = (await redis().eval(
    `local value = redis.call('GET', KEYS[1])
     if not value then return nil end
     local state = cjson.decode(value)
     if state.attempts >= 3 then return nil end
     state.attempts = state.attempts + 1
     redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
     return cjson.encode({nonce=state.nonce, day=state.day})`,
    1,
    key("challenge", id),
  )) as string | null
  return result ? (JSON.parse(result) as { nonce: string; day: string }) : null
}

export async function issueGrant(
  challengeId: string,
  installationId: string,
  fingerprint: string,
  day: string,
  grant: Grant,
  secretHash: string,
): Promise<
  "ok" | "challenge_expired" | "installation_mismatch" | "daily_limit"
> {
  const result = (await redis().eval(
    `if redis.call('EXISTS', KEYS[1]) == 0 then return 'challenge_expired' end
     local known = redis.call('GET', KEYS[2])
     if known and known ~= ARGV[1] then return 'installation_mismatch' end
     local delivered = tonumber(redis.call('HGET', KEYS[3], 'delivered') or '0')
     local issued = tonumber(redis.call('HGET', KEYS[3], 'issued') or '0')
     if delivered >= tonumber(ARGV[2]) or issued >= tonumber(ARGV[3]) then return 'daily_limit' end
     redis.call('DEL', KEYS[1])
     redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[4])
     redis.call('HINCRBY', KEYS[3], 'issued', 1)
     redis.call('EXPIRE', KEYS[3], ARGV[4])
     redis.call('SET', KEYS[4], ARGV[5], 'EX', ARGV[4])
     redis.call('SET', KEYS[5], ARGV[6], 'EX', ARGV[4])
     return 'ok'`,
    5,
    key("challenge", challengeId),
    key("installation", installationId),
    key("daily", `${installationId}:${day}`),
    key("grant", grant.id),
    key("secret", secretHash),
    fingerprint,
    DAILY_REPORT_LIMIT,
    DAILY_QR_LIMIT,
    RETENTION_SECONDS,
    JSON.stringify(grant),
    grant.id,
  )) as string
  return result as
    | "ok"
    | "challenge_expired"
    | "installation_mismatch"
    | "daily_limit"
}

export async function grantForSecret(hash: string): Promise<Grant | null> {
  const grantId = await redis().get(key("secret", hash))
  return grantId ? getJson<Grant>("grant", grantId) : null
}

export async function grantForId(id: string): Promise<Grant | null> {
  return getJson("grant", id)
}

export async function claimGrant(
  hash: string,
  session: Session,
): Promise<
  { grant: Grant } | { error: "invalid_or_expired_code" | "already_claimed" }
> {
  const result = (await redis().eval(
    `local grantId = redis.call('GET', KEYS[1])
     if not grantId then return 'invalid_or_expired_code' end
     local grantKey = ARGV[1] .. grantId
     local raw = redis.call('GET', grantKey)
     if not raw then return 'invalid_or_expired_code' end
     local grant = cjson.decode(raw)
     if grant.revoked or grant.reportId or grant.expiresAt <= tonumber(ARGV[2]) then return 'invalid_or_expired_code' end
     if grant.sessionId then return 'already_claimed' end
     grant.sessionId = ARGV[3]
     grant.sessionExpiresAt = math.min(grant.expiresAt, tonumber(ARGV[2]) + 1800000)
     redis.call('SET', grantKey, cjson.encode(grant), 'KEEPTTL')
     local session = cjson.decode(ARGV[4])
     session.expiresAt = grant.sessionExpiresAt
     redis.call('SET', KEYS[2], cjson.encode(session), 'EX', ARGV[5])
     return cjson.encode(grant)`,
    2,
    key("secret", hash),
    key("session", session.id),
    key("grant", ""),
    Date.now(),
    session.id,
    JSON.stringify(session),
    RETENTION_SECONDS,
  )) as string
  if (result === "invalid_or_expired_code" || result === "already_claimed")
    return { error: result }
  return { grant: JSON.parse(result) as Grant }
}

export async function sessionForId(id: string): Promise<Session | null> {
  return getJson("session", id)
}

export async function activeGrantForSession(id: string): Promise<Grant | null> {
  const session = await sessionForId(id)
  if (!session || session.expiresAt <= Date.now()) return null
  const grant = await grantForId(session.grantId)
  return grant &&
    grant.sessionId === id &&
    !grant.revoked &&
    !grant.reportId &&
    (grant.sessionExpiresAt ?? 0) > Date.now() &&
    grant.expiresAt > Date.now()
    ? grant
    : null
}

export async function reserveUpload(
  sessionId: string,
  input: Pick<Upload, "kind" | "filename" | "type" | "size">,
): Promise<{ uploadId: string } | { error: string }> {
  const uploadId = randomUUID()
  const upload: Upload = {
    id: uploadId,
    sessionId,
    ...input,
    status: "reserved",
  }
  const session = await sessionForId(sessionId)
  const grant = session ? await activeGrantForSession(sessionId) : null
  if (!session || !grant) return { error: "grant_required" }
  const result = (await redis().eval(
    `local raw = redis.call('GET', KEYS[1])
     local grantRaw = redis.call('GET', KEYS[2])
     if not raw or not grantRaw then return 'grant_required' end
     local s, g = cjson.decode(raw), cjson.decode(grantRaw)
     local now = tonumber(ARGV[1])
     if s.expiresAt <= now or g.sessionId ~= s.id or g.reportId or g.revoked or g.expiresAt <= now then return 'grant_required' end
     local bytes = tonumber(ARGV[2])
     if s.reservations >= 12 or s.admittedBytes + bytes > tonumber(ARGV[3]) then return 'quota_exceeded' end
     if ARGV[4] == 'image' and s.images >= 3 then return 'quota_exceeded' end
     if ARGV[4] == 'video' and s.videos >= 1 then return 'quota_exceeded' end
     local used = tonumber(redis.call('HGET', KEYS[3], 'bytes') or '0')
     if used + bytes > tonumber(ARGV[3]) then return 'quota_exceeded' end
     local serviceBytes = tonumber(redis.call('GET', KEYS[5]) or '0')
     if serviceBytes + bytes > 5368709120 then return 'quota_exceeded' end
     s.admittedBytes = s.admittedBytes + bytes
     s.reservations = s.reservations + 1
     if ARGV[4] == 'image' then s.images = s.images + 1 else s.videos = s.videos + 1 end
     redis.call('SET', KEYS[1], cjson.encode(s), 'KEEPTTL')
     redis.call('HINCRBY', KEYS[3], 'bytes', bytes)
     redis.call('INCRBY', KEYS[5], bytes)
     redis.call('EXPIRE', KEYS[5], 86400)
     redis.call('SET', KEYS[4], ARGV[5], 'EX', ARGV[6])
     return 'ok'`,
    5,
    key("session", sessionId),
    key("grant", grant.id),
    key("daily", `${grant.installationId}:${grant.day}`),
    key("upload", uploadId),
    key("service-bytes", new Date().toISOString().slice(0, 10)),
    Date.now(),
    input.size,
    REPORT_BYTES,
    input.kind,
    JSON.stringify(upload),
    RETENTION_SECONDS,
  )) as string
  return result === "ok" ? { uploadId } : { error: result }
}

export async function uploadForId(id: string): Promise<Upload | null> {
  return getJson("upload", id)
}

export async function transitionUpload(
  id: string,
  sessionId: string,
  from: Upload["status"],
  to: Upload["status"],
  extra: Partial<Upload> = {},
): Promise<Upload | null> {
  const result = (await redis().eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return nil end
     local state = cjson.decode(raw)
     if state.sessionId ~= ARGV[1] or state.status ~= ARGV[2] then return nil end
     state.status = ARGV[3]
     local extra = cjson.decode(ARGV[4])
     for k,v in pairs(extra) do state[k] = v end
     redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
     return cjson.encode(state)`,
    1,
    key("upload", id),
    sessionId,
    from,
    to,
    JSON.stringify(extra),
  )) as string | null
  return result ? (JSON.parse(result) as Upload) : null
}

export async function submissionForId(
  sessionId: string,
  idempotencyKey: string,
): Promise<Submission | null> {
  return getJson("submission", `${sessionId}:${idempotencyKey}`)
}

export async function beginSubmission(
  sessionId: string,
  idempotencyKey: string,
  payloadHash: string,
  receiptHash: string,
  uploadIds: string[],
): Promise<{ submission: Submission; created: boolean } | { error: string }> {
  const session = await sessionForId(sessionId)
  if (!session) return { error: "grant_required" }
  const grant = await grantForId(session.grantId)
  if (!grant) return { error: "grant_required" }
  const reportId = idempotencyKey
  const submission: Submission = {
    reportId,
    sessionId,
    idempotencyKey,
    payloadHash,
    receiptHash,
    status: "creating",
  }
  const result = (await redis().eval(
    `local previous = redis.call('GET', KEYS[1])
     if previous then return 'existing:' .. previous end
     local grantRaw = redis.call('GET', KEYS[2])
     if not grantRaw then return 'grant_required' end
     local grant = cjson.decode(grantRaw)
     local now = tonumber(ARGV[1])
     if grant.sessionId ~= ARGV[2] or grant.revoked or grant.reportId or grant.expiresAt <= now or grant.sessionExpiresAt <= now then return 'grant_required' end
     local count = tonumber(redis.call('HGET', KEYS[3], 'delivered') or '0') + tonumber(redis.call('HGET', KEYS[3], 'pending') or '0')
     if count >= tonumber(ARGV[3]) then return 'daily_limit' end
     for i=5,#KEYS do
       local raw = redis.call('GET', KEYS[i])
       if not raw then return 'files_not_ready' end
       local u = cjson.decode(raw)
       if u.sessionId ~= ARGV[2] or u.status ~= 'ready' then return 'files_not_ready' end
     end
     grant.reportId = ARGV[4]
     redis.call('SET', KEYS[2], cjson.encode(grant), 'KEEPTTL')
     redis.call('HINCRBY', KEYS[3], 'pending', 1)
     redis.call('SET', KEYS[1], ARGV[5], 'EX', ARGV[6])
     redis.call('SET', KEYS[4], ARGV[4], 'EX', ARGV[6])
     return 'created:' .. ARGV[5]`,
    4 + uploadIds.length,
    key("submission", `${sessionId}:${idempotencyKey}`),
    key("grant", grant.id),
    key("daily", `${grant.installationId}:${grant.day}`),
    key("receipt", receiptHash),
    ...uploadIds.map((id) => key("upload", id)),
    Date.now(),
    sessionId,
    DAILY_REPORT_LIMIT,
    reportId,
    JSON.stringify(submission),
    RETENTION_SECONDS,
  )) as string
  if (["grant_required", "daily_limit", "files_not_ready"].includes(result))
    return { error: result }
  return {
    submission: JSON.parse(result.slice(result.indexOf(":") + 1)) as Submission,
    created: result.startsWith("created:"),
  }
}

export async function finishSubmission(
  submission: Submission,
  day: string,
  installationId: string,
  status: Submission["status"],
  issueId?: string,
): Promise<void> {
  const updated = await redis().eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local state = cjson.decode(raw)
     if state.status ~= 'creating' and state.status ~= 'needs_attention' then return 0 end
     state.status = ARGV[1]
     if ARGV[2] ~= '' then state.issueId = ARGV[2] end
     redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
     if ARGV[1] == 'delivered' then
       redis.call('HINCRBY', KEYS[2], 'pending', -1)
       redis.call('HINCRBY', KEYS[2], 'delivered', 1)
     end
     return 1`,
    2,
    key("submission", `${submission.sessionId}:${submission.idempotencyKey}`),
    key("daily", `${installationId}:${day}`),
    status,
    issueId ?? "",
  )
  if (updated !== 1) throw new Error("submission_state_missing")
}

export async function recordIssueId(
  sessionId: string,
  idempotencyKey: string,
  issueId: string,
): Promise<void> {
  const updated = await redis().eval(
    `local raw = redis.call('GET', KEYS[1])
     if not raw then return 0 end
     local state = cjson.decode(raw)
     if state.issueId and state.issueId ~= ARGV[1] then return 0 end
     state.issueId = ARGV[1]
     redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
     return 1`,
    1,
    key("submission", `${sessionId}:${idempotencyKey}`),
    issueId,
  )
  if (updated !== 1) throw new Error("submission_state_missing")
}
