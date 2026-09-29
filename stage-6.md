# Stage 6: Upgrading your cluster through Kubernetes

Docs:
  - [Kairos Operator README](https://github.com/kairos-io/kairos-operator)

## Overview

In this final stage, we'll use the **Kairos Operator** to manage OS upgrades through Kubernetes. Instead of manually running `kairos-agent upgrade` on each node ([Stage 4](stage-4.md)), the operator automates the process:

1. Cordons the node (prevents new workloads)
2. Performs the upgrade
3. Reboots the node
4. Uncordons the node

This is ideal for managing upgrades across multiple nodes in a cluster. You can use any of the clusters you created in the previous stages (single-node or multi-node).

## Prerequisites

- A working Kairos cluster (single- or multi-node) from previous stages
- `kubectl` access, either from inside the master VM or from your host machine via its kubeconfig
- Cluster nodes can reach external registries (quay.io)

## Step 1: Deploy the Kairos Operator

### Option A: With `git` available

The following command needs `git` in the `PATH`. If you added `git` to your Kairos image as in [Stage 2](stage-2.md), you can run this from within the master node — otherwise copy `/etc/rancher/k3s/k3s.yaml` to a host that has `git` and point it at the master's IP.

```bash
kubectl apply -k https://github.com/kairos-io/kairos-operator/config/default
```

### Option B: Without `git` (e.g. Hadron-based images)

```bash
ssh kairos@<MASTER_IP>

curl -sL https://github.com/kairos-io/kairos-operator/archive/refs/heads/main.tar.gz | tar -xz -C /tmp
sudo kubectl apply -k /tmp/kairos-operator-main/config/default
```

### Verify the deployment

```bash
kubectl -n kairos-operator-system get pods
```

Expected output:
```
NAME                                               READY   STATUS    RESTARTS   AGE
kairos-operator-controller-manager-xxxxx-xxxxx     2/2     Running   0          30s
```

Wait for the pod to be `Running` before proceeding.

## Step 2: Label nodes for upgrade

The operator uses labels to select which nodes to upgrade:

```bash
kubectl label nodes --all kairos.io/managed=true
kubectl get nodes --show-labels | grep kairos.io/managed
```

## Step 3: Create the upgrade resource

The operator acts on two Custom Resources: `NodeOp` and `NodeOpUpgrade`. This example uses `NodeOpUpgrade`, built specifically for upgrading Kairos.

Check what upgrade images are available for each node first:

```bash
ssh kairos@<MASTER_IP> "sudo kairos-agent upgrade list-releases"
ssh kairos@<WORKER_IP> "sudo kairos-agent upgrade list-releases"  # if multi-node
```

> [!NOTE]
> Different nodes can show different available images based on their OS flavor (e.g. Ubuntu vs Fedora) — the operator can upgrade each node to its own flavor's latest version.

Create the upgrade manifest, replacing `spec.image` with the image you intend to upgrade to:

```bash
cat > upgrade.yaml <<'EOF'
apiVersion: operator.kairos.io/v1alpha1
kind: NodeOpUpgrade
metadata:
  name: kairos-upgrade
  namespace: default
spec:
  # The container image containing the new Kairos version
  image: quay.io/kairos/ubuntu:22.04-standard-amd64-generic-v3.7.2-k3s-v1.35.0-k3s3

  # NodeSelector to target specific nodes (optional)
  nodeSelector:
    matchLabels:
      kairos.io/managed: "true"

  # Maximum number of nodes that can run the upgrade simultaneously
  # 0 means run on all nodes at once
  concurrency: 1

  # Whether to stop creating new jobs when a job fails
  stopOnFailure: true

  # Whether to upgrade the active partition (defaults to true)
  # upgradeActive: true

  # Whether to upgrade the recovery partition (defaults to false)
  # upgradeRecovery: false

  # Whether to force the upgrade without version checks
  # force: false
EOF
```

## Step 4: Apply the upgrade

```bash
kubectl apply -f upgrade.yaml
```

Watch it progress:

```bash
kubectl get nodeopupgrade -w
kubectl get nodes -w
kubectl -n kairos-operator-system logs -f deployment/kairos-operator-controller-manager
```

What happens:

1. **Node cordoned** — no new pods scheduled
2. **Upgrade job created** — pulls the new image and writes it to the passive partition
3. **Node reboots** — boots into the upgraded OS
4. **Node uncordoned** — returns to `Ready`

```
NAME            STATUS                     AGE
kairos-479e     Ready,SchedulingDisabled   0s    # Cordoned
kairos-479e     NotReady                   30s   # Rebooting
kairos-479e     Ready                      90s   # Upgrade complete
```

## Step 5: Verify the upgrade

```bash
kubectl get nodes -o wide
ssh kairos@<VM_IP> "cat /etc/kairos-release | grep KAIROS_VERSION"
```

## Upgrade strategies

### Single-node cluster

```yaml
spec:
  concurrency: 1  # Only option for single node
```

The cluster is briefly unavailable during the reboot.

### Multi-node cluster

```yaml
spec:
  # Upgrade one at a time (safest)
  concurrency: 1

  # Or upgrade all at once (faster but riskier)
  # concurrency: 0
```

### Canary deployment

Upgrade a subset of nodes first:

```bash
kubectl label node kairos-worker-xxxxx kairos.io/canary=true

cat > upgrade-canary.yaml <<'EOF'
apiVersion: operator.kairos.io/v1alpha1
kind: NodeOpUpgrade
metadata:
  name: kairos-canary-upgrade
spec:
  image: quay.io/kairos/ubuntu:22.04-standard-amd64-generic-v3.7.2-k3s-v1.35.0-k3s3
  nodeSelector:
    matchLabels:
      kairos.io/canary: "true"
  concurrency: 1
  stopOnFailure: true
EOF

kubectl apply -f upgrade-canary.yaml
```

## Troubleshooting

### Upgrade job fails

```bash
kubectl get jobs -A | grep upgrade
kubectl logs job/<job-name> -n <namespace>
```

### Node stuck in `NotReady`

1. Check the VM console for boot errors.
2. Try booting the fallback partition (GRUB menu).
3. Check K3s logs after boot: `sudo journalctl -u k3s-agent -f` (worker) or `sudo journalctl -u k3s -f` (master).

### Rollback an upgrade

The Kairos operator has no automatic rollback. To roll back manually: reboot the node, select **"Kairos (fallback)"** at the GRUB menu — it rejoins the cluster on the previous version.

### Delete a stuck upgrade

```bash
kubectl delete nodeopupgrade kairos-upgrade
```

### Upgrade completed but `rebootStatus` stuck on `pending`

The node reboots and the upgrade completes, but the operator doesn't detect it:

```bash
kubectl get nodes
# kairos-worker-ec386546   Ready,SchedulingDisabled   <none>   10h   # Still cordoned!

kubectl get nodeopupgrade kairos-upgrade -o yaml | grep -A8 'status:'
#   nodeStatuses:
#     kairos-worker-ec386546:
#       phase: Completed
#       rebootStatus: pending    # Stuck here despite successful reboot!
```

**Root cause:** the reboot pod sets a `kairos.io/reboot-state: completed` annotation on itself just before triggering the reboot. If the reboot happens too fast, the annotation may not be persisted before the pod terminates.

**Diagnosis:**

```bash
kubectl get pods -l kairos.io/reboot=true
kubectl get pod <reboot-pod> -o jsonpath='{.metadata.annotations}'
kubectl -n operator-system logs deployment/operator-kairos-operator --tail=20
# DEBUG  No available slots for new jobs  {"running": 1, "maxConcurrency": 1}
```

**Resolution:** patch the reboot pod with the missing annotation:

```bash
REBOOT_POD=$(kubectl get pods -l kairos.io/reboot=true -o jsonpath='{.items[0].metadata.name}')
kubectl patch pod $REBOOT_POD -p '{"metadata":{"annotations":{"kairos.io/reboot-state":"completed"}}}'
```

The operator then updates `rebootStatus` to `completed`, the upgrade `phase` to `Completed`, and uncordons the node.

> [!NOTE]
> This appears to be an edge case in the Kairos Operator. Consider reporting it to the [kairos-operator repository](https://github.com/kairos-io/kairos-operator/issues) if you hit it.

## Cleanup

```bash
kubectl delete -k https://github.com/kairos-io/kairos-operator/config/default
```

## Summary

| Feature | Benefit |
|---------|---------|
| **Automated upgrades** | No manual SSH to each node |
| **Controlled rollout** | Concurrency settings for safe upgrades |
| **Kubernetes native** | Manage the OS like any other K8s resource |
| **Node cordoning** | Graceful workload migration |

### Complete workshop flow

1. **Stage 1**: Boot and install a Kairos VM
2. **Stage 2**: Build a custom Kairos image
3. **Stage 3**: CI/CD for image builds
4. **Stage 4**: Manual upgrade with `kairos-agent`
5. **Stage 5**: Multi-node cluster setup
6. **Stage 6**: Kubernetes-based upgrades with the operator

---

✅ Workshop Complete! 🎉
