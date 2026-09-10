# Stage 3: Integrating OS builds into your CI/CD pipelines

Docs:
  - [Kairos Factory reusable workflow 🏭](https://github.com/kairos-io/kairos/blob/master/.github/workflows/reusable-factory.yaml) (moved here from the now-archived `kairos-io/kairos-factory-action`)
  - [Example repository](https://github.com/jimmykarily/kairos-wireguard)

## Create a GitHub repository

Go to: https://github.com/new and create a new repository under your account.

Follow the instructions to clone the repository locally.

## Add your Dockerfile

You need a `Dockerfile` at the root of your repository. Use the Dockerfile from [stage-2](stage-2.md#prepare-your-base-image) as a starting point. The workflow references this file at `dockerfile_path: Dockerfile`.

## Create a simple release pipeline

> [!IMPORTANT]
> The `base_image` parameter in the workflow overrides any default set in your Dockerfile's `ARG BASE_IMAGE`. Make sure to set it to match the base image you want to use (e.g., `ubuntu:24.04` or `ghcr.io/kairos-io/hadron:v0.0.1` if using Hadron from [stage-2](stage-2.md#alternative-using-hadron-smaller-image)).

```bash

mkdir -p .github/workflows/

cat > .github/workflows/release.yaml <<EOF
name: Build Kairos Custom Image

on:
  release:
    types: [created]

jobs:
  build:
    permissions:
      id-token: write
      contents: write
      actions: read
      security-events: write
      packages: write
    uses: kairos-io/kairos/.github/workflows/reusable-factory.yaml@master
    with:
      dockerfile_path: Dockerfile
      base_image: ubuntu:24.04
      model: generic
      arch: amd64
      kubernetes_distro: k3s
      kubernetes_version: auto
      version: auto
      trusted_boot: false
      no_cache: false
      iso: true
      raw: false
      vhd: false
      gce: false
      tar: false
      compute_checksums: true
      output_format: auto
      security_checks: ""
      cosign: false
      grype: false
      trivy: false
      grype_sarif: false
      trivy_sarif: false
      custom_tag_format: ${{ github.event.release.tag_name }}
      summary_artifacts: false
      auroraboot_version: latest
      release: true
      list_release_artifacts: false
EOF

# Push the changes
git add .
git commit -m "Add pipeline"
git push origin main
```

## Trigger a build

Go to your repository releases page and create a new release.

Check the build output:

https://github.com/<your_account>/<your_repo>/actions

## Use the artifact

Visit the releases page of your repository and download the built ISO. Then
follow the instructions of [stage-1](stage-1.md) to create a virtual machine for
the this ISO.

✅ Done! 🎉
