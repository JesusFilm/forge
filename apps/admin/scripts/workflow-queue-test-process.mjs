// Real SDK/HTTP/queue process used by workflow-queue.db.test.ts.
import { Buffer } from "node:buffer"
import { createServer } from "node:http"
import { createWorld } from "@workflow/world-postgres"
import { getRun } from "workflow/api"
import { setWorld } from "workflow/runtime"

const deliveries = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const attempt = Number(request.headers["x-vqs-message-attempt"])
  deliveries.push({ body, attempt, headers: request.headers, url: request.url })
  if (body.correlationId === "retry" && attempt === 1) {
    response.writeHead(503).end("test transient failure")
  } else if (
    body.correlationId === "resume" &&
    deliveries.filter((row) => row.body.correlationId === "resume").length === 1
  ) {
    response.end(JSON.stringify({ timeoutSeconds: 1 }))
  } else {
    response.end("{}")
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
process.env.WORKFLOW_LOCAL_BASE_URL = `http://127.0.0.1:${server.address().port}`
const world = createWorld({
  connectionString: process.env.WORKFLOW_QUEUE_TEST_DATABASE_URL,
  jobPrefix: process.env.WORKFLOW_QUEUE_TEST_PREFIX,
  queueConcurrency: 2,
  maxPoolSize: 4,
})
setWorld(world)

process.on("message", async ({ id, command, ...args }) => {
  try {
    let result
    if (command === "queue") {
      result = await world.queue(args.queue, args.body, args.options)
    } else if (command === "queueBinary") {
      result = await world.queue(
        "__wkf_workflow_test",
        {
          runId: args.runId,
          runInput: {
            input: new Uint8Array([0, 127, 255]),
            deploymentId: "postgres",
            workflowName: "test",
            specVersion: world.specVersion,
          },
        },
        { delaySeconds: 1 },
      )
    } else if (command === "cancel") {
      const created = await world.events.create(undefined, {
        eventType: "run_created",
        specVersion: world.specVersion,
        eventData: {
          deploymentId: "postgres",
          workflowName: "test",
          input: new Uint8Array(),
        },
      })
      await getRun(created.run.runId).cancel()
      result = await getRun(created.run.runId).status
    } else if (command === "start") {
      await world.start()
    } else if (command === "snapshot") {
      result = deliveries
    } else if (command === "close") {
      await world.close()
      await new Promise((resolve) => server.close(resolve))
    } else {
      throw new Error(`Unknown test command: ${command}`)
    }
    process.send({ id, result }, () => {
      if (command === "close") process.disconnect()
    })
  } catch (error) {
    process.send({ id, error: error.message })
  }
})
process.send({ ready: true })
