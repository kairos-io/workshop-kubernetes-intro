# Stage 1.5: Get AuroraBoot

Docs:
  - [AuroraBoot](https://kairos.io/docs/reference/auroraboot/)

In [stage 2](stage-2.md) you build your own image and turn it into an ISO.
AuroraBoot does that last step. This short stage gets it onto your machine, so
pick the section that matches how you are following the workshop.

## Using kairos-lab

If you followed [stage 1](stage-1.md) with `kairos-lab`, then `kairos-lab setup`
installed the `auroraboot` command for you. Check that it works:

```bash
auroraboot --version
```

If your shell says the command is not found, run `kairos-lab setup` again and
read what it prints at the end. If `~/.local/bin` is not on your `PATH`, it
tells you what to add.

That is all you need. Continue with [stage 2](stage-2.md).

## Using your own virtualization software

Without `kairos-lab` you need the AuroraBoot container image instead. It needs
a container runtime, Docker or Podman.

Wherever the workshop says `auroraboot build-iso ...`, you run the container
instead. The examples below are the command from the end of stage 2.

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

Podman has trouble using a locally built image, so stage 2 has you push your
image to a temporary public registry first (see
[Using Podman on MacOS](stage-2.md#alternative-using-podman-on-macos)). Once
you have done that, run AuroraBoot like this:

```bash
mkdir -p build && sudo podman run -it --rm \
  -v /var/run/docker.sock:/var/run/docker.sock:Z \
  -v $PWD/build:/result \
  quay.io/kairos/auroraboot:latest \
  build-iso --output /result ttl.sh/stage-2:24h
```

You do not need to run these now. You will use them at the end of stage 2.

→ [Stage 2: Build your own immutable OS](stage-2.md)
