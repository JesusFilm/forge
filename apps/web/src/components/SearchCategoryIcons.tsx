// MUI-free port of core/libs/shared/ui/src/components/icons/{Bible,
// MessageText1, MediaStrip1, Bulb, UsersProfiles2, Star2}. We keep the
// same path data byte-for-byte so the rendering matches the upstream;
// avoiding @mui/material/utils' createSvgIcon keeps MUI out of the web
// bundle.

import type { ComponentType, SVGProps } from "react"
import type { CategorySearchTerm } from "@/lib/search-categories"

type IconProps = SVGProps<SVGSVGElement>

function makeIcon(d: string, displayName: string): ComponentType<IconProps> {
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        fill="currentColor"
        aria-hidden="true"
        {...props}
      >
        <path fillRule="evenodd" clipRule="evenodd" d={d} />
      </svg>
    )
  }
  Icon.displayName = displayName
  return Icon
}

export const BibleIcon = makeIcon(
  "M5.4 4.4c.2-.3.5-.4.9-.4H18c.6 0 1 .4 1 1v10.5H6.3c-.5 0-.9 0-1.3.3V5.2c0-.3.1-.6.4-.8ZM5 18.7c0 .4.1.7.4 1 .2.2.5.3.9.3h11.5l-.5-.6a1 1 0 0 1 0-1.3l.5-.6H6.3c-.4 0-.7.1-1 .4-.2.2-.3.5-.3.9Zm15.7-1.5-1.4 1.6 1.4 1.5A1 1 0 0 1 20 22H6.3c-.9 0-1.7-.3-2.3-1-.6-.6-1-1.4-1-2.3V5.3c0-1 .4-1.7 1-2.4.6-.6 1.4-.9 2.3-.9H18a3 3 0 0 1 3 3v11.5c0 .3-.1.5-.3.7ZM13 6.4a1 1 0 1 0-2 0v1.2H9.7a1 1 0 1 0 0 2H11v3.5a1 1 0 1 0 2 0V9.6h1.3a1 1 0 1 0 0-2H13V6.4Z",
  "BibleIcon",
)

export const MessageText1Icon = makeIcon(
  "M12 3.4a8.6 8.6 0 1 0 0 17.2c1.53 0 2.965-.399 4.208-1.098a1 1 0 0 1 .733-.098l3.46.865-.607-4.25a1 1 0 0 1 .075-.545A8.568 8.568 0 0 0 20.6 12 8.6 8.6 0 0 0 12 3.4ZM1.4 12C1.4 6.146 6.144 1.4 12 1.4c5.853 0 10.6 4.746 10.6 10.6 0 1.419-.28 2.774-.787 4.013l.778 5.445a1 1 0 0 1-1.233 1.112l-4.527-1.132a10.56 10.56 0 0 1-4.832 1.162C6.145 22.6 1.4 17.855 1.4 12Zm6-3.6a1 1 0 0 1 1-1h7.2a1 1 0 1 1 0 2H8.4a1 1 0 0 1-1-1Zm0 4.8a1 1 0 0 1 1-1h4.2a1 1 0 1 1 0 2H8.4a1 1 0 0 1-1-1Z",
  "MessageText1Icon",
)

export const MediaStrip1Icon = makeIcon(
  "M18 1.4c2.5 0 4.6 2 4.6 4.6v12c0 2.5-2 4.6-4.6 4.6H6c-2.5 0-4.6-2-4.6-4.6V6c0-2.5 2-4.6 4.6-4.6h12Zm-2.2 2H13v2.8h2.8V3.4Zm2 2.8V3.4h.2c1.4 0 2.6 1.2 2.6 2.6v.2h-2.8Zm-4.8 2v7.6h7.6V8.2H13Zm7.6 9.6h-2.8v2.8h.2c1.4 0 2.6-1.2 2.6-2.6v-.2Zm-4.8 2.8v-2.8H13v2.8h2.8Zm-4.8 0v-2.8H8.2v2.8H11Zm-4.8 0v-2.8H3.4v.2c0 1.4 1.2 2.6 2.6 2.6h.2Zm-2.8-4.8H11V8.2H3.4v7.6Zm0-9.6h2.8V3.4H6A2.6 2.6 0 0 0 3.4 6v.2Zm4.8-2.8v2.8H11V3.4H8.2Z",
  "MediaStrip1Icon",
)

