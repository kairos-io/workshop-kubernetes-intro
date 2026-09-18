# Stage 3: CI/CD with Gitea + Argo Workflows (MacOS)

This guide sets up a local CI/CD pipeline using **Gitea** (local Git server) and **Argo Workflows** (running in your Kairos K3s cluster) to automate ISO builds.

Docs:
  - [Argo Workflows](https://argoproj.github.io/workflows/)
  - [Gitea Webhooks](https://docs.gitea.com/usage/webhooks)

## Overview

Instead of GitHub + GitHub Actions, we use:

| GitHub | Local Alternative |
|--------|-------------------|
| GitHub repository | Gitea (http://localhost:3000) |
| GitHub Actions | Argo Workflows (in K3s cluster) |
| GitHub Releases | Gitea Releases or local storage |

## Prerequisites

- Kairos VM running with K3s (from [Stage 1](../stage-1.md))
- Local infrastructure running (Gitea + Registry from [Phase 0](local-infra/README.md))
- `kubectl` configured to access your K3s cluster

> [!NOTE]
> Your Kairos VM should have **8GB RAM** for Argo Workflows and ISO builds. If you followed Stage 1, your VM already has this configuration.

### Verify K3s Access

If you haven't already set up kubectl access from your host, follow [Access the cluster from your host](../stage-1.md#access-the-cluster-from-your-host-optional) in Stage 1.

```bash
export KUBECONFIG=~/.kube/config-kairos
kubectl get nodes
```

## Step 1: Install MinIO for Artifact Storage

Install MinIO in the argo namespace to store workflow artifacts (ISOs):

```bash
export KUBECONFIG=~/.kube/config-kairos

# Add MinIO Helm repo
helm repo add minio https://charts.min.io/
helm repo update

# Install MinIO in standalone mode (single node, low resources)
helm install argo-artifacts minio/minio \
  --namespace argo \
  --create-namespace \
  --set mode=standalone \
  --set replicas=1 \
  --set persistence.size=10Gi \
  --set resources.requests.memory=256Mi \
  --set resources.requests.cpu=100m \
  --set fullnameOverride=argo-artifacts \
  --set defaultBuckets="argo-artifacts" \
  --set rootUser=admin \
  --set rootPassword=password123

# Wait for MinIO to be ready
kubectl -n argo wait --for=condition=Ready pods -l release=argo-artifacts --timeout=120s
```

### Create the artifacts bucket

```bash
kubectl -n argo run minio-mc --restart=Never --image=minio/mc:latest --command -- \
  sh -c "mc alias set myminio http://argo-artifacts.argo.svc:9000 admin password123 && \
         mc mb myminio/argo-artifacts --ignore-existing && \
         mc ls myminio"

# Wait and check logs
sleep 10 && kubectl -n argo logs minio-mc
kubectl -n argo delete pod minio-mc
```

### Access MinIO Console (Optional)

```bash
kubectl -n argo port-forward svc/argo-artifacts-console 9001:9001 &
open http://localhost:9001
# Login: admin / password123
```

### Configure Argo to use MinIO

After installing Argo Workflows (Step 2), configure it to use MinIO as the default artifact repository:

```bash
kubectl -n argo create configmap workflow-controller-configmap \
  --from-literal=artifactRepository='s3:
  bucket: argo-artifacts
  endpoint: argo-artifacts.argo.svc:9000
  insecure: true
  accessKeySecret:
    name: argo-artifacts
    key: rootUser
  secretKeySecret:
    name: argo-artifacts
    key: rootPassword' \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart the workflow controller to pick up the config
kubectl -n argo rollout restart deployment workflow-controller
```

## Step 2: Install Argo Workflows

Install Argo Workflows in your K3s cluster:

```bash
export KUBECONFIG=~/.kube/config-kairos

# Create namespace
kubectl create namespace argo

# Install Argo Workflows v4.0.0 (use --server-side for large CRDs)
kubectl apply -n argo --server-side -f https://github.com/argoproj/argo-workflows/releases/download/v4.0.0/install.yaml

# Wait for pods to be ready
kubectl -n argo wait --for=condition=Ready pods --all --timeout=300s

# Patch the service to use NodePort for access
kubectl -n argo patch svc argo-server -p '{"spec": {"type": "NodePort"}}'

# IMPORTANT: Fix RBAC for Argo v4 (allows default service account to run workflows)
kubectl apply -n argo -f - <<'EOF'
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: workflow-executor
  namespace: argo
rules:
  - apiGroups: ["argoproj.io"]
    resources: ["workflowtaskresults"]
    verbs: ["create", "patch", "get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: workflow-executor-binding
  namespace: argo
subjects:
  - kind: ServiceAccount
    name: default
    namespace: argo
roleRef:
  kind: Role
  name: workflow-executor
  apiGroup: rbac.authorization.k8s.io
EOF
```

### Access Argo UI

Get the NodePort:

```bash
kubectl -n argo get svc argo-server -o jsonpath='{.spec.ports[0].nodePort}'
```

Access via: `https://<KAIROS_IP>:<nodeport>` directly from your Mac.

Or use port-forward:

```bash
kubectl -n argo port-forward svc/argo-server 2746:2746 &
open https://localhost:2746
```

## Step 2: Create a Gitea Repository

### 1. Log into Gitea

Open http://localhost:3000 and log in (or create an account if you haven't).

### 2. Create a New Repository

1. Click **+** → **New Repository**
2. Name: `kairos-custom`
3. Initialize with README: **Yes**
4. Click **Create Repository**

### 3. Clone Locally

```bash
cd ~/kairos-workshop
git clone http://localhost:3000/<your-username>/kairos-custom.git
cd kairos-custom
```

## Step 3: Add Your Dockerfile

Copy the Dockerfile from [Stage 2: Create the Dockerfile](stage-2-macos.md#2-create-the-dockerfile) into your repository.

## Step 4: Create the Argo Workflow

Create a workflow that builds the Kairos ISO:

```bash
mkdir -p .argo

cat > .argo/build-iso.yaml <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: kairos-build-
spec:
  entrypoint: build-iso
  volumes:
    - name: build-output
      emptyDir: {}
  templates:
    - name: build-iso
      steps:
        - - name: build-image
            template: build-image
        - - name: push-image
            template: push-image
        - - name: create-iso
            template: create-iso

    - name: build-image
      container:
        image: gcr.io/kaniko-project/executor:latest
        args:
          - "--dockerfile=Dockerfile"
          - "--context=git://gitea.local:3000/{{workflow.parameters.repo}}.git"
          - "--destination=ttl.sh/kairos-custom-{{workflow.parameters.tag}}:1h"
          - "--no-push=false"

    - name: push-image
      container:
        image: alpine
        command: [echo]
        args: ["Image pushed to ttl.sh"]

    - name: create-iso
      container:
        image: quay.io/kairos/auroraboot:latest
        command: ["/usr/bin/auroraboot"]
        args:
          - "build-iso"
          - "--output=/output"
          - "ttl.sh/kairos-custom-{{workflow.parameters.tag}}:2h"
        volumeMounts:
          - name: build-output
            mountPath: /output
      outputs:
        artifacts:
          - name: iso
            path: /output
            archive:
              none: {}
EOF
```

## Step 5: Create Build and Release Workflow

This workflow builds the ISO and automatically creates a Gitea release with the artifact:

### Create Gitea Token Secret

First, create a Gitea access token and store it as a Kubernetes secret:

```bash
# Generate token in Gitea UI (Settings -> Applications -> Generate Token)
# Or use the CLI if you have admin access:
# podman exec kairos-gitea gitea admin user generate-access-token -u <username> -t argo-token --scopes all

# Create the secret
kubectl -n argo create secret generic gitea-token --from-literal=token=<YOUR_GITEA_TOKEN>
```

### Create the Workflow

```bash
cat > .argo/build-and-release.yaml <<'EOF'
# Argo Workflow to build Kairos ISO and create Gitea Release
# Submit with: argo submit -n argo .argo/build-and-release.yaml -p version=v0.1.0 --watch
# Argo Workflow to build Kairos ISO and create Gitea Release
# Submit with: argo submit -n argo .argo/build-and-release.yaml --watch
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: kairos-release-
spec:
  entrypoint: build-and-release
  arguments:
    parameters:
      - name: version
        value: "v0.0.1"
      - name: image-source
        value: "ttl.sh/kairos-custom-fedora:2h"
  volumes:
    - name: workspace
      emptyDir: {}
  templates:
    - name: build-and-release
      steps:
        - - name: build-iso
            template: build-iso
        - - name: create-release
            template: create-release
            arguments:
              artifacts:
                - name: iso-files
                  from: "{{steps.build-iso.outputs.artifacts.iso-output}}"

    - name: build-iso
      container:
        image: quay.io/kairos/auroraboot:latest
        command: ["/bin/sh", "-c"]
        args:
          - |
            echo "=== Building Kairos ISO ==="
            echo "Version: {{workflow.parameters.version}}"
            echo "Image source: {{workflow.parameters.image-source}}"
            
            # Clean workspace first to ensure only current build artifacts
            rm -rf /workspace/*
            
            auroraboot build-iso \
              --output /workspace \
              {{workflow.parameters.image-source}}
            
            # Rename ISO to include version
            for iso in /workspace/*.iso; do
              if [ -f "$iso" ]; then
                newname=$(echo "$iso" | sed "s/\.iso$/-{{workflow.parameters.version}}.iso/")
                mv "$iso" "$newname"
                echo "Renamed: $iso -> $newname"
              fi
            done
            
            echo "=== Build Complete ==="
            ls -lh /workspace/
        volumeMounts:
          - name: workspace
            mountPath: /workspace
        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
      outputs:
        artifacts:
          - name: iso-output
            path: /workspace
            archive:
              none: {}

    - name: create-release
      inputs:
        artifacts:
          - name: iso-files
            path: /iso
      container:
        image: alpine:latest
        resources:
          requests:
            memory: "4Gi"
          limits:
            memory: "4Gi"
        env:
          - name: GITEA_TOKEN
            valueFrom:
              secretKeyRef:
                name: gitea-token
                key: token
          - name: GITEA_HOST
            # From inside K3s, reach Gitea on your Mac
            # Replace with your Mac's IP (run: ipconfig getifaddr en0)
            value: "192.168.20.100:3000"
        command: ["/bin/sh", "-c"]
        args:
          - |
            apk add --no-cache curl jq
            
            VERSION="{{workflow.parameters.version}}"
            REPO_OWNER="kairos"
            REPO_NAME="kairos-custom"
            
            echo "=== Creating Gitea Release ==="
            echo "Version: $VERSION"
            
            # Create release (target_commitish auto-creates the tag on main branch)
            RELEASE_RESPONSE=$(curl -s -X POST \
              "http://${GITEA_HOST}/api/v1/repos/${REPO_OWNER}/${REPO_NAME}/releases" \
              -H "Authorization: token ${GITEA_TOKEN}" \
              -H "Content-Type: application/json" \
              -d "{
                \"tag_name\": \"${VERSION}\",
                \"target_commitish\": \"main\",
                \"name\": \"Kairos Custom ${VERSION}\",
                \"body\": \"Automated build from Argo Workflows\n\nWorkflow: {{workflow.name}}\",
                \"draft\": false,
                \"prerelease\": false
              }")
            
            echo "Release response: $RELEASE_RESPONSE"
            RELEASE_ID=$(echo "$RELEASE_RESPONSE" | jq -r '.id')
            
            if [ "$RELEASE_ID" = "null" ] || [ -z "$RELEASE_ID" ]; then
              echo "Failed to create release, trying to get existing one..."
              RELEASE_ID=$(curl -s \
                "http://${GITEA_HOST}/api/v1/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${VERSION}" \
                -H "Authorization: token ${GITEA_TOKEN}" | jq -r '.id')
            fi
            
            echo "Release ID: $RELEASE_ID"
            
            # Upload ISO files matching the version
            echo "=== Uploading artifacts ==="
            ls -la /iso/
            
            for file in /iso/*-${VERSION}.iso; do
              if [ -f "$file" ]; then
                filename=$(basename "$file")
                echo "Uploading: $filename"
                curl -s -X POST \
                  "http://${GITEA_HOST}/api/v1/repos/${REPO_OWNER}/${REPO_NAME}/releases/${RELEASE_ID}/assets?name=${filename}" \
                  -H "Authorization: token ${GITEA_TOKEN}" \
                  -H "Content-Type: application/octet-stream" \
                  --data-binary "@${file}"
                echo "Uploaded: $filename"
              fi
            done
            
            echo "=== Release Complete ==="
            echo "View at: http://localhost:3000/${REPO_OWNER}/${REPO_NAME}/releases/tag/${VERSION}"
EOF
```

## Step 6: Submit the Workflow

Push your changes to Gitea:

```bash
git add .
git commit -m "Add Dockerfile and Argo workflows"
git push origin main
```

Submit the workflow to Argo:

```bash
export KUBECONFIG=~/.kube/config-kairos

# Install Argo CLI (if not already installed)
brew install argo

# Submit with custom version 
argo submit -n argo .argo/build-and-release.yaml \
  -p version=v0.1.0 \
  -p image-source=ttl.sh/kairos-custom-fedora:2h \
  --watch
```

## Step 7: View the Release

Once the workflow completes, the ISO will be available as a Gitea release:

- **Gitea Releases**: http://localhost:3000/kairos/kairos-custom/releases
- **MinIO Console**: http://localhost:9001 (artifacts also stored here)
- **Argo UI**: https://localhost:2746 (workflow history)

## Troubleshooting

### Argo Workflow fails to pull image

Ensure DNS is configured correctly in the VM (see Prerequisites section). The most common issue is QEMU's built-in DNS not working.

Check logs:

```bash
kubectl -n argo logs <pod-name>
kubectl -n argo get events --sort-by='.lastTimestamp'
```

### DNS not working / "lookup registry-1.docker.io: Try again"

With vmnet-bridged networking, the VM uses your network's DNS. This should work automatically. If DNS fails, SSH into the VM and check `/etc/resolv.conf`.

### Gitea not accessible from K3s

The K3s cluster needs to reach Gitea running on your Mac. Use your Mac's IP address:

```bash
# Find your Mac's IP on the same network
ipconfig getifaddr en0  # e.g., 192.168.20.100
```

From inside K3s pods, use `<YOUR_MAC_IP>:3000` to reach Gitea.

### Workflow stuck in Pending

Check for resource issues:

```bash
kubectl -n argo describe pod <pod-name>
kubectl -n argo get events
```

### OOMKilled errors

If workflow steps fail with `OOMKilled`:

1. **Increase VM memory** - Change QEMU `-m 4096` to `-m 8192` (8GB)
2. **Check step resources** - The `create-release` step needs ~4GB to upload large ISOs:
   ```yaml
   resources:
     requests:
       memory: "4Gi"
     limits:
       memory: "4Gi"
   ```

## Summary

You now have a complete local CI/CD pipeline:

| Component | Purpose | Access |
|-----------|---------|--------|
| **Gitea** | Git repository & releases | http://localhost:3000 |
| **Argo Workflows** | CI/CD orchestration | https://localhost:2746 |
| **MinIO** | Artifact storage (ISOs) | http://localhost:9001 |

### Pipeline Flow

1. **Code** → Push to Gitea (`kairos/kairos-custom`)
2. **Build** → Argo Workflows builds ISO with AuroraBoot
3. **Store** → Artifacts saved to MinIO
4. **Release** → ISO uploaded to Gitea Releases

This replaces the GitHub + GitHub Actions workflow with fully local infrastructure.

## Next Steps

→ [Stage 4: Manual Upgrade](../stage-4.md)

---

✅ Done! 🎉
