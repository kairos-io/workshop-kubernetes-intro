# Stage 1: Deploying a single node cluster

Docs:
  - [Manual Single-Node Cluster](https://kairos.io/docs/examples/single-node/)

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

## Hadron and K3s

The ISO you download next bundles two choices worth knowing about.

**Hadron** is the Linux distribution underneath. It's a minimal system built from scratch by the Kairos team out of vanilla upstream components, so there's little in the image beyond what it needs to boot and run containers.

**K3s** is the Kubernetes distribution on top. It's lightweight, fully conformant, and ships as a single binary, which suits a laptop VM and an edge node equally well.

We make both choices for you in this stage so that everyone starts from the same place. Neither is a requirement of Kairos. It can also take an existing distribution such as Ubuntu, Fedora or openSUSE and turn it into an immutable, image-based system with the same upgrade and rollback behaviour. You'll do exactly that in [stage 2](stage-2.md).

## Download a Kairos ISO

```bash
kairos-lab download
```

For this lab we'll be using the `standard` image, which includes `K3s`.

```
No ISO specified. Fetching latest Kairos releases...

Kairos v4.3.0 - Select image type:
  [1] core     - Base OS only (no Kubernetes)
  [2] standard - Includes K3s Kubernetes
Choice [1-2]: 2

Select K3s version:
  [1] k3sv1.36.4+k3s1 (latest)
  [2] k3sv1.35.8+k3s1
  [3] k3sv1.34.11+k3s1
Choice [1-3]: 1
```

The ISO is fetched for your architecture and cached; `kairos-lab` tracks it for cleanup later.

> [!IMPORTANT]
> The hadron images are BIOS only. `kairos-lab` boots with BIOS firmware by default, so this only matters if you point it at a UEFI image with `-iso`.

> [!TIP]
> You can also download the ISO yourself from the [Kairos releases page](https://github.com/kairos-io/kairos/releases) and pass it to `kairos-lab` with `-iso <path>` instead of the interactive picker above.

## Create and boot the VM

```bash
kairos-lab start
```

This creates a new disk, go ahead and give it a name like `kairos-stage1`:

```
❯ /tmp/claude/kairos-lab-main/kairos-lab start
Using the only downloaded ISO: kairos-hadron-v0.5.1-standard-arm64-generic-v4.3.0-k3sv1.36.4+k3s1.iso

Suggested disk name: kairos-hadron-v0.5.1-standard-arm64-generic-v4.3.0-k3sv1.36.4+k3s1-20260929-111913
Press Enter to accept, or type a new name: kairos-stage1
```

If you have enough resources go with the pre-selected options, if not, then you can reduce the disk size or memory. Hadron uses very small resources, these values were just assigned as a "safe" option.

> [!WARNING]
> The one option you should not change for this workshop is "Network: shared". If you do, keep in mind that you are in charge of how to access the machine via IP, reverse tunnel or any other mechanism you can setup.

```
VM Configuration:
  1) Disk name:    kairos-stage1
  2) Disk path:    /Users/mauro/Library/Caches/kairos-lab/vm/kairos-stage1.qcow2
  3) Disk size:    60 GB  (131 GB free)
  4) ISO:          kairos-hadron-v0.5.1-standard-arm64-generic-v4.3.0-k3sv1.36.4+k3s1.iso
  5) Memory:       8 GB  (24 GB available)
  6) CPUs:         2  (12 logical CPUs on host)
  7) Network:      shared
  8) Net interface: (n/a)
  9) Display:      window

Press Enter to continue, or enter a number to edit:
```

Hit Enter to continue

> [!IMPORTANT]
> At any point you can exit the console and kill the machine with `Ctrl-a x`

Network setup requires `sudo` permissions, so make sure to say `y` in this section

```
[1/3] Preparing networking
shared vmnet mode runs qemu with sudo [y/N]: y
```

You will be prompted for your password and you can see exactly the command that kairos-lab is about to run.

The first thing you will see is the bootloader menu, which will offer different options to install, recover or debug a system. Either select (press enter) or it will be automatically selected after a few seconds.

```
 │*Kairos                                                                     │
 │ Kairos (manual)                                                            │
 │ kairos (interactive install)                                               │
 │ Kairos (remote recovery mode)                                              │
 │ Kairos (boot local node from livecd)                                       │
 │ Kairos (debug)
```

If the system booted correctly, you should see a login like the following. Go ahead and enter kairos as the user and password:

```
kairos-525c login: kairos
Password:
Welcome to Kairos!

Refer to https://kairos.io for documentation.
[kairos@kairos-525c ~]$
```

Now you should be able to determine the IP of the machine using `ip a`.

If you enabled graphical mode (as it is by default) you should also see a QR code, and the IP of the machine at the bottom of it.

## Installing Kairos

To install kairos in your system you have a bunch of options, we are going to use the manual installation for this stage and introduce you to other options in further stages.

## Manual Installation

In the console we logged in from the previous step, run the following command:

> [!INFO]
> If you prefer so, you can also ssh into the machine with the IP we recently saw via the command `ssh kairos@IP` where you will have to log in again.

Here's the right moment to introduce Kairos' Cloud Configuration Files.

> [!WARNING]
> Kairos' Cloud Configuration Files look like Cloud Init files, but they are not. They can modify the system much earlier than cloud init, solving the problem of how to modify a configuration during an early dracut stage. If you want to learn more about them go ahead and check https://github.com/mudler/yip

Start by creating a basic Kairos config:

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

What this config does beyond the obvious:

- The header is important, do not skip it otherwise your config file will be ignored
- A Kairos system doesn't require you to have users. But if you plan to have them, at least one of them needs to be in the "admin" group

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

> [!WARNING]
> If you did this through SSH, you need to reconnect. In the process your system might give you a warning because the machine doesn't have the same known host fingerprint. This is expected because the installed system is not the same as the LiveCD one.

> [!WARNING]
> If you turned off the machine, you can start it again with the following command `kairos-lab start -name kairos-stage1`

## Check K3s is running

Using `kubectl` out of the box requires `sudo` permissions

```bash
sudo su -i
```

Then run the following to confirm Kubernetes is running:

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

Later stages (CI/CD pipelines, the Kairos Operator) are easier to drive from your host than over SSH. The kubeconfig is only readable by root, so copy it to somewhere `kairos` can read first:

```bash
ssh kairos@<VM_IP>
sudo cp /etc/rancher/k3s/k3s.yaml ~/k3s.yaml
sudo chown kairos:kairos ~/k3s.yaml
exit
```

Then pull it to your host:

```bash
scp kairos@<VM_IP>:~/k3s.yaml ~/.kube/config-kairos
sed -i.bak "s/127.0.0.1/<VM_IP>/" ~/.kube/config-kairos

export KUBECONFIG=~/.kube/config-kairos
kubectl get nodes
```

## Cleanup

The ISO you downloaded and the VM you created will be useful for future stages. If you don't want to download the ISO again or reinstall Kairos, you can leave them as they are and continue.

If you want to clean up everything from this stage, run:

```bash
kairos-lab reset
```

This removes the VM's disk, but keeps the downloaded ISO and `kairos-lab` setup so you can reuse them in later stages.

If you want to remove everything, including the ISO and `kairos-lab` itself, before uninstalling it completely, run:

```bash
kairos-lab cleanup
```

✅ Done! 🎉
