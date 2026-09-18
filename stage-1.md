# Stage 1: Deploying a single node cluster

Docs:
  - [Manual Single-Node Cluster](https://kairos.io/docs/examples/single-node/)

This stage uses [`kairos-lab`](https://github.com/kairos-io/kairos-lab), a small CLI that downloads a Kairos ISO and boots a VM for you. It works the same way on Linux and macOS, so the rest of this workshop has one set of instructions instead of a platform fork.

## Install kairos-lab

macOS (recommended):

```bash
brew tap kairos-io/kairos
brew install kairos-lab
```

Linux, and macOS without Homebrew: download a binary from the [releases page](https://github.com/kairos-io/kairos-lab/releases), or build from source:

```bash
go build -o kairos-lab ./cmd/kairos-lab
```

> [!NOTE]
> On macOS, the downloaded binary is not signed. Authorize it in System Settings > Privacy & Security after the first run.

## Set up dependencies

```bash
kairos-lab setup
```

Detects your package manager and installs `qemu` if it is missing.

## Download a Kairos ISO

```bash
kairos-lab download
```

Interactive selection of:
- Image type: `core` (base OS) or `standard` (with K3s)
- K3s version (if `standard`)

The ISO is fetched for your architecture and cached; `kairos-lab` tracks it for cleanup later.

> [!IMPORTANT]
> The hadron images are BIOS only. `kairos-lab` boots with BIOS firmware by default, so this only matters if you point it at a UEFI image with `-iso`.

## Create and boot the VM

```bash
kairos-lab start
```

This creates a new disk (named after the ISO plus a timestamp, or pass `-name <name>` to choose one), attaches the ISO, and boots with **bridged networking** — the VM gets a real IP from your network's DHCP server, the same way on Linux and macOS.

- Linux bridged networking needs NetworkManager. If it is not available, add `-network user` for port-forwarded access instead (SSH via `localhost:2222`).
- macOS bridged networking needs `sudo` to reach the vmnet stack; `kairos-lab` asks for it when needed.

**Exit the VM console with `Ctrl-a x`.**

The first thing you will see is the bootloader menu, which will offer different options to install, recover or debug a system. Either select (press enter) or it will be automatically selected after a few seconds.

```
 │*Kairos                                                                     │
 │ Kairos (manual)                                                            │
 │ kairos (interactive install)                                               │
 │ Kairos (remote recovery mode)                                              │
 │ Kairos (boot local node from livecd)                                       │
 │ Kairos (debug)
```

If the system booted correctly, you should see a screen like this:

<img width="554" height="711" alt="Screenshot 2026-01-27 at 20 35 01" src="https://github.com/user-attachments/assets/6e5e0a15-1453-4435-9878-449afd7070a4" />

## Find the VM's IP address

With bridged networking the VM is a normal device on your LAN. Find its address from your host:

```bash
# QEMU's virtual NICs use the 52:54 MAC prefix
arp -a | grep -i "52:54"
```

(works the same on Linux and macOS; give the VM a few seconds after boot to show up)

## Manual Installation

SSH to the VM using the password "kairos" (without the quotes):

```bash
ssh kairos@<VM_IP>
```

Create a basic Kairos config:

```bash
cat > config.yaml <<EOF
#cloud-config
users:
  - name: kairos
    passwd: kairos
    groups:
      - admin

install:
  reboot: true

k3s:
  enabled: true
EOF
```

Install Kairos:

```bash
sudo kairos-agent manual-install config.yaml
```

If the installation was successful the machine should auto-reboot and the menu should look different. The first item is the active image and the default one, that's all you need to know for now. Select it (press enter) or let it auto-select after a few seconds.

```
 │*Kairos                                                                     │
 │ Kairos (fallback)                                                          │
 │ Kairos recovery                                                            │
 │ Kairos state reset (auto)                                                  │
 │ Kairos remote recovery
```

## Boot the installed system

After installation, start the VM again — no ISO needed this time:

```bash
kairos-lab start
```

Select your existing disk when prompted (or pass `-name <name>` / `-no-iso` to skip the prompt) and it boots straight from disk.

## Verify

Find the VM's IP again if it changed, then log in (user: kairos, password: kairos):

```bash
ssh kairos@<VM_IP>
sudo su -i
```

Check that Kubernetes is running (from within the VM):

> [!TIP]
> k3s configuration is located under `/etc/rancher/k3s/k3s.yaml`

```bash
kubectl get nodes
```

You should see an output like this one:

```
NAME          STATUS   ROLES                  AGE     VERSION
kairos-e0a8   Ready    control-plane,master   6m38s   v1.32.10+k3s1
```

### Access the cluster from your host (optional)

Later stages (CI/CD pipelines, the Kairos Operator) are easier to drive from your host than over SSH. Copy the kubeconfig out of the VM:

```bash
scp kairos@<VM_IP>:/etc/rancher/k3s/k3s.yaml ~/.kube/config-kairos
sed -i.bak "s/127.0.0.1/<VM_IP>/" ~/.kube/config-kairos

export KUBECONFIG=~/.kube/config-kairos
kubectl get nodes
```

## Cleanup

```bash
kairos-lab reset
```

Removes the VM's disk. Downloaded ISOs and `kairos-lab` setup stay in place — use `kairos-lab cleanup` to remove everything the tool created.

✅ Done! 🎉
