import type { ComponentProps } from "react"
import type Ionicons from "@expo/vector-icons/Ionicons"

import type { UiMessageKey } from "../i18n/useT"
import { TERMS_OF_USE_CANONICAL_URL } from "./terms-of-use"

type MoreKey = UiMessageKey<"More">

export type MyWatchLink = {
  labelKey: MoreKey
  url: string
  /** The RUM tap name, so a label change does not split the series. */
  actionName: string
}

export type MyWatchSocialLink = {
  /** A brand name, the same in every language. */
  label: string
  url: string
  actionName: string
  icon: ComponentProps<typeof Ionicons>["name"]
}

export type MyWatchLinkGroup = {
  id: "support" | "about" | "legal"
  titleKey: MoreKey
  links: readonly MyWatchLink[]
  socials?: readonly MyWatchSocialLink[]
}

// App Store guideline 5.1.1(i): the privacy policy stays reachable in the app.
export const PRIVACY_POLICY_URL = "https://www.jesusfilm.org/privacy/"

export const SOCIAL_LINKS: readonly MyWatchSocialLink[] = [
  {
    label: "X",
    icon: "logo-x",
    url: "https://twitter.com/jesusfilm",
    actionName: "more-social-x",
  },
  {
    label: "Facebook",
    icon: "logo-facebook",
    url: "https://www.facebook.com/jesusfilm",
    actionName: "more-social-facebook",
  },
  {
    label: "Instagram",
    icon: "logo-instagram",
    url: "https://www.instagram.com/jesusfilm",
    actionName: "more-social-instagram",
  },
  {
    label: "YouTube",
    icon: "logo-youtube",
    url: "https://www.youtube.com/user/jesusfilm",
    actionName: "more-social-youtube",
  },
]

export const MY_WATCH_LINK_GROUPS: readonly MyWatchLinkGroup[] = [
  {
    id: "support",
    titleKey: "supportGroup",
    links: [
      {
        labelKey: "give",
        url: "https://www.jesusfilm.org/give/",
        actionName: "more-give",
      },
      {
        labelKey: "contactUs",
        url: "https://www.jesusfilm.org/contact/",
        actionName: "more-contact-us",
      },
    ],
  },
  {
    id: "about",
    titleKey: "aboutGroup",
    links: [
      {
        labelKey: "aboutJesusFilm",
        url: "https://www.jesusfilm.org/about/",
        actionName: "more-about-jesus-film",
      },
      {
        labelKey: "newsletter",
        url: "https://www.jesusfilm.org/email/",
        actionName: "more-newsletter",
      },
    ],
    socials: SOCIAL_LINKS,
  },
  {
    id: "legal",
    titleKey: "legalGroup",
    links: [
      {
        labelKey: "privacyPolicy",
        url: PRIVACY_POLICY_URL,
        actionName: "more-privacy-policy",
      },
      {
        labelKey: "termsOfUse",
        url: TERMS_OF_USE_CANONICAL_URL,
        actionName: "more-terms-of-use",
      },
      {
        labelKey: "legalStatement",
        url: "https://www.jesusfilm.org/legal/",
        actionName: "more-legal-statement",
      },
    ],
  },
]
