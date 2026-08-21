import {
  ConsumerLifecycleService,
  type ConsumerLifecycleApplyResult,
  type ConsumerLifecycleEvent,
} from "./consumer-lifecycle.service"

/** Separate authority from the destructive erasure credential by design. */
export interface ConsumerLifecycleIngestionAuthorizer<Credential = unknown> {
  assertLifecycleAuthorized(credential: Credential): Promise<void> | void
}

export class ConsumerLifecycleIngestionService<Credential = unknown> {
  constructor(
    private readonly lifecycle: ConsumerLifecycleService,
    private readonly authorizer: ConsumerLifecycleIngestionAuthorizer<Credential>,
  ) {}

  async ingest(
    event: ConsumerLifecycleEvent,
    credential: Credential,
  ): Promise<ConsumerLifecycleApplyResult> {
    await this.authorizer.assertLifecycleAuthorized(credential)
    return this.lifecycle.apply(event)
  }
}
