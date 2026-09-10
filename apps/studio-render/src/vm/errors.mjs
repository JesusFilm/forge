/** Local invariant failures quarantine the issued journal; only explicitly
 * unconfirmed transport/recording outcomes permit an automatic retry. */
export class VmInvariantError extends Error {}
export class VmUnconfirmedError extends Error {}
export const isRetryableVmFailure = (error) =>
  error instanceof VmUnconfirmedError
