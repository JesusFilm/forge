"use client"

import { useState } from "react"
import {
  WatchAudienceConfigurationSchema,
  WATCH_AUDIENCE_COPY_LIMITS,
  WATCH_AUDIENCE_MAX_ACTIONS,
  WATCH_AUDIENCE_MAX_OPTIONS,
  WATCH_AUDIENCE_MAX_WEIGHT,
  WATCH_AUDIENCE_MIN_OPTIONS,
  WATCH_AUDIENCE_QUESTION_COUNT,
  WATCH_AUDIENCE_ROLE_IDS,
  createWatchAudienceConfiguration,
  isSafeWatchAudienceTarget,
  type WatchAudienceActionTarget,
  type WatchAudienceConfig,
  type WatchAudienceRoleDefinition,
} from "@forge/experience-schema"

type Props = {
  configuration: unknown
  onChange: (configuration: WatchAudienceConfig) => void
}
const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
const buttonClass =
  "rounded border border-[var(--color-border)] px-2 py-1 text-xs disabled:opacity-40"
function move<T>(items: T[], index: number, offset: number) {
  const next = [...items]
  const destination = index + offset
  if (destination < 0 || destination >= next.length) return next
  ;[next[index], next[destination]] = [next[destination]!, next[index]!]
  return next
}
function freshId(prefix: string, ids: string[]) {
  let i = 1
  while (ids.includes(`${prefix}-${i}`)) i++
  return `${prefix}-${i}`
}
function scoreIdsFor(configuration: WatchAudienceConfig) {
  return configuration.roles.map((role) =>
    role.actions.map((action) => action.id),
  )
}
function TextField({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: string
  max: number
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-xs">
      {label}
      <input
        aria-label={label}
        className={inputClass}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
const roleCopy = [
  "label",
  "hint",
  "chip",
  "eyebrow",
  "heading",
  "lead",
  "finish",
] as const
const actionTargets: WatchAudienceActionTarget["kind"][] = [
  "video",
  "history",
  "languages",
  "current-video",
  "resource",
]
function targetFor(
  kind: WatchAudienceActionTarget["kind"],
): WatchAudienceActionTarget {
  switch (kind) {
    case "video":
      return { kind, slug: "jesus" }
    case "history":
    case "languages":
      return { kind }
    case "current-video":
      return { kind, target: "share" }
    case "resource":
      return { kind, url: "https://www.jesusfilm.org/resources/" }
  }
}

/** Presentation only. Parent owns draft saves, capability preview, revisions
 * and human publish. Invalid edits stay visible with field-local paths. */
export function WatchAudienceEditor({ configuration, onChange }: Props) {
  const [draft, setDraft] = useState<WatchAudienceConfig>(
    () =>
      WatchAudienceConfigurationSchema.safeParse(configuration).data ??
      createWatchAudienceConfiguration(),
  )
  const [roleId, setRoleId] =
    useState<(typeof WATCH_AUDIENCE_ROLE_IDS)[number]>("explore")
  const [raw, setRaw] = useState("")
  const [rawError, setRawError] = useState("")
  const [lastConfiguration, setLastConfiguration] = useState(configuration)
  // Keep score ownership when typed action IDs temporarily collide.
  const [scoreActionIds, setScoreActionIds] = useState(() => scoreIdsFor(draft))
  const incoming = WatchAudienceConfigurationSchema.safeParse(configuration)
  if (configuration !== lastConfiguration) {
    setLastConfiguration(configuration)
    if (incoming.success) {
      setDraft(incoming.data)
      setScoreActionIds(scoreIdsFor(incoming.data))
    }
  }
  const parsed = WatchAudienceConfigurationSchema.safeParse(draft)
  const issues = parsed.success ? [] : parsed.error.issues
  const roleIndex = draft.roles.findIndex((r) => r.id === roleId)
  const role = draft.roles[roleIndex]!
  const actionScoreIds = scoreActionIds[roleIndex]!
  const update = (
    fn: (next: WatchAudienceRoleDefinition, scoreIds: string[]) => void,
  ) => {
    const next = structuredClone(draft)
    const nextScoreIds = scoreActionIds.map((ids) => [...ids])
    const nextRole = next.roles[roleIndex]!
    const previousIds = nextScoreIds[roleIndex]!
    fn(nextRole, previousIds)
    const actionIds = nextRole.actions.map((action) => action.id)
    if (
      actionIds.some((id, i) => id !== previousIds[i]) &&
      new Set(actionIds).size === actionIds.length &&
      new Set(previousIds).size === previousIds.length
    ) {
      // Remap together so resolving a collision by swapping IDs keeps ownership.
      const renamedIds = new Map(
        previousIds.map((id, i) => [id, actionIds[i]!]),
      )
      for (const q of nextRole.questions)
        for (const o of q.options)
          for (const s of o.scores)
            s.actionId = renamedIds.get(s.actionId) ?? s.actionId
      nextScoreIds[roleIndex] = actionIds
    }
    setDraft(next)
    setScoreActionIds(nextScoreIds)
    onChange(next)
  }
  return (
    <div className="space-y-4 p-4" onClick={(event) => event.stopPropagation()}>
      <header>
        <h3 className="text-lg font-semibold">Watch audience questionnaire</h3>
        <p className="text-sm">
          Four roles, exactly three questions each. Publish the default template
          through the existing Publish control to update both Watch surfaces.
        </p>
      </header>
      {!incoming.success && issues.length === 0 && (
        <p role="alert">
          The stored definition needs repair. Edit the fields or import a valid
          definition below, then save the draft.
        </p>
      )}
      {issues.length > 0 && (
        <div role="alert" aria-label="Audience validation errors">
          <p>Fix these fields before saving or publishing:</p>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.path.join(".")}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div role="tablist" aria-label="Audience roles">
        {WATCH_AUDIENCE_ROLE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={roleId === id}
            className={buttonClass}
            onClick={() => setRoleId(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <fieldset className="grid gap-2 md:grid-cols-2">
        <legend>{roleId} copy</legend>
        {roleCopy.map((key) => (
          <TextField
            key={key}
            label={`${roleId} ${key}`}
            value={role[key]}
            max={WATCH_AUDIENCE_COPY_LIMITS[key]}
            onChange={(value) =>
              update((r) => {
                r[key] = value
              })
            }
          />
        ))}
      </fieldset>
      <fieldset className="space-y-3">
        <legend>Actions (authored order breaks score ties)</legend>
        {role.actions.map((action, ai) => (
          <div key={ai} className="space-y-2 rounded border p-3">
            <TextField
              label={`Action ${ai + 1} ID`}
              value={action.id}
              max={64}
              onChange={(value) =>
                update((r) => {
                  r.actions[ai]!.id = value
                })
              }
            />
            <TextField
              label={`Action ${ai + 1} title`}
              value={action.title}
              max={WATCH_AUDIENCE_COPY_LIMITS.title}
              onChange={(v) =>
                update((r) => {
                  r.actions[ai]!.title = v
                })
              }
            />
            <TextField
              label={`Action ${ai + 1} body`}
              value={action.body}
              max={WATCH_AUDIENCE_COPY_LIMITS.body}
              onChange={(v) =>
                update((r) => {
                  r.actions[ai]!.body = v
                })
              }
            />
            <label className="block text-xs">
              Action kind
              <select
                aria-label={`Action ${ai + 1} kind`}
                className={inputClass}
                value={action.target.kind}
                onChange={(e) =>
                  update((r) => {
                    r.actions[ai]!.target = targetFor(
                      e.target.value as WatchAudienceActionTarget["kind"],
                    )
                  })
                }
              >
                {actionTargets.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </label>
            {action.target.kind === "video" && (
              <TextField
                label={`Action ${ai + 1} video slug`}
                value={action.target.slug}
                max={100}
                onChange={(slug) =>
                  update((r) => {
                    r.actions[ai]!.target = { kind: "video", slug }
                  })
                }
              />
            )}
            {action.target.kind === "resource" && (
              <TextField
                label={`Action ${ai + 1} HTTPS URL`}
                value={action.target.url}
                max={500}
                onChange={(url) =>
                  update((r) => {
                    r.actions[ai]!.target = { kind: "resource", url }
                  })
                }
              />
            )}
            {action.target.kind === "current-video" && (
              <label>
                Current video control
                <select
                  aria-label={`Action ${ai + 1} video control`}
                  value={action.target.target}
                  onChange={(e) =>
                    update((r) => {
                      r.actions[ai]!.target = {
                        kind: "current-video",
                        target: e.target.value as
                          | "share"
                          | "download"
                          | "bible-quotes"
                          | "next-episode",
                      }
                    })
                  }
                >
                  {["share", "download", "bible-quotes", "next-episode"].map(
                    (target) => (
                      <option key={target}>{target}</option>
                    ),
                  )}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              <button
                className={buttonClass}
                type="button"
                aria-label={`Move action ${ai + 1} up`}
                disabled={ai === 0}
                onClick={() =>
                  update((r, scoreIds) => {
                    r.actions = move(r.actions, ai, -1)
                    scoreIds.splice(
                      0,
                      scoreIds.length,
                      ...move(scoreIds, ai, -1),
                    )
                  })
                }
              >
                Up
              </button>
              <button
                className={buttonClass}
                type="button"
                aria-label={`Move action ${ai + 1} down`}
                disabled={ai === role.actions.length - 1}
                onClick={() =>
                  update((r, scoreIds) => {
                    r.actions = move(r.actions, ai, 1)
                    scoreIds.splice(
                      0,
                      scoreIds.length,
                      ...move(scoreIds, ai, 1),
                    )
                  })
                }
              >
                Down
              </button>
              <button
                className={buttonClass}
                type="button"
                aria-label={`Remove action ${ai + 1}`}
                disabled={role.actions.length <= 1}
                onClick={() =>
                  update((r, scoreIds) => {
                    r.actions.splice(ai, 1)
                    const removedId = scoreIds.splice(ai, 1)[0]!
                    for (const q of r.questions)
                      for (const o of q.options)
                        o.scores = o.scores.filter(
                          (s) => s.actionId !== removedId,
                        )
                  })
                }
              >
                Remove action
              </button>
            </div>
          </div>
        ))}
        <button
          className={buttonClass}
          type="button"
          disabled={role.actions.length >= WATCH_AUDIENCE_MAX_ACTIONS}
          onClick={() =>
            update((r, scoreIds) => {
              r.actions.push({
                id: freshId("action", [
                  ...r.actions.map((a) => a.id),
                  ...scoreIds,
                ]),
                title: "New action",
                body: "Describe this next step",
                target: { kind: "languages" },
              })
              scoreIds.push(r.actions.at(-1)!.id)
            })
          }
        >
          Add action
        </button>
      </fieldset>
      <fieldset className="space-y-4">
        <legend>Exactly three questions</legend>
        {role.questions.map((question, qi) => (
          <div key={qi} className="space-y-2 rounded border p-3">
            <h4>Question {qi + 1}</h4>
            <TextField
              label={`Question ${qi + 1} ID`}
              value={question.id}
              max={64}
              onChange={(v) =>
                update((r) => {
                  r.questions[qi]!.id = v
                })
              }
            />
            <TextField
              label={`Question ${qi + 1} prompt`}
              value={question.prompt}
              max={WATCH_AUDIENCE_COPY_LIMITS.prompt}
              onChange={(v) =>
                update((r) => {
                  r.questions[qi]!.prompt = v
                })
              }
            />
            <button
              className={buttonClass}
              type="button"
              aria-label={`Move question ${qi + 1} up`}
              disabled={qi === 0}
              onClick={() =>
                update((r) => {
                  r.questions = move(r.questions, qi, -1)
                })
              }
            >
              Move question up
            </button>
            <button
              className={buttonClass}
              type="button"
              aria-label={`Move question ${qi + 1} down`}
              disabled={qi === WATCH_AUDIENCE_QUESTION_COUNT - 1}
              onClick={() =>
                update((r) => {
                  r.questions = move(r.questions, qi, 1)
                })
              }
            >
              Move question down
            </button>
            {question.options.map((option, oi) => (
              <div key={oi} className="space-y-2 border-l pl-3">
                {(["id", "label", "hint", "reason"] as const).map((key) => (
                  <TextField
                    key={key}
                    label={`Question ${qi + 1} option ${oi + 1} ${key}`}
                    value={option[key] ?? ""}
                    max={key === "id" ? 64 : WATCH_AUDIENCE_COPY_LIMITS[key]}
                    onChange={(v) =>
                      update((r) => {
                        const o = r.questions[qi]!.options[oi]!
                        if (key === "hint" && !v) delete o.hint
                        else o[key] = v
                      })
                    }
                  />
                ))}
                <p className="text-xs">
                  Scores: 0 omits an action; 1–10 ranks it. Reason completes
                  “Because …”.
                </p>
                {role.actions.map((action, ai) => (
                  <label key={ai} className="block text-xs">
                    {action.title}
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      max={WATCH_AUDIENCE_MAX_WEIGHT}
                      step={1}
                      aria-label={`Question ${qi + 1} option ${oi + 1} score ${action.id}`}
                      value={
                        option.scores.find(
                          (s) => s.actionId === actionScoreIds[ai],
                        )?.weight ?? 0
                      }
                      onChange={(e) =>
                        update((r) => {
                          const o = r.questions[qi]!.options[oi]!
                          o.scores = o.scores.filter(
                            (s) => s.actionId !== actionScoreIds[ai],
                          )
                          const weight = Number(e.target.value)
                          if (weight !== 0)
                            o.scores.push({
                              actionId: actionScoreIds[ai]!,
                              weight,
                            })
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  className={buttonClass}
                  type="button"
                  aria-label={`Move question ${qi + 1} option ${oi + 1} up`}
                  disabled={oi === 0}
                  onClick={() =>
                    update((r) => {
                      r.questions[qi]!.options = move(
                        r.questions[qi]!.options,
                        oi,
                        -1,
                      )
                    })
                  }
                >
                  Move option up
                </button>
                <button
                  className={buttonClass}
                  type="button"
                  aria-label={`Remove question ${qi + 1} option ${oi + 1}`}
                  disabled={
                    question.options.length <= WATCH_AUDIENCE_MIN_OPTIONS
                  }
                  onClick={() =>
                    update((r) => {
                      r.questions[qi]!.options.splice(oi, 1)
                    })
                  }
                >
                  Remove option
                </button>
              </div>
            ))}
            <button
              className={buttonClass}
              type="button"
              aria-label={`Add question ${qi + 1} option`}
              disabled={question.options.length >= WATCH_AUDIENCE_MAX_OPTIONS}
              onClick={() =>
                update((r) => {
                  const options = r.questions[qi]!.options
                  options.push({
                    id: freshId(
                      "option",
                      options.map((o) => o.id),
                    ),
                    label: "New option",
                    reason: "this next step fits you",
                    scores: [],
                  })
                })
              }
            >
              Add option
            </button>
          </div>
        ))}
      </fieldset>
      <details>
        <summary>Try questionnaire preview</summary>
        {parsed.success ? (
          <WatchAudiencePreview key={roleId} role={role} />
        ) : (
          <p>Correct validation errors to preview this definition.</p>
        )}
      </details>
      <details>
        <summary>Import configuration JSON / repair stored definition</summary>
        <textarea
          aria-label="Audience configuration JSON"
          className={inputClass}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          maxLength={150000}
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            try {
              const next = WatchAudienceConfigurationSchema.parse(
                JSON.parse(raw),
              )
              setRawError("")
              setDraft(next)
              setScoreActionIds(scoreIdsFor(next))
              onChange(next)
            } catch (error) {
              setRawError(
                error instanceof Error
                  ? error.message
                  : "Invalid configuration",
              )
            }
          }}
        >
          Apply configuration JSON
        </button>
        {rawError && <p role="alert">{rawError}</p>}
      </details>
    </div>
  )
}

export function WatchAudiencePreview({
  role,
}: {
  role: WatchAudienceRoleDefinition
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const selected = role.questions.flatMap((q) =>
    q.options.filter((o) => o.id === answers[q.id]),
  )
  const ranked = role.actions
    .filter((a) => isSafeWatchAudienceTarget(a.target))
    .map((action, index) => ({
      action,
      index,
      score: selected.reduce(
        (total, o) =>
          total +
          o.scores
            .filter((s) => s.actionId === action.id)
            .reduce((sum, s) => sum + s.weight, 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  return (
    <section aria-label="Questionnaire preview" className="space-y-3 p-3">
      <p>{role.eyebrow}</p>
      <h4>{role.heading}</h4>
      <p>{role.lead}</p>
      {role.questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.prompt}</legend>
          {q.options.map((o) => (
            <label className="block" key={o.id}>
              <input
                type="radio"
                name={`preview-${role.id}-${q.id}`}
                checked={answers[q.id] === o.id}
                onChange={() =>
                  setAnswers((current) => ({ ...current, [q.id]: o.id }))
                }
              />
              {o.label}
              {o.hint && <span> — {o.hint}</span>}
            </label>
          ))}
        </fieldset>
      ))}
      {selected.length === WATCH_AUDIENCE_QUESTION_COUNT && (
        <div role="status">
          <h5>{role.finish}</h5>
          <p>Because {selected.map((o) => o.reason).join("; ")}.</p>
          <ol>
            {ranked.map(({ action, score }) => (
              <li key={action.id}>
                {action.title} ({score})<p>{action.body}</p>
                <small>{action.target.kind}</small>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
