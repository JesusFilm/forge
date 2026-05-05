"use client"

import type { ComponentProps } from "react"
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import {
  MEDIA_LIBRARY_DND_ID,
  mediaLibraryCollisionDetection,
} from "@/app/dashboard/media/media-library-dnd"

type DndContextChildren = ComponentProps<typeof DndContext>["children"]

export function MediaLibraryDndProvider({
  children,
}: {
  children: DndContextChildren
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  )

  return (
    <DndContext
      id={MEDIA_LIBRARY_DND_ID}
      sensors={sensors}
      collisionDetection={mediaLibraryCollisionDetection}
    >
      {children}
    </DndContext>
  )
}
