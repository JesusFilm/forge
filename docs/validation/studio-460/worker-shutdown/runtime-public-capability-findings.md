# Public runtime capability findings — read-only

Checked Railway public config reference, start-command, pre-deploy and Node signal troubleshooting pages on2026-09-08. Retained fetched markdown in evidence. No account API/CLI, support message, deployment or exposure experiment.

https://docs.railway.com/config-as-code/reference documents startCommand and preDeployCommand; no proc-mask override, capabilities, OCI prestart or mount-namespace bootstrap field was located in that reference. This bounded public-doc search does not establish that unsupported/private capabilities cannot exist.

https://docs.railway.com/deployments/start-command says Dockerfile/image custom start overrides ENTRYPOINT. That is application command selection, not evidence of pre-mask OCI setup. https://docs.railway.com/deployments/pre-deploy-command explicitly uses a separate container with no persisted filesystem changes and no volumes; excluded as bootstrap.

https://docs.railway.com/deployments/troubleshooting/nodejs-sigterm-handling discusses package-manager signal interception and direct Node startup. Our exact worker already starts Node directly, so that documented workaround does not diagnose or fix its observed PID1 default-handler issue.

No supported intended-platform hook satisfying the required trusted pre-mask ordering was found. The prepared runtime-capability-proposal.md remains the smallest concrete question: can platform runtime set up private job proc and full masks before untrusted code without broad host authority or exposing parentproc? Need documented support/configuration evidence, or separately approved alternative-runner design; fail-closed remains interim, not completion.
