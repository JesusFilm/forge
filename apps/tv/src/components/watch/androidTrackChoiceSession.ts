export type TrackChoiceOption = {
  id: string
  label: string
  detail?: string
  searchText?: string
  disabled?: boolean
  pinned?: boolean
}

export type AndroidTrackChoiceModule = {
  showTrackChoice: (
    id: string,
    title: string,
    options: TrackChoiceOption[],
    selected: string | null,
    status: string | null,
    initialQuery: string,
  ) => Promise<{ id: string; query: string } | null>
  updateTrackChoice: (
    id: string,
    options: TrackChoiceOption[],
    selected: string | null,
    status: string | null,
  ) => Promise<void>
  dismissTrackChoice: (id: string) => Promise<void>
}

export function openAndroidTrackChoice(
  native: AndroidTrackChoiceModule,
  id: string,
  title: string,
  options: TrackChoiceOption[],
  selected: string | null,
  status: string | null,
  onSelect: (id: string) => void | false,
  onClose: () => void,
) {
  let active = true
  let disposed = false
  let revision = 0
  let requestId = `${id}-${revision}`
  let current = { options, selected, status }

  function dismiss(targetId: string) {
    try {
      void native.dismissTrackChoice(targetId).catch(() => {})
    } catch {
      // Cleanup is best-effort if the native bridge has already gone away.
    }
  }

  function fail(targetId: string) {
    if (!active || targetId !== requestId) return
    active = false
    dismiss(targetId)
    onClose()
  }

  function present(query: string) {
    const targetId = requestId
    try {
      void native
        .showTrackChoice(
          targetId,
          title,
          current.options,
          current.selected,
          current.status,
          query,
        )
        .then(
          (choice) => {
            if (!active || targetId !== requestId) return
            if (choice == null) {
              active = false
              onClose()
              return
            }
            // The native dialog dismisses for every action. Retry opens a new
            // request with its exact query and the latest data, not a blank search.
            if (onSelect(choice.id) === false) {
              if (!active) return
              revision += 1
              requestId = `${id}-${revision}`
              present(choice.query)
            } else active = false
          },
          () => fail(targetId),
        )
    } catch {
      fail(targetId)
    }
  }

  present("")
  return {
    update(
      nextOptions: TrackChoiceOption[],
      nextSelected: string | null,
      nextStatus: string | null,
    ) {
      if (!active) return
      current = {
        options: nextOptions,
        selected: nextSelected,
        status: nextStatus,
      }
      const targetId = requestId
      try {
        void native
          .updateTrackChoice(targetId, nextOptions, nextSelected, nextStatus)
          .catch(() => fail(targetId))
      } catch {
        fail(targetId)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      active = false
      dismiss(requestId)
    },
  }
}
