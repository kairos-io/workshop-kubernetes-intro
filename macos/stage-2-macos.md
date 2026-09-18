# Stage 2: Build Your Own Immutable OS (MacOS)

This guide walks through building a custom Kairos image using **Podman** on MacOS and pushing it to the **local registry** for ISO creation.

Docs:
  - [The Kairos Factory](https://kairos.io/docs/reference/kairos-factory/)

> [!NOTE]
> This step runs on your Mac, not inside the Kairos VM.

## Prerequisites

Ensure your local registry is running (from [local-infra](local-infra/README.md)):

```bash
cd macos/local-infra
podman-compose ps
# kairos-registry should be running on :5000
```

## Prepare Your Base Image

### 1. Create a Working Directory

```bash
mkdir -p macos/local-infra/custom-image && cd macos/local-infra/custom-image
```

### 2. Create the Dockerfile

Add packages you want in your custom OS. Keep `git` — it's needed for [Stage 6](../stage-6.md).

```bash
cat > Dockerfile <<'EOF'
ARG BASE_IMAGE=ubuntu:22.04

FROM quay.io/kairos/kairos-init:v0.7.0 AS kairos-init

FROM ${BASE_IMAGE} AS base-kairos

# Add your packages here. These are some examples:
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl vim htop git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# "Kairosify" the image
RUN --mount=type=bind,from=kairos-init,src=/kairos-init,dst=/kairos-init \
    /kairos-init --stage install \
      --level debug \
      --model "generic" \
      --trusted "false" \
      --provider k3s \
      --provider-k3s-version "v1.35.0+k3s1" \
      --version "v0.0.1" \
    && \
    /kairos-init --stage init \
      --level debug \
      --model "generic" \
      --trusted "false" \
      --provider k3s \
      --provider-k3s-version "v1.35.0+k3s1" \
      --version "v0.0.1"
EOF
```

### 3. Build the Image

```bash
podman build -t kairos-custom:latest .
```

> [!NOTE]
> This build takes a while as it downloads and installs K3s and the Kairos components. Be patient.

## Push to Local Registry

Instead of pushing to `ttl.sh` (a public temporary registry), we use the local registry from Phase 0.

### 1. Tag for Local Registry

```bash
podman tag localhost/kairos-custom:latest localhost:5000/kairos-custom:latest
```

### 2. Push

```bash
podman push --tls-verify=false localhost:5000/kairos-custom:latest
```

> [!NOTE]
> `--tls-verify=false` is required because the local registry runs over HTTP.

### 3. Verify

```bash
curl http://localhost:5000/v2/_catalog
# Expected: {"repositories":["kairos-custom"]}

curl http://localhost:5000/v2/kairos-custom/tags/list
# Expected: {"name":"kairos-custom","tags":["latest"]}
```

You can also browse the image in the Registry UI at http://localhost:8000.

## Create an ISO Using AuroraBoot

AuroraBoot needs to extract OS files (including root-owned files like `/etc/shadow`), which causes permission issues with bind mounts on MacOS. We use a **named volume** for the build, then extract the ISO in a separate step.

### 1. Create a Build Volume

```bash
podman volume create kairos-build
```

### 2. Push to a temporary public registry

> [!WARNING]
> **Known limitation**: The local registry runs over HTTP. AuroraBoot uses the Go container libraries which default to HTTPS and don't support insecure registries. Podman on MacOS also requires `--tls-verify=false` for HTTP registries since the insecure registry config must be set inside the Podman machine VM, not on the host. Adding HTTPS (self-signed certs) to the local registry solves the Podman issue but not the AuroraBoot one — it would need to be patched to trust custom CAs or allow insecure pulls. Until then, `ttl.sh` is the workaround for ISO builds.

Push the image to [ttl.sh](https://ttl.sh) — a free, anonymous, temporary registry:

```bash
podman tag localhost/kairos-custom:latest ttl.sh/kairos-custom:1h
podman push ttl.sh/kairos-custom:1h
```

> [!NOTE]
> The `:1h` tag means the image expires after 1 hour. Use `:24h` if you need more time.

### 3. Build the ISO

```bash
podman run --privileged -it --rm \
  -v kairos-build:/result \
  quay.io/kairos/auroraboot:latest \
  build-iso --output /result ttl.sh/kairos-custom:1h
```

> [!IMPORTANT]
> `--privileged` is required for AuroraBoot to extract root-owned OS files like `/etc/shadow`.

### 4. Extract the ISO

Copy the ISO from the named volume to the build directory:

```bash
cd macos/local-infra
mkdir -p build

podman run --rm \
  -v kairos-build:/source:ro \
  -v $(pwd)/build:/dest \
  alpine sh -c "cp /source/*.iso /dest/ && ls -lh /dest/"
```

### 5. Verify

```bash
ls -lh macos/local-infra/build/*.iso
```

### 6. Cleanup (optional)

```bash
# Remove the build volume when no longer needed
podman volume rm kairos-build
```

## Run It

Boot a VM with your custom ISO using [`kairos-lab`](../stage-1.md), pointed at the ISO you just built:

```bash
kairos-lab start -new -name custom -iso macos/local-infra/build/*.iso
```

Follow the [Stage 1 installation steps](../stage-1.md#manual-installation) to install Kairos.

After reboot, boot from disk (remove `-cdrom` and `-boot` flags) and verify your custom packages:

```bash
ssh kairos@<VM_IP>

# Check that your custom packages are installed
which vim htop git
```

## Alternative: Using Hadron (Smaller Image)

If you prefer a smaller base image, use [Hadron](https://github.com/kairos-io/hadron) instead of Ubuntu. Hadron has no package manager, resulting in significantly smaller images.

> [!NOTE]
> Since Hadron has no package manager, you cannot install additional packages like `git`. For [Stage 6](../stage-6.md), you'll need the alternative method to deploy the kairos-operator.

```bash
cat > Dockerfile.hadron <<'EOF'
ARG BASE_IMAGE=ghcr.io/kairos-io/hadron:v0.0.1

FROM quay.io/kairos/kairos-init:v0.7.0 AS kairos-init

FROM ${BASE_IMAGE} AS base-kairos

# Example: create a custom file
RUN touch /etc/myfile-exists

# "Kairosify" the image
RUN --mount=type=bind,from=kairos-init,src=/kairos-init,dst=/kairos-init \
    /kairos-init --stage install \
      --level debug \
      --model "generic" \
      --trusted "false" \
      --provider k3s \
      --provider-k3s-version "v1.35.0+k3s1" \
      --version "v0.0.1" \
    && \
    /kairos-init --stage init \
      --level debug \
      --model "generic" \
      --trusted "false" \
      --provider k3s \
      --provider-k3s-version "v1.35.0+k3s1" \
      --version "v0.0.1"
EOF

# Build and push
podman build --progress plain -f Dockerfile.hadron -t kairos-custom-hadron:latest .
podman tag localhost/kairos-custom-hadron:latest localhost:5000/kairos-custom-hadron:latest
podman tag localhost/kairos-custom-hadron:latest ttl.sh/kairos-custom-hadron:1h
podman push --tls-verify=false localhost:5000/kairos-custom-hadron:latest
podman push ttl.sh/kairos-custom-hadron:1h
```

## Troubleshooting

### Push to local registry fails

Check the registry is running:

```bash
curl http://localhost:5000/v2/
# Expected: {}
```

If not, restart the local infrastructure:

```bash
cd macos/local-infra
podman-compose up -d registry
```

### AuroraBoot can't reach local registry

> [!NOTE]
> AuroraBoot doesn't support insecure registries. Use `ttl.sh` as a workaround for ISO builds.

### ISO build fails

Check AuroraBoot logs for details. Common issues:
- Image not found in registry (verify with `curl http://localhost:5000/v2/_catalog`)
- Insufficient disk space
- Architecture mismatch (ensure the base image matches your architecture)

## Next Steps

→ [Stage 3: CI/CD with Gitea + Argo Workflows](stage-3-macos.md)

---

✅ Done! 🎉
