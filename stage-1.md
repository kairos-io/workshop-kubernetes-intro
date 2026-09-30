# Stage 1: Setting up kairos-lab

Docs:
  - [kairos-lab](https://github.com/kairos-io/kairos-lab)
  - [AuroraBoot](https://kairos.io/docs/reference/auroraboot/)

## Before we begin

You'll need virtualization software to run the VMs in this workshop. You're free to use whatever you're comfortable with, but these instructions use [`kairos-lab`](https://github.com/kairos-io/kairos-lab), a small CLI that downloads a Kairos ISO and boots a VM for you, so we don't have to walk through setting up VMs and networking on every possible virtualization stack.

`kairos-lab` only works on Linux and macOS, so you'll need a host machine running one of those. If you know your way around your own virtualization software, you're welcome to use that instead, and should still be able to follow along on Windows, but you're on your own for that part.

## Installing kairos-lab

### Homebrew (macOS only)

```bash
brew tap kairos-io/kairos
brew install kairos-lab
```

### YOLO script from the internet (Linux only)

```bash
curl -sSL https://raw.githubusercontent.com/kairos-io/kairos-lab/main/install.sh | sh
```

### Build from source (MacOS or Linux)

```bash
git clone https://github.com/kairos-io/kairos-lab.git && cd kairos-lab
go build -o kairos-lab ./cmd/kairos-lab
```

### Or download the binaries from the [releases page](https://github.com/kairos-io/kairos-lab/releases) (MacOS or Linux)

> [!NOTE]
> On macOS, the downloaded binary is not signed. Authorize it in System Settings > Privacy & Security after the first run.

## Set up dependencies

```bash
kairos-lab setup
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

> [!NOTE]
> If `kairos-lab setup` installed the container runtime for you, it does not
> start it. On macOS, open Docker Desktop once (or run `podman machine init` and
> `podman machine start`), then run `kairos-lab setup` again to finish.

Check that the command works:

```bash
auroraboot --version
```

If your shell says the command is not found, `~/.local/bin` is not on your
`PATH`. `kairos-lab setup` tells you what to add.

## Not using kairos-lab? Get AuroraBoot yourself

If you are using your own virtualization software, `kairos-lab setup` does not
run for you, so you need the AuroraBoot container image instead. It needs a
container runtime, Docker or Podman.

Wherever the workshop says `auroraboot build-iso ...`, you run the container
instead. The examples below are the command from the end of
[stage 3](stage-3.md).

### Docker

Pull the image:

```bash
docker pull quay.io/kairos/auroraboot:latest
```

Then run it. This is the same as `auroraboot build-iso --output ./build stage-2:v1.0.0`:

```bash
mkdir -p build && docker run -it --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $PWD/build:/result \
  quay.io/kairos/auroraboot:latest \
  build-iso --output /result stage-2:v1.0.0
```

The Docker socket lets AuroraBoot find the image you built locally, and
`$PWD/build` is where the ISO ends up.

### Podman

Pull the image:

```bash
podman pull quay.io/kairos/auroraboot:latest
```

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

You do not need to run these now. You will use them at the end of stage 3.

→ [Stage 2: Deploying a single node cluster](stage-2.md)
