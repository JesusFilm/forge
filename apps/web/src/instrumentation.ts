export async function register(): Promise<void> {
  // Production APM is loaded before Next via Railway's NODE_OPTIONS command.
  // Keep this hook light so Next's dev/browser compilers don't bundle dd-trace.
}
