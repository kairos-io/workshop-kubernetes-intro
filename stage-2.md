# Stage 2: Build your own immutable OS

Docs:
  - [The Kairos Factory](https://kairos.io/docs/reference/kairos-factory/)

> [!NOTE]
> Stage 1 used a ready-made Hadron ISO. This stage shows you can build a
> Kairos image from a different base distribution too, Ubuntu here, though
> the same approach works for Fedora, openSUSE and others.

> [!TIP]
> You can also build a Hadron image yourself. Keep in mind Hadron has no
> package manager, so adding software works differently. See
> [Extending Hadron with extensions](https://kairos.io/docs/advanced/sys-extensions/)
> for how.

## Prepare your base image

> [!NOTE]
> This step has to be run locally or in your pipeline, not in the Kairos VM.

Let's imagine you have an Ubuntu 24.04 image that installs `curl`, `vim`,
`htop` and `git` (better keep `git` in the package list, that will prove
useful in [stage-6](stage-6.md)):

```Dockerfile
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl vim htop git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
```

Now we can convert that image into a Kairos image, that is, one that
contains everything necessary to produce an immutable, image-based,
bootable artifact. Wow, that was a mouthful. You can just say kairosify it.

```Dockerfile
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl vim htop git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# "Kairosify" the image
RUN --mount=type=bind,from=quay.io/kairos/kairos-init:v4.3.0,src=/kairos-init,dst=/kairos-init \
    /kairos-init --stage install \
      --level debug \
      --provider k3s \
      --provider-k3s-version "v1.36.4+k3s1" \
      --version "v1.0.0" \
    && \
    /kairos-init --stage init \
      --level debug \
      --provider k3s \
      --provider-k3s-version "v1.36.4+k3s1" \
      --version "v1.0.0"
```

```bash
docker build --progress plain -t kairos-custom:latest .
```

## Alternative: Using Podman on MacOS

Restart the Podman machine with rootful access.

```bash
podman machine stop
podman machine set --rootful
podman machine start
```

If you have build the `kairos-custom` Image before, you have to rebuild it after switching to rootful as seen above.

Since Podman has issues using the local image, we will temporarily push it to a public registry.

```bash
podman tag localhost/kairos-custom ttl.sh/kairos-custom:24h
podman push ttl.sh/kairos-custom:24h
```

Then we can use the public images to build the ISO

```bash
mkdir build && sudo podman run -it --rm -v /var/run/docker.sock:/var/run/docker.sock:Z -v $PWD/build:/result quay.io/kairos/auroraboot:latest build-iso --output /result ttl.sh/kairos-custom:24h
```

## Create an ISO using AuroraBoot

```bash
mkdir build && docker run -it --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $PWD/build:/result \
  quay.io/kairos/auroraboot:latest \
  build-iso --output /result kairos-custom:latest
```

If the build is successful, you should find the ISO file in the `$PWD/build` directory.

## Run it

Use the instructions in [stage-1](stage-1.md) to create a VM and run the ISO
you just created.

You should be able to find your modifications when you boot the image.

✅ Done! 🎉
