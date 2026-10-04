import type { ComponentProps } from "react"
import type Ionicons from "@expo/vector-icons/Ionicons"
import type { Href } from "expo-router"

import { TERMS_OF_USE_CANONICAL_URL } from "./terms-of-use"

export type MyWatchLink = {
  label: string
  url: string
  /** The RUM tap name, so a label change does not split the series. */
  actionName: string
}

export type MyWatchSocialLink = MyWatchLink & {
  icon: ComponentProps<typeof Ionicons>["name"]
}

/** A row that opens a screen inside the app instead of the browser. */
export type MyWatchRouteLink = {
  label: string
  route: Href
  hint: string
  actionName: string
}

export type MyWatchGroupRow = MyWatchLink | MyWatchRouteLink

export type MyWatchLinkGroup = {
  id: "support" | "about" | "legal"
  title: string
  links: readonly MyWatchGroupRow[]
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
    title: "Support",
    links: [
      {
        label: "Send Feedback",
        route: "/feedback",
        hint: "Opens the feedback form",
        actionName: "more-send-feedback",
      },
      {
        label: "Contact Jesus Film Project",
        url: "https://www.jesusfilm.org/contact/",
        actionName: "more-contact-us",
      },
    ],
  },
  {
    id: "about",
    title: "About",
    links: [
      {
        label: "About Jesus Film",
        url: "https://www.jesusfilm.org/about/",
        actionName: "more-about-jesus-film",
      },
      {
        label: "Newsletter",
        url: "https://www.jesusfilm.org/email/",
        actionName: "more-newsletter",
      },
      {
        label: "Give",
        url: "https://www.jesusfilm.org/give/",
        actionName: "more-give",
      },
    ],
    socials: SOCIAL_LINKS,
  },
  {
    id: "legal",
    title: "Legal",
    links: [
      {
        label: "Privacy Policy",
        url: PRIVACY_POLICY_URL,
        actionName: "more-privacy-policy",
      },
      {
        label: "Terms of Use",
        url: TERMS_OF_USE_CANONICAL_URL,
        actionName: "more-terms-of-use",
      },
      {
        label: "Legal Statement",
        url: "https://www.jesusfilm.org/legal/",
        actionName: "more-legal-statement",
      },
    ],
  },
]