export const BulbIcon = makeIcon(
  "M12 3.40039C9.23858 3.40039 7 5.63897 7 8.40039C7 10.4492 8.23238 12.2123 10.0004 12.9848C10.3646 13.1439 10.6 13.5037 10.6 13.9011V17.4004C10.6 17.5108 10.6895 17.6004 10.8 17.6004H13.2C13.3105 17.6004 13.4 17.5108 13.4 17.4004V13.8004C13.4 13.4029 13.6354 13.0432 13.9996 12.884C15.7862 12.1034 17 10.4298 17 8.40039C17 5.63897 14.7614 3.40039 12 3.40039ZM5 8.40039C5 4.5344 8.13401 1.40039 12 1.40039C15.866 1.40039 19 4.5344 19 8.40039C19 11.05 17.5321 13.2482 15.4 14.4216V17.4004C15.4 18.6154 14.415 19.6004 13.2 19.6004H10.8C9.58497 19.6004 8.6 18.6154 8.6 17.4004V14.5204C6.45408 13.3258 5 11.0338 5 8.40039ZM8.6 21.6004C8.6 21.0481 9.04772 20.6004 9.6 20.6004H14.4C14.9523 20.6004 15.4 21.0481 15.4 21.6004C15.4 22.1527 14.9523 22.6004 14.4 22.6004H9.6C9.04772 22.6004 8.6 22.1527 8.6 21.6004Z",
  "BulbIcon",
)

export const UsersProfiles2Icon = makeIcon(
  "M9.714 5.686a1.743 1.743 0 1 0 0 3.485 1.743 1.743 0 0 0 0-3.485ZM5.971 7.428a3.743 3.743 0 1 1 7.486 0 3.743 3.743 0 0 1-7.486 0Zm8.763-2.876a1 1 0 0 1 1.367-.365 3.742 3.742 0 0 1 0 6.483 1 1 0 1 1-1.002-1.731 1.742 1.742 0 0 0 0-3.02 1 1 0 0 1-.365-1.367Zm-11.132 9.46c1.442-1.118 3.51-1.735 6.112-1.735 2.603 0 4.67.617 6.112 1.735 1.464 1.136 2.203 2.732 2.203 4.473 0 .909-.686 1.83-1.746 1.83H3.146c-1.06 0-1.746-.921-1.746-1.83 0-1.74.739-3.337 2.202-4.473Zm-.198 4.302h12.621c-.045-1.065-.508-2.01-1.425-2.722-.988-.766-2.577-1.315-4.886-1.315-2.308 0-3.898.549-4.885 1.316-.917.711-1.38 1.656-1.425 2.721Zm14.995-5.227a1 1 0 0 1 1.4-.203c.81.605 1.496 1.593 1.974 2.564.477.971.827 2.092.827 3.037 0 .909-.685 1.83-1.746 1.83H20.4a1 1 0 1 1 0-2h.193c-.04-.52-.252-1.245-.615-1.984-.405-.824-.919-1.502-1.377-1.844a1 1 0 0 1-.202-1.4Z",
  "UsersProfiles2Icon",
)

export const Star2Icon = makeIcon(
  "M10.598 2.272c.574-1.162 2.23-1.162 2.804 0l2.572 5.212 5.752.836c1.282.186 1.794 1.762.866 2.666l-4.162 4.057.983 5.729c.219 1.277-1.122 2.25-2.268 1.648L12 19.715 6.855 22.42c-1.147.602-2.487-.371-2.268-1.648l.983-5.729-4.162-4.057c-.928-.904-.416-2.48.866-2.666l5.752-.836 2.572-5.212ZM12 3.95 9.718 8.575a1.563 1.563 0 0 1-1.177.855l-5.104.742 3.693 3.6c.369.358.537.876.45 1.383l-.872 5.082 4.565-2.4c.455-.239.999-.239 1.454 0l4.565 2.4-.872-5.082a1.563 1.563 0 0 1 .45-1.384l3.692-3.6-5.103-.74a1.563 1.563 0 0 1-1.177-.856L12 3.951Z",
  "Star2Icon",
)

// Keyed by `searchTerm` (the stable category identifier) and constrained
// to the literal union so adding a category to CATEGORIES without a
// matching icon entry becomes a compile error.
export const CATEGORY_ICON_BY_SEARCH_TERM: Record<
  CategorySearchTerm,
  ComponentType<IconProps>
> = {
  "bible stories": BibleIcon,
  parables: MessageText1Icon,
  animated: MediaStrip1Icon,
  study: BulbIcon,
  family: UsersProfiles2Icon,
  christmas: Star2Icon,
}
