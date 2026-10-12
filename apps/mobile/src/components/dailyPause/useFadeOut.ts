// Keeps a view mounted while it plays its exit, so it can fade out instead of
// leaving at once. The paused cue and the close prompt use it.
import { useEffect, useState } from "react"

type FadeState = {
  shown: boolean
  owner: string
  show: number
  leaving: boolean
}

/** `mounted` stays true for `exitMs` after `shown` turns false, and `leaving`
 *  is true for that time. `show` changes at each show. A new `owner` (another
 *  part) drops a leaving view at once, so it never fades over the next part. */
export function useFadeOut(
  shown: boolean,
  owner: string,
  exitMs: number,
): { mounted: boolean; leaving: boolean; show: number } {
  const [state, setState] = useState<FadeState>({
    shown,
    owner,
    show: 0,
    leaving: false,
  })
  if (shown !== state.shown || owner !== state.owner) {
    setState({
      shown,
      owner,
      show: shown && !state.shown ? state.show + 1 : state.show,
      leaving: !shown && state.shown && owner === state.owner,
    })
  }
  useEffect(() => {
    if (!state.leaving) return
    const timer = setTimeout(
      () => setState((now) => ({ ...now, leaving: false })),
      exitMs,
    )
    return () => clearTimeout(timer)
  }, [state.leaving, state.show, exitMs])
  const leaving = !shown && state.leaving
  return { mounted: shown || leaving, leaving, show: state.show }
}
