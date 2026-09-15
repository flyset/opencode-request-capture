import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode-ai/plugin"

const SESSION_HEADERS = ["x-opencode-session", "x-session-affinity", "session_id"]
const REQUEST_HEADER = "x-opencode-request"
const REDACTED = "[REDACTED]"

type CapturedBody = {
  body: unknown
  rawBody?: string
  bodyType: "empty" | "json" | "text"
}

type CaptureRecord = {
  schemaVersion: 1
  captureID: string
  capturedAt: string
  sessionID: string
  requestID?: string
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
  rawBody?: string
  bodyType: CapturedBody["bodyType"]
}

function sessionIDFrom(request: Request) {
  for (const name of SESSION_HEADERS) {
    const value = request.headers.get(name)?.trim()
    if (value) return value
  }
}

function safeSessionID(sessionID: string) {
  if (sessionID === "." || sessionID === "..") return
  if (!/^[A-Za-z0-9._-]+$/.test(sessionID)) return
  return sessionID
}

function redactHeader(name: string, value: string) {
  const normalized = name.toLowerCase()
  if (
    normalized === "authorization" ||
    normalized === "proxy-authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized.includes("api-key") ||
    normalized.includes("api_key") ||
    normalized.includes("access-token") ||
    normalized.includes("access_token") ||
    normalized.includes("auth-token") ||
    normalized.includes("auth_token")
  ) {
    return REDACTED
  }
  return value
}

function redactedHeaders(headers: Headers) {
  return Object.fromEntries([...headers].map(([name, value]) => [name, redactHeader(name, value)]))
}

function redactedURL(value: string) {
  try {
    const url = new URL(value)
    for (const [name] of url.searchParams) {
      if (/^(api[-_]?key|access[-_]?token|auth[-_]?token|token)$/i.test(name)) {
        url.searchParams.set(name, REDACTED)
      }
    }
    return url.toString()
  } catch {
    return value
  }
}

async function readBody(request: Request): Promise<CapturedBody> {
  if (!request.body) return { body: null, bodyType: "empty" }

  const text = await request.clone().text()
  if (!text) return { body: null, bodyType: "empty" }

  try {
    return { body: JSON.parse(text), rawBody: text, bodyType: "json" }
  } catch {
    return { body: text, rawBody: text, bodyType: "text" }
  }
}

async function nextRequestNumber(directory: string) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory, { withFileTypes: true })
  let maximum = 0

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = /^request-(\d+)\.json$/.exec(entry.name)
    if (match) maximum = Math.max(maximum, Number(match[1]))
  }

  return maximum + 1
}

const RequestCaptureServer: Plugin = async ({ directory }, options) => {
  const enabled = options?.enabled === true
  const requestsRoot = join(directory, ".opencode", "requests")
  const originalFetch = globalThis.fetch
  const queues = new Map<string, Promise<void>>()
  const nextNumbers = new Map<string, number>()

  const persist = async (sessionID: string, record: Omit<CaptureRecord, "sessionID">) => {
    const sessionDirectory = join(requestsRoot, sessionID)
    const next = nextNumbers.get(sessionID) ?? (await nextRequestNumber(sessionDirectory))
    nextNumbers.set(sessionID, next + 1)

    const path = join(sessionDirectory, `request-${next}.json`)
    await writeFile(path, JSON.stringify({ ...record, sessionID }, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    })
  }

  const enqueue = (sessionID: string, request: Request, body: Promise<CapturedBody>) => {
    const previous = queues.get(sessionID) ?? Promise.resolve()
    const next = previous
      .then(async () => {
        const capturedBody = await body
        const requestID = request.headers.get(REQUEST_HEADER)?.trim() || undefined
        await persist(sessionID, {
          schemaVersion: 1,
          captureID: randomUUID(),
          capturedAt: new Date().toISOString(),
          requestID,
          method: request.method,
          url: redactedURL(request.url),
          headers: redactedHeaders(request.headers),
          body: capturedBody.body,
          rawBody: capturedBody.rawBody,
          bodyType: capturedBody.bodyType,
        })
      })
      .catch((error) => {
        console.error("Request capture failed:", error)
      })

    queues.set(sessionID, next)
    void next
  }

  const interceptedFetch: typeof globalThis.fetch = (async (input, init) => {
    if (!enabled) return originalFetch.call(globalThis, input, init)

    let request: Request
    try {
      request = new Request(input, init)
    } catch {
      return originalFetch.call(globalThis, input, init)
    }

    const sessionID = sessionIDFrom(request)
    const safeID = sessionID ? safeSessionID(sessionID) : undefined
    if (safeID) {
      enqueue(safeID, request, readBody(request))
    } else if (sessionID) {
      console.error("Request capture skipped a request with an unsafe session ID.")
    }

    return originalFetch.call(globalThis, request)
  }) as typeof globalThis.fetch

  globalThis.fetch = interceptedFetch

  return {
    dispose: async () => {
      if (globalThis.fetch === interceptedFetch) globalThis.fetch = originalFetch
    },
  }
}

export default RequestCaptureServer
