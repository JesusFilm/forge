import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { Readable } from "node:stream"

export class StudioRenderHttpError extends Error {}

/** Private executor exchange: the caller's admission deadline owns the entire
 * request, including time before response headers and streaming response bytes.
 * Global fetch has an independent Undici headers timeout shorter than a render.
 * No pooled socket, implicit redirect, retries or additional idle deadline. */
export function studioRenderHttp(
  url: URL,
  options: {
    signal: AbortSignal
    body?: Buffer
    headers?: Record<string, string>
  },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: options.body ? "POST" : "GET",
        signal: options.signal,
        agent: false,
        timeout: 0,
        headers: {
          ...options.headers,
          ...(options.body
            ? { "content-length": String(options.body.length) }
            : {}),
        },
      },
      (incoming) => {
        const status = incoming.statusCode ?? 500
        if (status >= 300 && status < 400) {
          incoming.destroy()
          reject(new StudioRenderHttpError("Executor redirect rejected"))
          return
        }
        const headers = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) headers.append(key, entry)
          } else if (value !== undefined) headers.set(key, value)
        }
        if ([204, 205, 304].includes(status)) {
          incoming.destroy()
          resolve(new Response(null, { status, headers }))
          return
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status,
            headers,
          }),
        )
      },
    )
    request.once("error", reject)
    request.end(options.body)
  })
}
