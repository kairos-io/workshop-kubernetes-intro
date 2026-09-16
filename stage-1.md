# Stage 1: Deploying a single node cluster

Docs:
  - [Manual Single-Node Cluster](https://kairos.io/docs/examples/single-node/)

## Get a pre-built ISO

aarch64:
  - [kairos-hadron-0.0.1-standard-arm64-generic-v3.7.1-k3sv1.35.0+k3s1.iso](https://github.com/kairos-io/kairos/releases/download/v3.7.1/kairos-hadron-0.0.1-standard-arm64-generic-v3.7.1-k3sv1.35.0+k3s1.iso) (357M)
  - [kairos-fedora-40-standard-arm64-generic-v3.7.1-k3sv1.35.0+k3s1.iso](https://github.com/kairos-io/kairos/releases/download/v3.7.1/kairos-fedora-40-standard-arm64-generic-v3.7.1-k3sv1.35.0+k3s1.iso) (514M)

amd64:
  - [kairos-hadron-0.0.1-standard-amd64-generic-v3.7.1-k3sv1.35.0+k3s1.iso](https://github.com/kairos-io/kairos/releases/download/v3.7.1/kairos-hadron-0.0.1-standard-amd64-generic-v3.7.1-k3sv1.35.0+k3s1.iso) (380M)
  - [kairos-fedora-40-standard-amd64-generic-v3.7.1-k3sv1.35.0+k3s1.iso](https://github.com/kairos-io/kairos/releases/download/v3.7.1/kairos-fedora-40-standard-amd64-generic-v3.7.1-k3sv1.35.0+k3s1.iso) (535M)

## Create a Virtual Machine

> [!IMPORTANT]
> The hadron images used here are BIOS only. When creating the VM, make sure the firmware is set to BIOS and not to UEFI. If you want to use UEFI images, check out hadron Trusted Boot

Options:

1. qemu/libvirt
2. VirtualBox
3. Host Proxmox locally?
4. Public cloud provider

## Quickest path to success:

> [!NOTE]
> In order to run the following scripts `qemu` and `qemu-img` must be installed. 

> [!IMPORTANT]
> On MacOS/UTM you have to select the default virtio-gpu-pci Display. When booting, edit the Grub config and remove the `nomodeset` option. Then it shold boot fine. 

> [!WARNING]
> When running this script, you get initiated in a serial console. Services like the interactive installer only run on the graphical console, so even if you select it, you will land on a new terminal and not the installer. If this is the case, just follow the manual installion instructions below.

Create a disk and boot a VM with the disk and iso attached:

```bash
# Create a disk image
qemu-img create -f qcow2 kairos.img 60g

# Start the VM (assuming ISO is named "kairos.iso")
qemu-system-x86_64 \
    -enable-kvm \
    -cpu host \
    -nographic \
    -serial mon:stdio \
    -m 4096 \
    -smp 2 \
    -rtc base=utc,clock=rt \
    -chardev socket,path=/tmp/kairos.sock,server=on,wait=off,id=qga0 \
    -device virtio-serial \
    -device virtserialport,chardev=qga0,name=org.qemu.guest_agent.0 \
    -netdev user,id=net0,hostfwd=tcp::2222-:22,hostfwd=tcp::8080-:8080 \
    -device virtio-net-pci,netdev=net0 \
    -drive id=disk1,if=none,media=disk,file="kairos.img" \
    -device virtio-blk-pci,drive=disk1,bootindex=0 \
    -drive id=cdrom1,if=none,media=cdrom,file="kairos.iso" \
    -device ide-cd,drive=cdrom1,bootindex=1 \
    -boot menu=on

# To exit: CTRL^A -> x
# To cleanup: rm kairos.img
```

> [!NOTE]
> Without an explicit `-netdev`/`-device` pair, QEMU still creates a default
> NIC, but on QEMU's own internal `10.0.2.0/24` network with no port forwarded
> to the host. The VM boots, gets an address on that internal network, and the
> host still has no route to it, so `ssh kairos@IP` and the web installer
> below cannot reach it. The `-netdev user,...,hostfwd=...` line above forwards
> the guest's SSH and web-installer ports to the host instead, so the next two
> steps connect through `localhost`.

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

> [!TIP]
> The default installer also starts a web installer in the background. With
> the port forwarding from the command above, you should be able to access
> http://localhost:8080 and do the installation from there.

## Manual Installation

SSH to the virtual machine through the forwarded port, using the password "kairos" (without the quotes):

```
ssh -p 2222 kairos@localhost
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
kairos-agent manual-install config.yaml
```

If the installation was successful the machine should auto-reboot and menu should look differently. The first item is the active image and default one, that's all you need to know for now. Select it (press enter) or let it auto select after a few seconds.

```
 │*Kairos                                                                     │
 │ Kairos (fallback)                                                          │
 │ Kairos recovery                                                            │
 │ Kairos state reset (auto)                                                  │
 │ Kairos remote recovery
```

Log in with the user we created (user: kairos, password: kairos).

Turn into root

```bash
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
✅ Done! 🎉
