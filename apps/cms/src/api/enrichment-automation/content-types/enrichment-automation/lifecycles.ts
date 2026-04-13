import { assertValidAutomationData } from "../../services/validation"

type LifecycleEvent = {
  params: {
    data: Record<string, unknown>
    where?: Record<string, unknown>
  }
}

type AutomationQuery = {
  findOne: (params: {
    where?: Record<string, unknown>
  }) => Promise<Record<string, unknown> | null>
}

function automationQuery(): AutomationQuery {
  return strapi.db.query(
    "api::enrichment-automation.enrichment-automation",
  ) as unknown as AutomationQuery
}

export default {
  beforeCreate(event: LifecycleEvent) {
    assertValidAutomationData(event.params.data)
  },

  async beforeUpdate(event: LifecycleEvent) {
    const existing = event.params.where
      ? await automationQuery().findOne({ where: event.params.where })
      : null
    assertValidAutomationData({
      ...(existing ?? {}),
      ...event.params.data,
    })
  },
}
