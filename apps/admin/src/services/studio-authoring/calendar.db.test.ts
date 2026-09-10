import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { StudioCalendarService } from "./calendar"
const url = process.env.STUDIO_CALENDAR_TEST_DATABASE_URL
class CalendarFixtureError extends Error {}
;(url ? describe : describe.skip)("calendar commands", () => {
  let db: PrismaClient
  const user = {
    id: "studio461-test-" + randomUUID(),
    role: "ADMIN" as const,
    managerRole: "OPERATOR" as const,
    studioAuthority: "interactive" as const,
  }
  beforeAll(async () => {
    if (url !== "postgresql://tataihono@127.0.0.1:55461/forge_studio_461_test")
      throw new CalendarFixtureError("Task-owned database required")
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    await db.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        name: "Calendar operator",
        email: user.id + "@studio461.invalid",
        role: "ADMIN",
        managerMembership: { create: { role: "OPERATOR" } },
      },
      update: {},
    })
  })
  afterAll(async () => db?.$disconnect())
  it("persists one calendar and preserves an explicit override across retries and a new service instance", async () => {
    const service = new StudioCalendarService(db),
      calendarId = randomUUID()
    const input = {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      settings: {
        timeZone: "Pacific/Auckland",
        publishTime: "09:00",
        deliveryWindowMinutes: 60,
        plannerTimes: ["06:00"],
        automationEnabled: false,
        defaultPackRevisionIds: [],
        language: "english",
      },
    }
    await service.configure(user, input)
    await service.configure(user, input)
    const before = await service.read(user, calendarId)
    expect(before.slots).toHaveLength(28)
    const edit = {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date: before.slots[0].date,
      title: "My chosen title",
      theme: "My chosen theme",
      packRevisionId: null,
      projectId: null,
    }
    await service.editSlot(user, edit)
    await service.editSlot(user, edit)
    const after = await new StudioCalendarService(db).read(user, calendarId)
    expect(after.slots[0]).toMatchObject({
      title: "My chosen title",
      theme: "My chosen theme",
      manual: true,
      version: 1,
      projectId: null,
    })
    await expect(
      service.editSlot(user, {
        ...edit,
        idempotencyKey: randomUUID(),
        title: "stale overwrite",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
  it("rejects stale configuration after a queued weekly update wins the calendar lock", async () => {
    const service = new StudioCalendarService(db),
      calendarId = randomUUID()
    const settings = {
      timeZone: "UTC",
      publishTime: "09:00",
      deliveryWindowMinutes: 60,
      plannerTimes: ["06:00"],
      automationEnabled: false,
      defaultPackRevisionIds: [],
      language: "english",
    }
    await service.configure(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      settings,
    })
    const today = new Date()
    today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7))
    let held: () => void = () => {},
      release: () => void = () => {}
    const locked = new Promise<void>((resolve) => {
      held = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM short_calendar WHERE id=${calendarId} FOR UPDATE`
      held()
      await gate
    })
    const waiters = async () => {
      const rows = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%short_calendar%'`
      return Number(rows[0].count)
    }
    await locked
    const weekly = service.assignWeek(user, {
      calendarId,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      startDate: today.toISOString().slice(0, 10),
      theme: "Human weekly theme",
      packRevisionId: null,
    })
    try {
      await expect.poll(waiters).toBe(1)
      const configuration = service.configure(user, {
        calendarId,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        settings: { ...settings, timeZone: "Pacific/Auckland" },
      })
      const rejected = expect(configuration).rejects.toMatchObject({
        code: "CONFLICT",
      })
      await expect.poll(waiters).toBe(2)
      release()
      await blocker
      await expect(weekly).resolves.toMatchObject({ version: 2 })
      await rejected
      expect((await service.read(user, calendarId)).settings.timeZone).toBe(
        "UTC",
      )
    } finally {
      release()
      await blocker
    }
  })
  it.each(["none", "week", "slot"] as const)(
    "suggests only complete future weeks and preserves human changes (%s)",
    async (humanEdit) => {
      const { ContentPackService } = await import("./packs")
      const pack = await new ContentPackService(db).write(user, {
        packId: randomUUID(),
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          title: "Weekly guidance",
          guidance: "Hope together",
          sources: [],
        },
      })
      const service = new StudioCalendarService(db),
        worker = { id: "system", role: "SYSTEM" as const }
      const slotPack = await new ContentPackService(db).write(user, {
        packId: randomUUID(),
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          title: "One slot only",
          guidance: "Local hope",
          sources: [],
        },
      })
      const calendarId = randomUUID()
      await service.configure(user, {
        calendarId,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        settings: {
          timeZone: "UTC",
          publishTime: "09:00",
          deliveryWindowMinutes: 60,
          plannerTimes: ["00:00"],
          automationEnabled: true,
          defaultPackRevisionIds: [pack.id],
          language: "english",
        },
      })
      const before = await service.read(user, calendarId)
      const futureDates = before.slots.slice(14).map((slot) => slot.date)
      const expectedWeeks = futureDates.filter(
        (date) =>
          new Date(date + "T12:00Z").getUTCDay() === 1 &&
          Date.parse(date + "T00:00Z") + 6 * 86400000 <=
            Date.parse(futureDates.at(-1)! + "T00:00Z"),
      )
      const assignedDate = expectedWeeks[0]
      await service.editSlot(user, {
        calendarId,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        date: assignedDate,
        title: "",
        theme: "",
        projectId: null,
        packRevisionId: slotPack.id,
      })
      const run = await service.beginAutomaticPlanning(worker, calendarId)
      if (!run) throw new CalendarFixtureError("Expected automatic planning")
      expect(run.input.weeks?.map((week) => week.startDate)).toEqual(
        expectedWeeks,
      )
      const week = {
        startDate: expectedWeeks[0],
        theme: "A week of hope",
        packRevisionId: slotPack.id,
        sourceIndices: [],
      }
      const result = {
        items: [],
        weeks: [week],
        instructions: [
          {
            agentVersionId: "native-weekly",
            blockVersionId: "native-guidance",
            digest: "a".repeat(64),
          },
        ],
        effectiveDigest: "a".repeat(64),
      }
      await service.claimPlanning(worker, run.id)
      await expect(
        service.finishPlanning(worker, run.id, {
          ...result,
          weeks: [{ ...week, startDate: before.slots[0].date }],
        }),
      ).rejects.toMatchObject({ code: "INVALID" })
      if (humanEdit === "week")
        await service.assignWeek(user, {
          calendarId,
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          startDate: week.startDate,
          theme: "Operator wins",
          packRevisionId: null,
        })
      if (humanEdit === "slot")
        await service.editSlot(user, {
          calendarId,
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          date: assignedDate,
          title: "",
          theme: "",
          projectId: null,
          packRevisionId: pack.id,
        })
      await service.finishPlanning(worker, run.id, result)
      const after = await service.read(user, calendarId)
      expect(after.version).toBe(humanEdit === "slot" ? 1 : 2)
      expect(after.slots.slice(0, 14)).toEqual(before.slots.slice(0, 14))
      expect(
        after.slots.every(
          (slot) => !slot.title && !slot.theme && !slot.projectId,
        ),
      ).toBe(true)
      if (humanEdit === "slot") {
        expect(after.weeks).toHaveLength(0)
        return
      }
      expect(after.weeks[0]).toMatchObject(
        humanEdit === "week"
          ? { theme: "Operator wins", packRevisionId: null, provenance: null }
          : {
              theme: week.theme,
              packRevisionId: null,
              provenance: {
                packRevisionId: slotPack.id,
                runId: run.id,
                sourceState: "MISSING",
                sourceIndices: [],
              },
            },
      )
      if (humanEdit === "none") {
        const next = await service.beginPlanning(user, {
          calendarId,
          idempotencyKey: randomUUID(),
        })
        for (const slot of next.input.slots.filter(
          (slot) =>
            slot.date >= assignedDate &&
            Date.parse(slot.date + "T00:00Z") <
              Date.parse(assignedDate + "T00:00Z") + 7 * 86400000,
        ))
          expect(slot.packRevisionIds).toEqual([
            slot.date === assignedDate ? slotPack.id : pack.id,
          ])
      }
    },
  )
  it("admits planning once, preserves a racing manual override, and does not invent source evidence", async () => {
    const { ContentPackService } = await import("./packs")
    const pack = await new ContentPackService(db).write(user, {
      packId: randomUUID(),
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        title: "Hope",
        guidance: "Titles about hope; source selection is still missing",
        sources: [],
      },
    })
    const service = new StudioCalendarService(db),
      calendarId = randomUUID()
    await service.configure(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      settings: {
        timeZone: "Pacific/Auckland",
        publishTime: "09:00",
        deliveryWindowMinutes: 60,
        plannerTimes: ["06:00"],
        automationEnabled: false,
        defaultPackRevisionIds: [pack.id],
        language: "english",
      },
    })
    const input = { calendarId, idempotencyKey: randomUUID() }
    const run = await service.beginPlanning(user, input)
    expect((await service.beginPlanning(user, input)).id).toBe(run.id)
    const first = run.input.slots[0],
      second = run.input.slots[1]
    await service.editSlot(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date: first.date,
      title: "Manual wins",
      theme: "Chosen",
      packRevisionId: pack.id,
      projectId: null,
    })
    const result = {
      items: [first, second].map((slot) => ({
        date: slot.date,
        expectedVersion: slot.version,
        title: "A hopeful morning",
        theme: "Hope today",
        packRevisionId: pack.id,
        sourceIndices: [],
      })),
      instructions: [
        {
          agentVersionId: "native-agent",
          blockVersionId: "native-block",
          digest: "a".repeat(64),
        },
      ],
      effectiveDigest: "a".repeat(64),
    }
    await service.claimPlanning({ id: "system", role: "SYSTEM" }, run.id)
    await service.finishPlanning(
      { id: "system", role: "SYSTEM" },
      run.id,
      result,
    )
    const after = await service.read(user, calendarId)
    expect(after.slots[0]).toMatchObject({ title: "Manual wins", manual: true })
    expect(after.slots[1]).toMatchObject({
      title: "A hopeful morning",
      projectId: null,
      provenance: { sourceState: "MISSING" },
    })
    await expect(
      service.finishPlanning({ id: "system", role: "SYSTEM" }, run.id, {
        ...result,
        script: "not allowed",
      }),
    ).rejects.toThrow()
  })
  it("plans an empty pack-assigned slot and deduplicates simultaneous daily admissions", async () => {
    const { ContentPackService } = await import("./packs")
    const pack = await new ContentPackService(db).write(user, {
      packId: randomUUID(),
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: { title: "Guidance", guidance: "Hope", sources: [] },
    })
    const service = new StudioCalendarService(db),
      calendarId = randomUUID()
    await service.configure(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      settings: {
        timeZone: "UTC",
        publishTime: "09:00",
        deliveryWindowMinutes: 60,
        plannerTimes: ["00:00"],
        automationEnabled: true,
        defaultPackRevisionIds: [],
        language: "english",
      },
    })
    const visible = (await service.read(user, calendarId)).slots
    const day = visible[14].date
    await service.editSlot(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date: day,
      title: "",
      theme: "",
      packRevisionId: pack.id,
      projectId: null,
    })
    const worker = { id: "system", role: "SYSTEM" as const }
    const [one, two] = await Promise.all([
      service.beginAutomaticPlanning(worker, calendarId),
      service.beginAutomaticPlanning(worker, calendarId),
    ])
    expect(one?.id).toBe(two?.id)
    const claims = await Promise.all([
      service.claimPlanning(worker, one!.id),
      service.claimPlanning(worker, two!.id),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(one?.input.slots.map((slot) => slot.date)).toEqual(
      visible.slice(14).map((slot) => slot.date),
    )
    await expect(
      service.finishPlanning(worker, one!.id, {
        items: [
          {
            date: visible[0].date,
            expectedVersion: 0,
            title: "Outside admission",
            theme: "Hope",
            packRevisionId: pack.id,
            sourceIndices: [],
          },
        ],
        instructions: [
          {
            agentVersionId: "native-agent",
            blockVersionId: "native-block",
            digest: "a".repeat(64),
          },
        ],
        effectiveDigest: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "INVALID" })
    expect(one?.input.slots.find((slot) => slot.date === day)).toMatchObject({
      packRevisionIds: [pack.id],
    })
    expect(await db.shortPlanningRun.count({ where: { calendarId } })).toBe(1)
    await expect(
      service.beginAutomaticPlanning(user, calendarId),
    ).rejects.toThrow()
    await service.configure(user, {
      calendarId,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      settings: {
        timeZone: "UTC",
        publishTime: "09:00",
        deliveryWindowMinutes: 60,
        plannerTimes: ["00:00"],
        automationEnabled: false,
        defaultPackRevisionIds: [],
        language: "english",
      },
    })
    expect(await service.beginAutomaticPlanning(worker, calendarId)).toBeNull()
  })
  it("admits explicit production from verified selected pack bytes without modifying work or generating, and blocks missing sources", async () => {
    const { StudioAuthoringService } = await import("./index"),
      { StudioAssetService } = await import("./assets"),
      { ContentPackService } = await import("./packs"),
      { admitCalendarProduction } = await import("./calendar-production")
    const calendar = new StudioCalendarService(db),
      commands = new StudioAuthoringService(db),
      calendarId = randomUUID(),
      projectId = randomUUID()
    const source = await new StudioAssetService(db).register(
      user,
      {
        filename: "editorial.txt",
        mimeType: "text/plain",
        role: "document",
        idempotencyKey: randomUUID(),
        provenance: {
          status: "recorded",
          recorded: { author: "Local editorial fixture" },
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
        title: "Hope source",
        guidance: "Use this editorial source",
        sources: [
          {
            label: "Editorial source",
            asset: source.reference,
            excerpt: "Hope can grow through patient care.",
          },
        ],
      },
    })
    await calendar.configure(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      settings: {
        timeZone: "UTC",
        publishTime: "09:00",
        deliveryWindowMinutes: 60,
        plannerTimes: ["06:00"],
        automationEnabled: false,
        defaultPackRevisionIds: [pack.id],
        language: "english",
      },
    })
    const date = (await calendar.read(user, calendarId)).slots[0].date
    await commands.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Human edited title",
        language: "english",
        runtimeVersion: "fixture",
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 30,
        tracks: [],
        items: [],
        components: [],
        packRevisionIds: [pack.id],
      },
    })
    await calendar.editSlot(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date,
      title: "Calendar title",
      theme: "Hope",
      packRevisionId: pack.id,
      projectId,
    })
    const input = {
      calendarId,
      idempotencyKey: randomUUID(),
      confirmed: true,
      targets: [{ date, version: 1, projectId, revision: 1 }],
    }
    const admitted = await admitCalendarProduction(db, user, input)
    // Multiple VALUES rows must retain the numeric revision type in PostgreSQL.
    const nextDate = (await calendar.read(user, calendarId)).slots[1].date
    await calendar.editSlot(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date: nextDate,
      title: "Another planned item",
      theme: "Hope",
      packRevisionId: pack.id,
      projectId,
    })
    expect((await calendar.read(user, calendarId)).slots[1]).toHaveProperty(
      "projectSourcesSelected",
      true,
    )
    expect((await calendar.read(user, calendarId)).slots[0]).toHaveProperty(
      "projectSourcesSelected",
      true,
    )
    expect(admitted).toEqual(await admitCalendarProduction(db, user, input))
    expect(admitted.requests).toHaveLength(1)
    expect(admitted.requests[0]).toMatchObject({
      projectId,
      expectedRevision: 1,
    })
    expect((await commands.read(user, projectId)).document.title).toBe(
      "Human edited title",
    )
    expect(await db.shortAttempt.count({ where: { projectId } })).toBe(0)
    await expect(
      admitCalendarProduction(db, { id: null, role: "SYSTEM" }, input),
    ).rejects.toThrow()
    await commands.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "assign-content-packs", packRevisionIds: [] }],
    })
    expect((await calendar.read(user, calendarId)).slots[0]).toHaveProperty(
      "projectSourcesSelected",
      false,
    )
    await expect(
      admitCalendarProduction(db, user, {
        ...input,
        idempotencyKey: randomUUID(),
        targets: [{ date, version: 1, projectId, revision: 2 }],
      }),
    ).rejects.toMatchObject({ code: "UNREADY" })
  })
  it("consumes calendar authorization with publication atomically, rolls back verifier failure and keeps accepted retries after unpublish", async () => {
    const { StudioAuthoringService } = await import("./index"),
      { StudioAssetService } = await import("./assets"),
      { StudioCatalogService } = await import("./catalog"),
      { StudioCalendarPublication } = await import("./calendar-publication"),
      { publishStudioProject } = await import("./publication"),
      { StudioRenderJobs } = await import("./render-jobs"),
      { ContentPackService } = await import("./packs")
    const service = new StudioCalendarService(db),
      delivery = new StudioCalendarPublication(db),
      commands = new StudioAuthoringService(db),
      assets = new StudioAssetService(db),
      worker = { id: "system", role: "SYSTEM" as const }
    const calendarId = randomUUID(),
      projectId = randomUUID(),
      language = randomUUID(),
      now = new Date(),
      date = now.toISOString().slice(0, 10)
    await db.language.create({
      data: {
        coreId: language,
        slug: language,
        bcp47: "en",
        name: { en: "Calendar fixture" },
      },
    })
    await service.configure(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      settings: {
        timeZone: "UTC",
        publishTime: now.toISOString().slice(11, 16),
        deliveryWindowMinutes: 60,
        plannerTimes: ["06:00"],
        automationEnabled: false,
        defaultPackRevisionIds: [],
        language,
      },
    })
    const selectedSource = await assets.register(
      user,
      {
        filename: "editorial.txt",
        mimeType: "text/plain",
        role: "document",
        idempotencyKey: randomUUID(),
        provenance: {
          status: "recorded",
          recorded: { author: "Owned transaction fixture" },
        },
      },
      Buffer.from("Hope can grow through patient care."),
      "LOCAL",
    )
    const selectedPack = await new ContentPackService(db).write(user, {
      packId: randomUUID(),
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        title: "Transaction source",
        guidance: "Hope",
        sources: [
          {
            label: "Editorial",
            asset: selectedSource.reference,
            excerpt: "Hope can grow through patient care.",
          },
        ],
      },
    })
    await commands.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Transaction fixture only",
        language,
        runtimeVersion: "studio-proof-1",
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 30,
        tracks: [],
        items: [],
        components: [],
        packRevisionIds: [selectedPack.id],
      },
    })
    const render = await commands.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const jobs = new StudioRenderJobs(db)
    await jobs.enqueue(worker, render.attemptId!)
    const lease = await jobs.claim(worker, render.attemptId!)
    const attempt = await commands.readAttempt(
      worker,
      projectId,
      render.attemptId!,
    )
    const output = await assets.register(
      worker,
      {
        filename: "fixture.mp4",
        mimeType: "video/mp4",
        role: "render",
        idempotencyKey: randomUUID(),
        provenance: {
          status: "recorded",
          recorded: { fixture: "transaction only, not codec proof" },
        },
      },
      Buffer.from("local transaction fixture"),
      "LOCAL",
    )
    const report = {
      version: 1,
      projectId,
      revision: 1,
      renderAttemptId: render.attemptId!,
      inputHash: attempt.inputHash,
      output: output.reference,
      language,
      runtimeVersion: "studio-proof-1",
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 30,
      verification: {
        status: "verified",
        verifierVersion: "fixture",
        outputDigest: output.reference.digest,
      },
    }
    const manifest = await assets.register(
      worker,
      {
        filename: "report.json",
        mimeType: "application/json",
        role: "manifest",
        idempotencyKey: randomUUID(),
        provenance: {
          status: "recorded",
          recorded: { fixture: "transaction only" },
        },
      },
      Buffer.from(JSON.stringify(report)),
      "LOCAL",
    )
    await jobs.finish(worker, {
      attemptId: render.attemptId!,
      leaseId: lease.leaseId!,
      status: "SUCCEEDED",
      result: {
        assets: [output.reference],
        manifest: manifest.reference,
        costMicros: 0,
      },
    })
    const release = await new StudioCatalogService(db).stage(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      renderAttemptId: render.attemptId!,
      mux: {
        assetId: randomUUID(),
        playbackId: randomUUID(),
        policy: "signed",
        status: "ready",
      },
    })
    const approval = await commands.approve(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "PUBLICATION",
      renderAttemptId: render.attemptId!,
    })
    await service.editSlot(user, {
      calendarId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date,
      title: "Ready for review",
      theme: "",
      packRevisionId: null,
      projectId,
    })
    const authorization = {
      calendarId,
      expectedCalendarVersion: 1,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      date,
      projectId,
      expectedRevision: 1,
      approvalId: approval.approvalId!,
      renderAttemptId: render.attemptId!,
      releaseId: release.id,
    }
    let authorized = await delivery.authorize(user, authorization)
    const cancelledEnvelope = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      approvalId: approval.approvalId!,
      renderAttemptId: render.attemptId!,
      releaseId: release.id,
      readinessId: "fixture-readiness",
      schedule: authorized.binding,
    }
    await delivery.rememberSubmission(cancelledEnvelope)
    const cancelledFirst = await delivery.cancel(user, {
      calendarId,
      expectedVersion: authorized.binding.version,
      idempotencyKey: randomUUID(),
      authorizationId: authorized.authorizationId,
    })
    await expect(
      publishStudioProject(db, worker, cancelledEnvelope, async () => {}, {
        input: cancelledEnvelope,
        consume: delivery.consume,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" })
    authorized = await delivery.authorize(user, {
      ...authorization,
      expectedVersion: cancelledFirst.version,
      idempotencyKey: randomUUID(),
    })
    const input = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      approvalId: approval.approvalId!,
      renderAttemptId: render.attemptId!,
      releaseId: release.id,
      readinessId: "fixture-readiness",
      schedule: authorized.binding,
    }
    const scheduled = { input, consume: delivery.consume }
    expect(await delivery.rememberSubmission(input)).toEqual(input)
    expect(
      await new StudioCalendarPublication(db).rememberSubmission(input),
    ).toEqual(input)
    await expect(
      delivery.rememberSubmission({
        ...input,
        readinessId: "different-readiness",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await db.managerMembership.update({
      where: { userId: user.id },
      data: { revokedAt: new Date() },
    })
    try {
      await expect(
        publishStudioProject(db, worker, input, async () => {}, scheduled),
      ).rejects.toMatchObject({ code: "AUTHORIZATION_REVOKED" })
    } finally {
      await db.managerMembership.update({
        where: { userId: user.id },
        data: { revokedAt: null },
      })
    }
    await expect(
      publishStudioProject(
        db,
        worker,
        input,
        async () => {
          throw new CalendarFixtureError("Verifier rejected")
        },
        scheduled,
      ),
    ).rejects.toThrow("Verifier rejected")
    expect(
      (await service.read(user, calendarId)).slots.find((s) => s.date === date)
        ?.authorizations[0].consumedAt,
    ).toBeNull()
    // The common command's entry time is insufficient after a real slot wait.
    let slotLocked: () => void = () => {},
      releaseSlot: () => void = () => {}
    const locked = new Promise<void>((resolve) => {
      slotLocked = resolve
    })
    const unlock = new Promise<void>((resolve) => {
      releaseSlot = resolve
    })
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM short_plan_slot WHERE calendar_id=${calendarId} AND date=${date} FOR UPDATE`
      slotLocked()
      await unlock
    })
    await locked
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(now)
    const expiredPublication = publishStudioProject(
      db,
      worker,
      input,
      async () => {},
      scheduled,
    )
    const expired = expect(expiredPublication).rejects.toMatchObject({
      code: "DELIVERY_EXPIRED",
    })
    try {
      await expect
        .poll(async () => {
          const waiting = await db.$queryRaw<
            { count: bigint }[]
          >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%short_plan_slot%'`
          return Number(waiting[0].count)
        })
        .toBeGreaterThan(0)
      vi.setSystemTime(new Date(Date.parse(input.schedule.latestAllowedAt) + 1))
      releaseSlot()
      await blocker
      await expired
    } finally {
      releaseSlot()
      await blocker
      vi.useRealTimers()
    }
    expect(
      (
        await db.shortScheduleAuthorization.findUniqueOrThrow({
          where: { id: authorized.authorizationId },
        })
      ).consumedAt,
    ).toBeNull()
    let reachedVerifier: () => void = () => {},
      releaseVerifier: () => void = () => {}
    const reached = new Promise<void>((resolve) => {
      reachedVerifier = resolve
    })
    const verificationRelease = new Promise<void>((resolve) => {
      releaseVerifier = resolve
    })
    const publication = publishStudioProject(
      db,
      worker,
      input,
      async () => {
        reachedVerifier()
        await verificationRelease
      },
      scheduled,
    )
    await reached
    const cancellation = delivery.cancel(user, {
      calendarId,
      expectedVersion: authorized.binding.version,
      idempotencyKey: randomUUID(),
      authorizationId: authorized.authorizationId,
    })
    const cancelled = expect(cancellation).rejects.toMatchObject({
      code: "ALREADY_CONSUMED",
    })
    releaseVerifier()
    await publication
    await cancelled
    expect(
      (await service.read(user, calendarId)).slots.find((s) => s.date === date)
        ?.authorizations[0].consumedAt,
    ).not.toBeNull()
    await commands.unpublish(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    })
    await expect(
      publishStudioProject(
        db,
        worker,
        input,
        async () => {
          throw new CalendarFixtureError("Retry called verifier")
        },
        scheduled,
      ),
    ).resolves.toMatchObject({ outcome: "ACCEPTED" })
    expect((await commands.read(user, projectId)).lifecycle).toBe("UNPUBLISHED")
  })
})
