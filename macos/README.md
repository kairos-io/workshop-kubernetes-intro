# Kairos Workshop - MacOS Track

Stages 1, 4, 5, and 6 of the workshop now use [`kairos-lab`](https://github.com/kairos-io/kairos-lab), which handles VM creation the same way on Linux and macOS — see the root [stage-1.md](../stage-1.md), [stage-4.md](../stage-4.md), [stage-5.md](../stage-5.md), and [stage-6.md](../stage-6.md). There is no separate macOS version of those stages any more.

This folder covers the two stages `kairos-lab` doesn't reach, because they are about container tooling and CI infrastructure, not VM lifecycle: building a custom image (Stage 2) and wiring up a CI/CD pipeline (Stage 3). On macOS those use **Podman** instead of Docker, and a local **Gitea + Argo Workflows** pipeline instead of GitHub Actions, so they keep their own instructions here.

## Why a MacOS Track for These Two Stages?

| Stage | Original (Linux) | MacOS |
|-------|-------------------|-------|
| 2 — Build custom OS | Docker | **Podman** (rootful mode) + **local registry** (localhost:5000) |
| 3 — CI/CD | GitHub Actions | **Gitea** + **Argo Workflows**, running in your Kairos K3s cluster |

## Prerequisites

Install the following on your Mac:

```bash
# Podman (container runtime)
brew install podman
podman machine init
podman machine start

# Podman Compose (for local infrastructure)
brew install podman-compose
```

(QEMU is installed by `kairos-lab setup` when you work through [Stage 1](../stage-1.md).)

## Workshop Structure

### Phase 0: Local Infrastructure
Set up local Gitea and Registry services.

→ [local-infra/README.md](local-infra/README.md)

### Stage 2: Build Your Own Immutable OS (MacOS)
Build custom Kairos images using Podman and push to the local registry.

→ [stage-2-macos.md](stage-2-macos.md)

### Stage 3: CI/CD with Gitea + Argo Workflows
Replace GitHub Actions with a local GitOps pipeline.

→ [stage-3-macos.md](stage-3-macos.md) *(coming soon)*

## Quick Start

```bash
# 1. Start local infrastructure (Gitea + Registry)
cd macos/local-infra
podman-compose up -d

# 2. Verify services
open http://localhost:3000   # Gitea
open http://localhost:8000   # Registry UI

# 3. Do Stage 1 (root of the repo) to get a Kairos VM, then come back here for Stage 2
```

See the root [stage-1.md](../stage-1.md) for VM setup — it's the same on macOS and Linux.
