/**
 * One shared document per write path, with the names pinned twice: the
 * recommendations `operations.contract.guard.test.js` validates both against
 * admin's committed SDL, and `operationNames.ts` is the fleet-bearer allowlist.
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
