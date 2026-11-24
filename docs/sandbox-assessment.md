# Test Execution Sandbox Assessment

## Decision

The `workspace.test` tool now executes project-controlled test code inside a constrained Docker container. Approval is still required, but approval is not the isolation boundary; the container restrictions are.

## Implemented controls

- Fixed command: `node --test`; callers cannot provide commands or arguments.
- Pinned Node.js 24 Alpine image digest, preloaded before execution; image pulling is disabled at runtime.
- Docker network disabled.
- Read-only container root filesystem and read-only staged workspace mount.
- Non-root container UID/GID, all Linux capabilities dropped, and no-new-privileges.
- CPU, memory, process-count, wall-clock, and output limits.
- Bounded temporary workspace snapshot. VCS metadata, backups, symlinks, and likely secret/credential files are excluded.
- Docker/image errors fail closed. No unsandboxed host fallback exists.
- Snapshot cleanup runs after every attempt.

## Trust boundary and deployment requirements

The Docker daemon, host kernel, and pinned image remain trusted infrastructure. The production backend must:
- Keep Docker daemon access restricted to the Agent service.
- Provision the pinned image before enabling test execution.
- Avoid mounting Docker sockets, host directories, credentials, or API keys into the test container.
- Monitor daemon availability and resource pressure.
- Validate escape resistance and resource limits on the actual deployment host.

Android browser clients are not expected to provide OS sandbox primitives. Untrusted project execution belongs on the isolated hosted backend when the Android interface is integrated.

## Verification

GitHub Actions includes both ordinary Node.js tests and a real Docker integration job. The integration job pulls the immutable image digest and executes an actual test inside the configured container. This validates the CI runner environment; it does not substitute for validating the eventual production host.

## Residual risks

- The container shares the host kernel and Docker daemon; this is not a virtual machine boundary.
- The current workspace filesystem implementation has a documented narrow parent-directory TOCTOU limitation under hostile concurrent mutation.
- Android device end-to-end verification is deferred to Phase 6.
