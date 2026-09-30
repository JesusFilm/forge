import { adminGraphql } from "../index"

/**
 * The two push write documents. Their operation names are a contract: the
 * mobile app's fleet-bearer allowlist keys on `RegisterPushDevice` and
 * `ReportPushOpen`, so renaming either one silences that surface.
 */
export const adminRegisterPushDeviceMutation = `
  mutation RegisterPushDevice($input: RegisterPushDeviceInput!) {
    registerPushDevice(input: $input) {
      testDeviceId
      status
    }
  }
` as const

export const adminRegisterPushDeviceOperation = adminGraphql(
  adminRegisterPushDeviceMutation,
)

export const adminReportPushOpenMutation = `
  mutation ReportPushOpen($input: ReportPushOpenInput!) {
    reportPushOpen(input: $input) {
      outcome
    }
  }
` as const

export const adminReportPushOpenOperation = adminGraphql(
  adminReportPushOpenMutation,
)
