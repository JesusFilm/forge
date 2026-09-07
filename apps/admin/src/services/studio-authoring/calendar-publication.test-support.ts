import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { STUDIO_CODEC_VERIFIER_VERSION } from "@forge/studio-contracts/render"
import { ContentPackService } from "./packs"
import { StudioAuthoringService } from "./index"
import { StudioAssetService } from "./assets"
import { StudioRenderJobs } from "./render-jobs"
import { StudioCatalogService } from "./catalog"
import { StudioCatalogReadinessService } from "./catalog-readiness"
import { StudioCalendarService } from "./calendar"
import { StudioCalendarPublication } from "./calendar-publication"

/** Synthetic transaction evidence only; never a renderer/provider acceptance proof. */
export async function calendarPublicationFixture(
  db: PrismaClient,
  withSource = true,
) {
  const projectId = randomUUID(),
    calendarId = randomUUID(),
    worker = { id: "system", role: "SYSTEM" as const },
    user = {
      id: randomUUID(),
      role: "ADMIN" as const,
      managerRole: "OPERATOR" as const,
      studioAuthority: "interactive" as const,
    }
  await db.user.create({
    data: {
      id: user.id,
      name: "Calendar transaction operator",
      email: `${user.id}@studio461.invalid`,
      role: "ADMIN",
      managerMembership: { create: { role: "OPERATOR" } },
    },
  })
  const language = randomUUID()
  await db.language.create({
    data: {
      coreId: language,
      slug: language,
      bcp47: "en",
      name: { en: "Fixture" },
    },
  })
  const commands = new StudioAuthoringService(db),
    assets = new StudioAssetService(db),
    jobs = new StudioRenderJobs(db)
  const source = await assets.register(
    user,
    {
      filename: "editorial.txt",
      mimeType: "text/plain",
      role: "document",
      idempotencyKey: randomUUID(),
      provenance: {
        status: "recorded",
        recorded: { author: "Owned synthetic editorial fixture" },
      },
    },
    Buffer.from("Hope can grow through patient care."),
    "LOCAL",
  )
  const pack = await new ContentPackService(db).write(user, {
    packId: randomUUID(),
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
    document: {
      title: "Calendar source",
      guidance: "Hope",
      sources: withSource
        ? [
            {
              label: "Owned editorial",
              asset: source.reference,
              excerpt: "Hope can grow through patient care.",
            },
          ]
        : [],
    },
  })
  const document = {
    version: 1,
    title: "Calendar transaction fixture",
    language,
    runtimeVersion: STUDIO_RUNTIME_VERSION,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [pack.id],
  }
  await commands.create(user, {
    projectId,
    expectedRevision: 0,
    idempotencyKey: randomUUID(),
    document,
  })
  const render = await commands.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    }),
    attemptId = render.attemptId!
  await jobs.enqueue(worker, attemptId)
  const lease = await jobs.claim(worker, attemptId),
    attempt = await db.studioAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    })
  const register = (
    filename: string,
    mimeType: string,
    role: "render" | "manifest",
    bytes: Buffer,
  ) =>
    assets.register(
      worker,
      {
        filename,
        mimeType,
        role,
        idempotencyKey: randomUUID(),
        provenance: {
          status: "recorded",
          recorded: { fixture: "calendar transaction only" },
        },
      },
      bytes,
      "LOCAL",
    )
  const output = await register(
    "transaction.mp4",
    "video/mp4",
    "render",
    Buffer.from("transaction fixture only, not media"),
  )
  const codec = await register(
    "codec.json",
    "application/json",
    "manifest",
    Buffer.from(
      JSON.stringify({
        version: 1,
        verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
        outputDigest: output.reference.digest,
        decoded: true,
        video: {
          codec: "h264",
          width: 320,
          height: 180,
          fps: 30,
          frames: 30,
          durationMs: 1000,
        },
        audio: {
          codec: "aac",
          sampleRate: 48000,
          channels: 2,
          durationMs: 1000,
        },
      }),
    ),
  )
  const manifest = await register(
    "manifest.json",
    "application/json",
    "manifest",
    Buffer.from(
      JSON.stringify({
        version: 1,
        projectId,
        revision: 1,
        renderAttemptId: attemptId,
        inputHash: attempt.inputHash,
        output: output.reference,
        language,
        runtimeVersion: STUDIO_RUNTIME_VERSION,
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 30,
        verification: {
          status: "verified",
          verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
          outputDigest: output.reference.digest,
        },
      }),
    ),
  )
  await jobs.finish(worker, {
    attemptId,
    leaseId: lease.leaseId!,
    status: "SUCCEEDED",
    result: {
      assets: [output.reference, codec.reference],
      manifest: manifest.reference,
      costMicros: 0,
    },
  })
  const mux = {
    assetId: randomUUID(),
    playbackId: randomUUID(),
    policy: "signed",
    status: "ready",
  }
  const release = await new StudioCatalogService(db).stage(worker, {
    projectId,
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
    renderAttemptId: attemptId,
    mux,
  })
  const approval = await commands.approve(user, {
    projectId,
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
    kind: "PUBLICATION",
    renderAttemptId: attemptId,
  })
  const readiness = {
    id: randomUUID(),
    releaseId: release.id,
    attemptId,
    leaseId: lease.leaseId!,
    proof: {
      output: output.reference,
      codecProof: codec.reference,
      observedAt: new Date().toISOString(),
      mux: {
        assetId: mux.assetId,
        playbackId: mux.playbackId,
        status: "ready",
        playbackPolicies: ["signed"],
        width: 320,
        height: 180,
        fps: 30,
        durationMs: 1000,
        audio: true,
      },
    },
  }
  await new StudioCatalogReadinessService(db).record(worker, readiness)
  const calendar = new StudioCalendarService(db),
    publication = new StudioCalendarPublication(db),
    now = new Date(),
    date = now.toISOString().slice(0, 10)
  const settings = {
    timeZone: "UTC",
    publishTime: now.toISOString().slice(11, 16),
    deliveryWindowMinutes: 60,
    plannerTimes: ["06:00"],
    automationEnabled: false,
    defaultPackRevisionIds: [],
    language,
  }
  await calendar.configure(user, {
    calendarId,
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
    settings,
  })
  await calendar.editSlot(user, {
    calendarId,
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
    date,
    title: "Schedule transaction",
    theme: "",
    packRevisionId: null,
    projectId,
  })
  const authorization = {
    calendarId,
    date,
    expectedCalendarVersion: 1,
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
    projectId,
    expectedRevision: 1,
    renderAttemptId: attemptId,
    releaseId: release.id,
    approvalId: approval.approvalId!,
  }
  const authorized = await publication.authorize(user, authorization)
  return {
    user,
    worker,
    commands,
    calendar,
    publication,
    calendarId,
    projectId,
    date,
    settings,
    authorization,
    authorized,
    readiness,
  }
}
