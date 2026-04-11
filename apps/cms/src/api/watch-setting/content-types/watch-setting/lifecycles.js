"use strict"

const { errors } = require("@strapi/utils")

const EXPERIENCE_UID = "api::experience.experience"

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeIdentifier = (value) => {
  if (typeof value === "number") {
    return { key: "id", value }
  }

  if (typeof value !== "string") return null

  if (/^\d+$/.test(value)) {
    return { key: "id", value: Number(value) }
  }

  return { key: "documentId", value }
}

const extractRelationIdentifier = (value) => {
  const direct = normalizeIdentifier(value)
  if (direct) return direct

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = extractRelationIdentifier(entry)
      if (candidate) return candidate
    }
    return null
  }

  if (!isRecord(value)) return null

  if (hasOwn(value, "documentId")) {
    const candidate = normalizeIdentifier(value.documentId)
    if (candidate) return candidate
  }

  if (hasOwn(value, "id")) {
    const candidate = normalizeIdentifier(value.id)
    if (candidate) return candidate
  }

  if (hasOwn(value, "connect")) {
    const candidate = extractRelationIdentifier(value.connect)
    if (candidate) return candidate
  }

  if (hasOwn(value, "set")) {
    const candidate = extractRelationIdentifier(value.set)
    if (candidate) return candidate
  }

  return null
}

const loadExperience = async (reference) => {
  if (!reference) return null

  return strapi.db.query(EXPERIENCE_UID).findOne({
    where: { [reference.key]: reference.value },
    select: ["id", "documentId", "isTemplate"],
  })
}

const validateHomepageExperience = async (data) => {
  if (!isRecord(data) || !hasOwn(data, "homepageExperience")) return
  if (data.homepageExperience == null) return

  const experience = await loadExperience(
    extractRelationIdentifier(data.homepageExperience),
  )

  if (!experience) {
    throw new errors.ApplicationError("Homepage experience could not be found.")
  }

  if (experience.isTemplate === true) {
    throw new errors.ApplicationError(
      "Homepage experience must not be marked as template.",
    )
  }
}

const validateDefaultTemplateExperience = async (data) => {
  if (!isRecord(data) || !hasOwn(data, "defaultTemplateExperience")) return
  if (data.defaultTemplateExperience == null) return

  const experience = await loadExperience(
    extractRelationIdentifier(data.defaultTemplateExperience),
  )

  if (!experience) {
    throw new errors.ApplicationError(
      "Default template experience could not be found.",
    )
  }

  if (experience.isTemplate !== true) {
    throw new errors.ApplicationError(
      "Default template experience must be marked as template.",
    )
  }
}

const validateWatchSettingRelations = async (data) => {
  await validateHomepageExperience(data)
  await validateDefaultTemplateExperience(data)
}

module.exports = {
  async beforeCreate(event) {
    await validateWatchSettingRelations(event?.params?.data)
  },

  async beforeUpdate(event) {
    await validateWatchSettingRelations(event?.params?.data)
  },
}
