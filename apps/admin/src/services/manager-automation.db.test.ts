import { createServer } from "node:http"
import { runManagerAutomationTick } from "./manager-automation-scheduler"
import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { MANAGER_BACKEND_PRINCIPAL as user } from "@/auth/principal"
import { ManagerJobService } from "./manager-job.service"
import { ManagerAutomationService } from "./manager-automation.service"

const url = process.env.MANAGER_AUTOMATION_TEST_DATABASE_URL
const draft = {
  name: "Missing source",
  template: "source_subtitles_missing",
  runMode: "dry_run",
  refreshMode: "missing_only",
  schedule: { kind: "every_minute", timezone: "UTC" },
  targetLanguageIds: [],
  maxVideosPerRun: 6,
}
const success = {
  status: "success",
  eligibleCount: 1,
  enqueuedCount: 0,
  skippedDuplicateCount: 0,
  errorCount: 0,
  jobDocumentIds: [],
  errors: [],
  summary: "Dry run would enqueue one video.",
}
;(url ? describe : describe.skip)("Admin automation database lifecycle", () => {
  let db: PrismaClient
  beforeAll(async () => {
    if (
      url !== "postgresql://forge@127.0.0.1:55890/forge_automation_890_test" &&
      url !==
        "postgresql://forge@127.0.0.1:55932/forge_automation_890_repair_09df2a57"
    )
      throw new Error("Task-owned database required")
    const setup = new Client({ connectionString: url })
    await setup.connect()
    await setup.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    await setup.query(
      "CREATE TABLE language(id TEXT PRIMARY KEY,core_id TEXT, name JSONB DEFAULT '{}',deleted_at TIMESTAMP);",
    )
    await setup.query(
      readFileSync(
        "prisma/migrations/0017_manager_backend_contracts/migration.sql",
        "utf8",
      ),
    )
    await setup.query(
      readFileSync(
        "prisma/migrations/0165_manager_automations/migration.sql",
        "utf8",
      ),
    )
    await setup.query(`
      CREATE TABLE video(id TEXT PRIMARY KEY,core_id TEXT,primary_language_id TEXT,label TEXT,deleted_at TIMESTAMP,published_at TIMESTAMP,ai_metadata BOOLEAN DEFAULT false);
      CREATE TABLE video_locale(id TEXT PRIMARY KEY,video_id TEXT,locale TEXT,title TEXT,description TEXT,deleted_at TIMESTAMP);
      CREATE TABLE mux_video(id TEXT PRIMARY KEY,asset_id TEXT,deleted_at TIMESTAMP);
      CREATE TABLE video_dub(id TEXT PRIMARY KEY,video_id TEXT,language_id TEXT,mux_video_id TEXT,deleted_at TIMESTAMP);
      CREATE TABLE video_subtitle(id TEXT PRIMARY KEY,video_id TEXT,language_id TEXT,ai_generated BOOLEAN,deleted_at TIMESTAMP);
    `)
    await setup.end()
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  })
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      "TRUNCATE video_subtitle,video_dub,mux_video,video_locale,video,manager_enrichment_job,language CASCADE",
    )
    await db.managerAutomationRun.deleteMany()
    await db.managerAutomation.deleteMany()
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("persists the screenshot definition across service instances", async () => {
    const service = new ManagerAutomationService(db)
    const created = await service.create(user, {
      ...draft,
      schedule: {
        kind: "weekly",
        weekday: "mon",
        hour: 9,
        minute: 0,
        timezone: "UTC",
      },
    })
    const reloaded = await new ManagerAutomationService(db).get(
      user,
      created.documentId,
    )
    expect(reloaded).toMatchObject({
      template: "source_subtitles_missing",
      runMode: "dry_run",
      maxVideosPerRun: 6,
      schedule: { kind: "weekly", weekday: "mon" },
    })
    expect(new Date(reloaded!.nextRunAt!).getTime()).toBeGreaterThan(Date.now())
  })
  it("admits exactly one competing manual claim and fences completion", async () => {
    const service = new ManagerAutomationService(db),
      a = await service.create(user, draft)
    const claims = await Promise.all(
      Array.from({ length: 6 }, () =>
        new ManagerAutomationService(db).claim(user, a.documentId),
      ),
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    const run = await service.createRun(user, {
      automationDocumentId: a.documentId,
      leaseToken: claim.leaseToken,
      runMode: "dry_run",
      scheduledFor: new Date().toISOString(),
      idempotencyKey: "one",
    })
    const same = await service.createRun(user, {
      automationDocumentId: a.documentId,
      leaseToken: claim.leaseToken,
      runMode: "dry_run",
      scheduledFor: new Date().toISOString(),
      idempotencyKey: "one",
    })
    expect(same.documentId).toBe(run.documentId)
    await expect(
      service.completeRun(user, run.documentId, success, "wrong-token"),
    ).rejects.toThrow("modified concurrently")
    const completed = await service.completeRun(
      user,
      run.documentId,
      success,
      claim.leaseToken,
    )
    expect(completed.status).toBe("success")
    expect((await service.get(user, a.documentId))!.nextRunAt).toBe(a.nextRunAt)
    await expect(
      service.completeRun(user, run.documentId, success, claim.leaseToken),
    ).resolves.toMatchObject({ status: "success" })
  })
  it("claims one due cycle and preserves pause across completion", async () => {
    const service = new ManagerAutomationService(db),
      a = await service.create(user, draft)
    await db.managerAutomation.update({
      where: { id: a.documentId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    })
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        new ManagerAutomationService(db).claimDue(user),
      ),
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    await service.updateStatus(user, a.documentId, "paused")
    await service.completeRun(
      user,
      claim.run.documentId,
      { ...success, status: "no_op", eligibleCount: 0 },
      claim.leaseToken,
    )
    expect(await service.get(user, a.documentId)).toMatchObject({
      status: "paused",
      nextRunAt: null,
      lastRunStatus: "no_op",
    })
    expect(await service.claimDue(user)).toBeNull()
  })
  it("recovers interrupted cycles without accepting late settlement", async () => {
    const service = new ManagerAutomationService(db),
      a = await service.create(user, draft)
    await db.managerAutomation.update({
      where: { id: a.documentId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    })
    const claim = (await service.claimDue(user))!
    await db.managerAutomation.update({
      where: { id: a.documentId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    expect(await service.claimDue(user)).toBeNull()
    expect(await service.getRun(user, claim.run.documentId)).toMatchObject({
      status: "failed",
    })
    expect(
      new Date((await service.get(user, a.documentId))!.nextRunAt!).getTime(),
    ).toBeGreaterThan(Date.now())
    await expect(
      service.completeRun(
        user,
        claim.run.documentId,
        success,
        claim.leaseToken,
      ),
    ).rejects.toThrow("modified concurrently")
  })
  it("rejects any real job output in a dry-run settlement", async () => {
    const service = new ManagerAutomationService(db),
      a = await service.create(user, draft),
      claim = (await service.claim(user, a.documentId))!
    const run = await service.createRun(user, {
      automationDocumentId: a.documentId,
      leaseToken: claim.leaseToken,
      runMode: "dry_run",
      scheduledFor: new Date().toISOString(),
    })
    await expect(
      service.completeRun(
        user,
        run.documentId,
        { ...success, enqueuedCount: 1, jobDocumentIds: ["bad"] },
        claim.leaseToken,
      ),
    ).rejects.toThrow("Dry runs cannot enqueue")
  })
  it("admits one HTTP dispatch then settles a scheduled cycle in durable storage", async () => {
    const service = new ManagerAutomationService(db)
    const automation = await service.create(user, draft)
    await db.managerAutomation.update({
      where: { id: automation.documentId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    })
    let posts = 0
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const payload = JSON.parse(Buffer.concat(chunks).toString())
      const runId = request.url!.split("/")[4]
      expect(request.headers.authorization).toBe("Bearer task-only-key")
      expect(payload.automation.documentId).toBe(automation.documentId)
      expect(await service.beginDispatch(user, runId, payload.leaseToken)).toBe(
        true,
      )
      expect(await service.beginDispatch(user, runId, payload.leaseToken)).toBe(
        false,
      )
      posts++
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(success))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address() as { port: number }
      const result = await runManagerAutomationTick({
        db,
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "task-only-key",
      })
      expect(result).toEqual({ claimed: 1, failed: 0 })
      expect(posts).toBe(1)
      expect(
        (await service.get(user, automation.documentId))!.runs[0],
      ).toMatchObject({ status: "success", enqueuedCount: 0 })
      expect(await service.claimDue(user)).toBeNull()
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
  it("records HTML transport failure visibly and advances the next cadence", async () => {
    const service = new ManagerAutomationService(db),
      automation = await service.create(user, draft)
    await db.managerAutomation.update({
      where: { id: automation.documentId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    })
    const fetchImpl = async () =>
      new Response("<html>gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      })
    expect(
      await runManagerAutomationTick({
        db,
        baseUrl: "https://manager.test",
        apiKey: "test",
        fetchImpl,
      }),
    ).toEqual({ claimed: 1, failed: 1 })
    expect(
      (await service.get(user, automation.documentId))!.runs[0],
    ).toMatchObject({
      status: "failed",
      errors: ["Manager dispatch returned HTTP 502"],
    })
    expect(await service.claimDue(user)).toBeNull()
  })
  it("selects exact source/target ownership and suppresses active duplicates across the full job table", async () => {
    await db.$executeRawUnsafe(`
      INSERT INTO language(id,core_id) VALUES ('en','529'),('fr','496');
      INSERT INTO video(id,core_id,primary_language_id,published_at) SELECT n,'core-'||n,'en',CURRENT_TIMESTAMP FROM unnest(ARRAY['missing','human','ai','duplicate','wrong-language']) n;
      INSERT INTO mux_video(id,asset_id) VALUES ('mux','asset');
      INSERT INTO video_dub(id,video_id,language_id,mux_video_id) SELECT id,id,'en','mux' FROM video;
      INSERT INTO video_subtitle(id,video_id,language_id,ai_generated) VALUES ('h','human','fr',false),('a','ai','fr',true),('w','wrong-language','en',false);
      INSERT INTO manager_enrichment_job(id,mux_asset_id,status,updated_at,artifacts) VALUES ('duplicate-job','asset','running',CURRENT_TIMESTAMP,'{"automation":{"data":{"automationKey":"target_subtitles_missing:duplicate:496"}}}');
    `)
    const service = new ManagerAutomationService(db)
    const target = await service.candidates(user, {
      template: "target_subtitles_missing",
      refreshMode: "refresh_ai_generated",
      targetLanguageIds: ["496"],
      limit: 100,
    })
    expect(target.eligibleCount).toBe(3)
    expect(target.skippedDuplicateCount).toBe(1)
    expect(target.candidates.map((row) => row.documentId).sort()).toEqual([
      "ai",
      "missing",
      "wrong-language",
    ])
    const missing = await service.candidates(user, {
      template: "target_subtitles_missing",
      refreshMode: "missing_only",
      targetLanguageIds: ["fr"],
      limit: 1,
    })
    expect(missing.eligibleCount).toBe(2)
    expect(missing.candidates).toHaveLength(1)
    const source = await service.candidates(user, {
      template: "source_subtitles_missing",
      refreshMode: "missing_only",
      targetLanguageIds: [],
      limit: 100,
    })
    expect(source.candidates.map((row) => row.documentId)).not.toContain(
      "wrong-language",
    )
    await db.$executeRawUnsafe(
      `INSERT INTO video_locale(id,video_id,locale,title,description) VALUES ('title','human','en','Human title',''),('blank','missing','en','  ','')`,
    )
    const metadata = await service.candidates(user, {
      template: "metadata_missing",
      refreshMode: "missing_only",
      targetLanguageIds: [],
      limit: 100,
    })
    expect(metadata.candidates.map((row) => row.documentId)).not.toContain(
      "human",
    )
    expect(metadata.candidates.map((row) => row.documentId)).toContain(
      "missing",
    )
  })

  it("fences real job insertion against dispatch settlement and expiry", async () => {
    const service = new ManagerAutomationService(db)
    const automation = await service.create(user, { ...draft, runMode: "live" })
    await db.managerAutomation.update({
      where: { id: automation.documentId },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    })
    const claim = (await service.claimDue(user))!
    expect(
      await service.beginDispatch(user, claim.run.documentId, claim.leaseToken),
    ).toBe(true)
    const jobs = new ManagerJobService(db)
    const input = {
      muxAssetId: "asset",
      videoDocumentId: "v1",
      artifacts: {
        automation: {
          kind: "metadata",
          data: {
            automationDocumentId: automation.documentId,
            automationRunDocumentId: claim.run.documentId,
            template: draft.template,
            refreshMode: draft.refreshMode,
            targetLanguageIds: [],
            videoDocumentId: "v1",
            automationKey: `${draft.template}:v1:source`,
          },
        },
      },
    }
    expect((await jobs.create({ user, input })).videoDocumentId).toBe("v1")
    await expect(jobs.create({ user, input })).rejects.toThrow()
    await db.managerAutomation.update({
      where: { id: automation.documentId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    })
    await expect(
      jobs.create({
        user,
        input: {
          ...input,
          videoDocumentId: "v2",
          artifacts: {
            automation: {
              ...input.artifacts.automation,
              data: {
                ...input.artifacts.automation.data,
                videoDocumentId: "v2",
                automationKey: `${draft.template}:v2:source`,
              },
            },
          },
        },
      }),
    ).rejects.toThrow("modified concurrently")
    expect(await db.managerEnrichmentJob.count()).toBe(1)
  })
})
