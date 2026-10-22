# Stage 5: Upgrading your cluster manually

Docs:
  - [Manual Upgrade](https://kairos.io/docs/upgrade/manual/)
  - [A/B Upgrades](https://kairos.io/docs/architecture/container/#ab-upgrades)

## Overview

Kairos uses an A/B partition scheme for atomic, immutable upgrades:

- **Active partition**: currently running OS
- **Passive partition**: target for the upgrade

When you upgrade, the new image is written to the passive partition. After reboot, the two partitions swap roles. If the upgrade fails, you can boot back to the previous (now passive) partition.

## Prerequisites

- A Kairos VM running (from [Stage 2](stage-2.md))
- SSH access to the VM

## Check the current version

SSH into your VM (see [Create and boot the VM](stage-2.md#create-and-boot-the-vm) to find its IP address if needed):

```bash
ssh kairos@<VM_IP>

# Check current Kairos version
cat /etc/kairos-release | grep -E "KAIROS_VERSION|KAIROS_FLAVOR|KAIROS_SOFTWARE_VERSION"
```

Example output:
```
KAIROS_FLAVOR="hadron"
KAIROS_FLAVOR_RELEASE="v0.5.1"
KAIROS_SOFTWARE_VERSION="v1.35.8+k3s1"
KAIROS_SOFTWARE_VERSION_PREFIX="k3s"
KAIROS_VERSION="v4.3.0"
```

## Choose an upgrade source

### Option 1: A Kairos official image

List available upgrade images directly from the VM:

```bash
sudo kairos-agent upgrade list-releases
```

Example output, from an amd64 node that runs an older K3s version than the latest image (on an arm64 node the image names say `arm64`):
```
Using registry: quay.io/kairos
Current image:
quay.io/kairos/hadron:v0.5.1-standard-amd64-generic-v4.3.0-k3sv1.35.8-k3s1

Available releases with higher version:
...
```

If the node already runs the newest release, the command prints `No newer releases found`. Pick the image tag by hand then, as in the next section.

Browse all images at: https://quay.io/organization/kairos

### Option 2: Your custom image from Stage 3/4

If you built a custom image in [Stage 3](stage-3.md) and pushed it via [Stage 4](stage-4.md)'s pipeline, use that image reference, e.g. `ttl.sh/stage-3:24h`.

> **Note:** because of the "all or nothing" nature of Kairos upgrades, an upgrade is just a full OS replacement — so it can as well be a downgrade to an older image.

## Perform the upgrade

### 1. SSH into the VM

```bash
ssh kairos@<VM_IP>
```

### 2. Run the upgrade

```bash
# Upgrade to a Kairos official image (example)
sudo kairos-agent upgrade --source oci:quay.io/kairos/hadron:v0.5.1-standard-arm64-generic-v4.3.0-k3s-v1.36.4-k3s1

# Or upgrade to your custom image
sudo kairos-agent upgrade --source oci:ttl.sh/stage-3:24h
sudo reboot
```

The upgrade process will:
1. Pull the new container image
2. Extract it to the passive partition
3. Update the bootloader

> [!NOTE]
> The SSH connection will drop during reboot. Wait ~1 minute before reconnecting.

### 3. Verify the upgrade

```bash
# Reconnect (wait ~1 minute for the VM to reboot)
ssh kairos@<VM_IP>

# Check the new version
cat /etc/kairos-release | grep -E "KAIROS_VERSION|KAIROS_FLAVOR|KAIROS_SOFTWARE_VERSION"

# Verify K3s is running
sudo kubectl get nodes
```

## Rollback (if needed)

If the upgrade causes issues, you can boot back to the previous version:

### Option 1: GRUB menu

1. Reboot the VM
2. At the GRUB menu, select **"Kairos (fallback)"**
3. This boots the previous (passive) partition

This demonstrates the A/B partition scheme:

| Partition | After Upgrade | After Fallback |
|-----------|---------------|-----------------|
| **Active** | new version | old version |
| **Passive** | old version | new version |

### Option 2: From the command line

```bash
# Check current boot entry
sudo grub-editenv /oem/grubenv list

# Set to boot from fallback
sudo grub-editenv /oem/grubenv set next_entry=fallback

sudo reboot
```

## Upgrade considerations

### Kubernetes version compatibility

- **Minor version jumps** (e.g., 1.30 → 1.31): usually safe
- **Major version downgrades**: may cause issues with cluster state
- **Same K8s version, different Kairos release**: safe

### Preserving data

Kairos preserves data in:
- `/usr/local/` — persisted across upgrades
- `/oem/` — OEM configuration
- `/var/lib/rancher/` — K3s data (etcd, etc.)

### Upgrade vs fresh install

| Upgrade | Fresh Install |
|---------|----------------|
| Preserves K3s cluster state | Starts fresh |
| Keeps `/usr/local/` data | Clean slate |
| A/B partition swap | Wipes disk |

## Troubleshooting

### Upgrade fails to pull image

Check DNS is working in the VM:

```bash
curl -I https://quay.io
```

### Node not rejoining cluster after upgrade

```bash
sudo journalctl -u k3s -f
```

Common causes: K3s version mismatch (major downgrade), network connectivity.

### Boot stuck after upgrade

1. At the GRUB menu, select **"Kairos (fallback)"**
2. Once booted, check logs:
   ```bash
   sudo journalctl -b -1  # Previous boot logs
   ```

## Next Steps

→ [Stage 6: Multi-node Cluster](stage-6.md)

---

✅ Done! 🎉
