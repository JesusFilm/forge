import { adminGraphql } from "../../admin"

/** Only valid inside ContainerContentBlock — a sibling marker, not a wrapper. */
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
