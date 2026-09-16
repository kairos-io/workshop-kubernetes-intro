# Perform a hybrid-cloud deployment

Docs:
  - https://kairos.io/docs/installation/aws/
  - https://kairos.io/docs/installation/gce/
  - https://kairos.io/docs/installation/azure/

In this exercise we are going to spin up a control plane on a public cloud provider
virtual machine (AWS, GCE or Azure) and a worker locally. We will form one cluster with them, demonstrating that it's possible to create hybrid cluster, utilizing resource where they are available, cheap and suitable.

## Step 1: Create the control plane

Create a control plane node by following the instructions for the cloud provider of your choice (see the documentation links at the top of this document).

## Step 2: Create a local VM worker

Follow the instructions of [stage-5](stage-5.md) to create a worker node running
as a local virtual machine.
