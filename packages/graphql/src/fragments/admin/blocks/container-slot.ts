import { adminGraphql } from "../../../admin"

/**
 * Admin's flat container shape uses `containerSlot` markers as siblings
 * inside `container.content[]` — there is no nested-slot wrapper like
 * Strapi's `slots[].content[]`. This fragment is only valid inside the
 * ContainerContentBlock union.
 */
export const adminContainerSlotFragment = adminGraphql(`
  fragment AdminContainerSlot on ContainerSlotBlock @_unmask {
    __typename
    t
    gridSpan
    spans {
      xs
      sm
      md
      lg
      xl
    }
    backgroundColor
    backgroundImageUrl
    backgroundImageAssetId
  }
`)
