import { createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { z } from "zod"

import { prisma } from "@/db/client"
import {
  redeemAgentLoginHandle,
  AgentLoginError,
} from "@/services/agent-login.service"

export function agentLoginPlugin() {
  return {
    id: "agent-login",
    endpoints: {
      redeemAgentLoginHandle: createAuthEndpoint(
        "/agent-login/redeem",
        {
          method: "POST",
          body: z.object({
            handle: z.string().min(1),
            oauth_query: z.string().optional(),
          }),
        },
        async (ctx) => {
          try {
            const redeemed = await redeemAgentLoginHandle(prisma, {
              handle: ctx.body.handle,
              oauthQuery: ctx.body.oauth_query,
              ipAddress:
                ctx.request?.headers.get("x-forwarded-for") ??
                ctx.request?.headers.get("x-real-ip"),
              userAgent: ctx.request?.headers.get("user-agent"),
            })
            const user = await ctx.context.internalAdapter.findUserById(
              redeemed.userId,
            )
            if (!user) {
              return ctx.json({ error: "Invalid handle" }, { status: 401 })
            }

            const session = await ctx.context.internalAdapter.createSession(
              redeemed.userId,
            )
            await setSessionCookie(ctx, { session, user })

            return ctx.json({ callbackURL: redeemed.callbackURL ?? "/" })
          } catch (error) {
            if (error instanceof AgentLoginError) {
              return ctx.json({ error: "Invalid handle" }, { status: 401 })
            }

            throw error
          }
        },
      ),
    },
  }
}
