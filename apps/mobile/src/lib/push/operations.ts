/**
 * The shared admin documents for the two push write paths. Both live in
 * `@forge/admin-graphql/operations` because admin's own suites pin the same
 * documents, so the app and the server cannot drift on either operation name.
 */
import {
  adminRegisterPushDeviceOperation,
  adminReportPushOpenOperation,
} from "@forge/admin-graphql/operations"

export {
  adminRegisterPushDeviceOperation as REGISTER_PUSH_DEVICE,
  adminReportPushOpenOperation as REPORT_PUSH_OPEN,
}

export { PUSH_OPERATION_NAMES, isPushOperation } from "./operationNames"

/** Every push document mobile sends, keyed by its operation name (for guards). */
export const PUSH_DOCUMENTS = {
  RegisterPushDevice: adminRegisterPushDeviceOperation,
  ReportPushOpen: adminReportPushOpenOperation,
} as const
