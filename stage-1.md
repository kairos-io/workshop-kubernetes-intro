<!-- Generated from stages/kairos-lab.yaml by tools/publish-md.mjs. Do not edit by hand. -->

# Stage 1: Setting up kairos-lab

Docs:
  - [kairos-lab](https://github.com/kairos-io/kairos-lab)
  - [AuroraBoot](https://kairos.io/docs/reference/auroraboot/)

## Before we begin

You'll need virtualization software to run the VMs in this workshop. You're free to use whatever you're comfortable with, but these instructions use [`kairos-lab`](https://github.com/kairos-io/kairos-lab), a small CLI that downloads a Kairos ISO and boots a VM for you, so we don't have to walk through setting up VMs and networking on every possible virtualization stack.

`kairos-lab` only works on Linux and macOS, so you'll need a host machine running one of those. If you know your way around your own virtualization software, you're welcome to use that instead, and should still be able to follow along on Windows, but you're on your own for that part.

## Installing kairos-lab

*Only if you use: kairos-lab.*

> [!CAUTION]
> **If you use Windows:** `kairos-lab` only works on Linux and macOS. On Windows, use your own
> virtualization software instead.

### Homebrew

*Only if you use: macOS.*

```bash
brew tap kairos-io/kairos
brew install kairos-lab
```

### YOLO script from the internet

*Only if you use: Linux.*

```bash
curl -sSL https://raw.githubusercontent.com/kairos-io/kairos-lab/main/install.sh | sh
```

### Build from source

*Only if you use: macOS or Linux.*

```bash
git clone https://github.com/kairos-io/kairos-lab.git && cd kairos-lab
go build -o kairos-lab ./cmd/kairos-lab
```

### Download a release binary

*Only if you use: macOS or Linux.*

Or download the binaries from the [releases page](https://github.com/kairos-io/kairos-lab/releases).

> [!NOTE]
> **If you use macOS:** On macOS, the downloaded binary is not signed. Authorize it in System Settings > Privacy & Security after the first run.

*Check: the `kairos-lab` command is available in a new terminal.*

## Set up dependencies

*Only if you use: kairos-lab.*

> [!NOTE]
> If `kairos-lab setup` installed the container runtime for you, it does not
> start it. On macOS, open Docker Desktop once (or run `podman machine init` and
> `podman machine start`), then run `kairos-lab setup` again to finish.

### Docker

*Only if you use: Docker.*

```bash
kairos-lab setup
```

### Podman

*Only if you use: Podman.*

```bash
kairos-lab setup -runtime podman
```

Detects your package manager and installs `qemu` if it is missing.

It also gets you `auroraboot`, the command you use in [stage 3](stage-3.md) to
turn an image you build into an ISO. For that it needs a container runtime,
Docker or Podman:

- If you already have one, `kairos-lab setup` uses it and installs nothing.
- If you have none, it asks before it installs one. Docker is the default. Run
  `kairos-lab setup -runtime podman` to use Podman instead.
- It pulls the AuroraBoot container image and installs a small `auroraboot`
  command in `~/.local/bin`.

Check that the command works:

```bash
auroraboot --version
```

*Check: the `auroraboot` command is available in a new terminal.*

<details><summary>If it does not work</summary>

If your shell says the command is not found, `~/.local/bin` is not on your
`PATH`. `kairos-lab setup` tells you what to add.

</details>

## Not using kairos-lab? Get AuroraBoot yourself

*Only if you use: your own virtualization software.*

If you are using your own virtualization software, `kairos-lab setup` does not
run for you, so you need to get AuroraBoot yourself. There are two ways:

- Run the AuroraBoot container image. It needs a container runtime, Docker or
  Podman. This works on Linux and on macOS.
- On Linux only, build AuroraBoot locally and run it as a normal command.

Wherever the workshop says `auroraboot build-iso ...`, you either run the
container or use your local build instead. The examples below are the command
from the end of [stage 3](stage-3.md).

### Pull the image

#### Docker

*Only if you use: Docker.*

```bash
docker pull quay.io/kairos/auroraboot:latest
```

#### Podman

*Only if you use: Podman.*

```bash
podman pull quay.io/kairos/auroraboot:latest
```

*Check: the `quay.io/kairos/auroraboot:latest` image is present in your container runtime.*

### Run the container

You do not need to run this now. You will use it at the end of stage 3.

#### Docker

*Only if you use: Docker.*

This is the same as `auroraboot build-iso --output ./build stage-2:v1.0.0`:

```bash
mkdir -p build && docker run -it --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $PWD/build:/result \
  quay.io/kairos/auroraboot:latest \
  build-iso --output /result stage-2:v1.0.0
```

The Docker socket lets AuroraBoot find the image you built locally, and
`$PWD/build` is where the ISO ends up.

#### Podman

*Only if you use: Podman.*

Podman has trouble using a locally built image, so stage 3 has you push your
image to a temporary public registry first (see
[Using Podman on MacOS](stage-3.md#alternative-using-podman-on-macos)). Once
you have done that, run AuroraBoot like this:

```bash
mkdir -p build && sudo podman run -it --rm \
  -v /var/run/docker.sock:/var/run/docker.sock:Z \
  -v $PWD/build:/result \
  quay.io/kairos/auroraboot:latest \
  build-iso --output /result ttl.sh/stage-2:24h
```

## Build it locally (Linux only)

*Only if you use: your own virtualization software.*

Use this if you would rather have a plain `auroraboot` command than run the
container.

> [!WARNING]
> **If you use macOS:** **Do not build AuroraBoot on macOS. Use the container instead.** AuroraBoot is
> built for Linux. To make an ISO it calls Linux tools (`xorriso`, `mtools`,
> `mkfs.fat`, `mksquashfs`), it creates files owned by root, and it expects
> boot files that only exist inside its container image. macOS has none of
> that, so a build made there will not give you a working `auroraboot`. The
> container is a Linux system with everything in place, which is why Docker and
> Podman work on macOS.

*Only if you use: Linux.*

You need:

- Go, at the version in AuroraBoot's [`go.mod`](https://github.com/kairos-io/AuroraBoot/blob/main/go.mod)
  (1.26 at the time of writing).
- Node.js with npm, to build the web UI that is embedded in the binary.
- A C compiler, because one dependency (SQLite) is built with cgo.
- The tools AuroraBoot calls while it builds an ISO: at least `xorriso`,
  `mtools`, `dosfstools` and `squashfs-tools`. The container image installs a
  longer list (see the [`Dockerfile`](https://github.com/kairos-io/AuroraBoot/blob/main/Dockerfile)),
  because it also builds raw disks and UKIs. If a build complains about a
  missing tool, install it.

Build it:

```bash
git clone https://github.com/kairos-io/AuroraBoot.git
cd AuroraBoot
make build
```

`make build` builds the web UI and then the Go binary, `./auroraboot`.

*Only if you use: Linux.*

You do not need to run this now. You will use it at the end of stage 3.

Run it as root, because it changes file ownership to root while it unpacks the
image. This is the same as the container command above:

```bash
sudo ./auroraboot build-iso --output ./build stage-2:v1.0.0
```

The files in `./build` belong to root.

<details><summary>If it does not work</summary>

If the build stops with `could not find any shim file to copy`, the image does
not include a shim. The container carries a fallback for that case and a local
build does not, so use the container for that image.

</details>

→ [Stage 2: Deploying a single node cluster](stage-2.md)
