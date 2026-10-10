import { admitCalendarProduction } from "./calendar-production"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { StudioCalendarService } from "./calendar"
import { StudioCalendarPublication } from "./calendar-publication"

export async function executeCalendarRpc(
  db: PrismaClient,
  user: Principal,
  action: string,
  input: unknown,
) {
  const calendar = new StudioCalendarService(db)
  switch (action) {
    case "calendar-production":
      return admitCalendarProduction(db, user, input)
    case "calendar-read":
      return calendar.read(user, input)
    case "calendar-configure":
      return calendar.configure(user, input)
    case "calendar-edit-slot":
      return calendar.editSlot(user, input)
    case "calendar-assign-week":
      return calendar.assignWeek(user, input)
    case "calendar-plan-admit":
      return calendar.beginPlanning(user, input)
    case "calendar-authorize":
      return new StudioCalendarPublication(db).authorize(user, input)
    case "calendar-cancel":
      return new StudioCalendarPublication(db).cancel(user, input)
  }
  throw new Error("Unknown calendar command")
}
