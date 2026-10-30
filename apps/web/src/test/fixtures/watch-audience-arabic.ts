import { WatchAudienceConfigurationSchema } from "@forge/experience-schema"
import { WATCH_AUDIENCE_CODE_CONFIG } from "@/lib/watch-audience-config"

/** Every editable copy field is Arabic; IDs, scores and destinations stay real. */
export function arabicAudienceFixture() {
  const config = structuredClone(WATCH_AUDIENCE_CODE_CONFIG)
  for (const [r, role] of config.roles.entries()) {
    role.label = `الجمهور ${r + 1}`
    role.hint = "اختر الخطوة المناسبة لك"
    role.chip = `رحلتي ${r + 1}`
    role.eyebrow = "خطوتك التالية"
    role.heading = "ثلاثة أسئلة قصيرة"
    role.lead = "أجب عن الأسئلة لنقترح خطوتك التالية"
    role.finish = "الخطوة المناسبة لك"
    for (const [q, question] of role.questions.entries()) {
      question.prompt = `ما الذي تبحث عنه في الخطوة ${q + 1}؟`
      for (const [o, option] of question.options.entries()) {
        option.label = `اختياري ${q + 1}، ${o + 1}`
        option.hint = "تعرف على المزيد بلغتك"
        option.reason = "تريد التعرف على المزيد"
      }
    }
    for (const [a, action] of role.actions.entries()) {
      action.title = `خطوة عملية ${a + 1}`
      action.body = "اكتشف المزيد وتابع رحلتك"
    }
  }
  return WatchAudienceConfigurationSchema.parse(config)
}
