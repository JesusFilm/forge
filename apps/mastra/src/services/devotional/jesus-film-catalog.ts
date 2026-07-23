/**
 * The JESUS film (1979) chapter catalog — all 61 segments, in order.
 *
 * Source: the Jesus Film Project Arclight public API (api.arclight.org/v2),
 * parent feature mediaComponentId "1_jf-0-0" (containsCount 61), English
 * languageId 529. Child component ids run 1_jf6101-0-0 … 1_jf6161-0-0.
 * Start offsets are derived (cumulative segment lengths), accurate to a few
 * seconds. Mirror of devo/jesus-film-chapter-titles.txt.
 *
 * Used by the local video matcher so a devotional can reference a real JESUS
 * chapter WITHOUT the admin search API (which isn't reachable in local dev).
 */

export type JesusFilmChapter = {
  /** 1-based chapter number, 1..61. */
  index: number
  /** Arclight media-component id, e.g. "1_jf6101-0-0". */
  id: string
  title: string
  /** Approximate start offset within the feature, "H:MM:SS". */
  start: string
}

function chapterId(index: number): string {
  return `1_jf61${String(index).padStart(2, "0")}-0-0`
}

const TITLES_AND_STARTS: ReadonlyArray<[string, string]> = [
  ["The Beginning", "0:00:00"],
  ["Birth of Jesus", "0:08:08"],
  ["Childhood of Jesus", "0:11:51"],
  ["Baptism of Jesus by John", "0:14:06"],
  ["The Devil Tempts Jesus", "0:17:53"],
  ["Jesus Proclaims Fulfillment of the Scriptures", "0:20:16"],
  ["Parable of the Pharisee and Tax Collector", "0:23:23"],
  ["Miraculous Catch of Fish", "0:24:25"],
  ["Jairus's Daughter Brought Back to Life", "0:26:26"],
  ["Disciples Chosen", "0:28:41"],
  ["Beatitudes", "0:31:52"],
  ["Sermon on the Mount", "0:32:55"],
  ["Blessed are those Who Hear and Obey", "0:36:34"],
  ["Sinful Woman Forgiven", "0:36:53"],
  ["Women Disciples", "0:39:50"],
  ["John the Baptist in Prison", "0:40:33"],
  ["Parable of the Sower and the Seed", "0:42:29"],
  ["Parable of the Lamp", "0:44:48"],
  ["Jesus Calms the Storm", "0:45:44"],
  ["Healing of the Demoniac", "0:47:42"],
  ["Jesus Feeds 5,000", "0:49:59"],
  ["Peter Declares Jesus to be the Christ", "0:52:28"],
  ["The Transfiguration", "0:53:52"],
  ["Jesus Heals Boy from Evil Spirit", "0:55:38"],
  ["The Lord's Prayer", "0:57:53"],
  ["Teaching About Prayer and Faith", "0:58:51"],
  ["Woe to Those Who Cause Others to Sin", "1:01:14"],
  ["The Kingdom of God as a Mustard Seed", "1:02:09"],
  ["Jesus Spends Time with Sinners", "1:02:37"],
  ["Healing on the Sabbath", "1:03:07"],
  ["Parable of the Good Samaritan", "1:05:04"],
  ["Healing of Bartimaeus", "1:06:42"],
  ["Jesus and Zaccheus", "1:08:27"],
  ["Jesus Predicts His Death and Resurrection", "1:10:49"],
  ["Jesus's Triumphal Entry", "1:11:31"],
  ["Jesus Weeps Over Jerusalem", "1:12:41"],
  ["Jesus Drives Out Money Changers", "1:13:41"],
  ["Widow's Offering", "1:15:33"],
  ["Annas Questions Jesus's Authority", "1:16:19"],
  ["Parable of the Vineyard and Tenants", "1:17:19"],
  ["Paying Taxes to Caesar", "1:19:09"],
  ["The Last Supper", "1:20:07"],
  ["Upper Room Teaching", "1:23:03"],
  ["Jesus is Betrayed and Arrested", "1:25:32"],
  ["Peter Disowns Jesus", "1:29:54"],
  ["Jesus is Mocked and Questioned", "1:32:18"],
  ["Jesus is Brought To Pilate", "1:34:16"],
  ["Jesus is Brought to Herod", "1:36:00"],
  ["Jesus is Sentenced", "1:37:24"],
  ["Jesus Carries His Cross", "1:40:21"],
  ["Jesus is Crucified", "1:43:55"],
  ["Soldiers Gamble for Jesus's Clothes", "1:46:44"],
  ["Sign on the Cross", "1:47:41"],
  ["Crucified Convicts", "1:48:48"],
  ["Death of Jesus", "1:50:28"],
  ["Burial of Jesus", "1:52:13"],
  ["Angels at the Tomb", "1:54:14"],
  ["The Tomb Is Empty", "1:55:43"],
  ["Resurrected Jesus Appears", "1:57:05"],
  ["Great Commission and Ascension", "1:59:01"],
  ["Invitation to Know Jesus Personally", "2:00:17"],
]

export const JESUS_FILM_CHAPTERS: ReadonlyArray<JesusFilmChapter> =
  TITLES_AND_STARTS.map(([title, start], i) => ({
    index: i + 1,
    id: chapterId(i + 1),
    title,
    start,
  }))

export const JESUS_FILM_CHAPTER_COUNT = JESUS_FILM_CHAPTERS.length
