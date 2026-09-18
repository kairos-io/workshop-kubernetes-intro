# Stage 5: Deploying a multi-node cluster

Docs:
  - [Manual Multi-Node Cluster](https://kairos.io/docs/examples/multi-node/)

In this stage, we'll create a 2-node Kubernetes cluster:
- **Master node**: control plane (reuse the VM from [Stage 1](stage-1.md), or create a fresh one)
- **Worker node**: a new VM that joins the cluster

`kairos-lab`'s bridged networking (see [Stage 1](stage-1.md#create-and-boot-the-vm)) gives both VMs real IPs on your local network, so they can talk to each other directly — same on Linux and macOS.

## Prerequisites

- A working master VM, per [Stage 1](stage-1.md)
- At least ~12GB RAM free (8GB master + 4GB worker is a comfortable split)
- A Kairos ISO for the worker — reuse the one you already downloaded, or run `kairos-lab download` again to try a different flavor (the operator in [Stage 6](stage-6.md) can mix flavors across nodes)

## Select your installation source

You can use an image you built in [Stage 2](stage-2.md), or pick one from https://quay.io/organization/kairos. Make sure it has k3s and matches your architecture.

## Prepare the master node

If your master VM from Stage 1 is not running:

```bash
kairos-lab start -name master
```

If it is a fresh disk, install with a config like the following (`k3s.enabled` makes it the control plane):

```yaml
#cloud-config

hostname: metal-{{ trunc 4 .MachineID }}
users:
  - name: kairos
    passwd: kairos
    groups:
      - admin

k3s:
  enabled: true
```

## Find the master's IP and join token

Find the master's IP the same way as in [Stage 1](stage-1.md#find-the-vms-ip-address):

```bash
arp -a | grep -i "52:54"
```

SSH in and note the join token — you'll need it for the worker:

```bash
ssh kairos@<MASTER_IP>
sudo cat /var/lib/rancher/k3s/server/node-token
```

## Prepare the worker node

Start a second VM with its own disk name:

```bash
kairos-lab start -name worker
```

Install it with a config like this (note: `k3s-agent`, not `k3s` — the key is different from the master):

```yaml
#cloud-config

hostname: metal-{{ trunc 4 .MachineID }}
users:
  - name: kairos
    passwd: kairos
    groups:
      - admin

k3s-agent: # Warning: the key is different from the master node one
  enabled: true
  args:
    - --with-node-id # configures the agent to use the node ID to communicate with the master node
  env:
    K3S_TOKEN: "<MASTER_SERVER_TOKEN>" # from /var/lib/rancher/k3s/server/node-token on the master
    K3S_URL: https://<MASTER_SERVER_IP>:6443 # the master's IP
```

Replace `<MASTER_SERVER_IP>` and `<MASTER_SERVER_TOKEN>` with the values from the previous step, then install:

```bash
sudo kairos-agent manual-install config.yaml
```

The worker reboots after installation. Boot it from disk the same way as in [Stage 1](stage-1.md#boot-the-installed-system):

```bash
kairos-lab start -name worker
```

## Verify the cluster

On the master node:

```bash
ssh kairos@<MASTER_IP>
sudo su -i
```

> [!TIP]
> k3s configuration is located under `/etc/rancher/k3s/k3s.yaml`

```bash
kubectl get nodes -o wide
```

You should see both nodes:

```
NAME                     STATUS   ROLES           AGE     VERSION        INTERNAL-IP      OS-IMAGE
kairos-xxxx              Ready    control-plane   1d      v1.35.0+k3s1   192.168.20.150   Ubuntu 22.04.5 LTS
kairos-worker-xxxx       Ready    <none>          5m      v1.35.0+k3s1   192.168.20.151   Fedora Linux 40
```

### Test workload distribution

```bash
kubectl create deployment nginx --image=nginx --replicas=4
kubectl get pods -o wide
```

You should see pods scheduled on both nodes.

## Adding more workers

Repeat the worker steps with a different `-name` (e.g. `kairos-lab start -name worker2`). Each worker gets its own disk and its own IP from DHCP.

## Troubleshooting

### Worker not joining the cluster

```bash
ssh kairos@<WORKER_IP>
sudo journalctl -u k3s-agent -f
```

Check connectivity to the master and the agent's cached environment:

```bash
curl -sk https://<MASTER_IP>:6443/cacerts
sudo cat /etc/systemd/system/k3s-agent.service.env
```

### Worker can't reach master

Both VMs use the same `kairos-lab` bridged network, so they should reach each other directly:

```bash
# From the worker
ping <MASTER_IP>
```

If ping fails, check `kairos-lab status` on the host running each VM.

### TLS certificate errors

The master's K3s certificates include its IP by default. If the master's IP changed, regenerate them:

```bash
# On the master
sudo rm /var/lib/rancher/k3s/server/tls/serving-kube-apiserver.*
sudo systemctl restart k3s
```

### Wrong K3S_URL cached on the worker

```bash
# On the worker
sudo rm -rf /var/lib/rancher/k3s/agent
sudo systemctl restart k3s-agent
```

## Cleanup

To remove a worker:

```bash
# On the master
ssh kairos@<MASTER_IP>
sudo kubectl delete node kairos-worker-xxxx
```

```bash
# On the host
kairos-lab reset --disk worker
```

## Summary

| Node | Role | Memory |
|------|------|--------|
| Master | control-plane | ~8GB |
| Worker | worker | ~4GB |

With bridged networking, VMs get real IPs and can communicate directly — no port forwarding or host gateway workarounds needed.

## Next Steps

→ [Stage 6: Kubernetes-based Upgrades](stage-6.md)

---

✅ Done! 🎉
