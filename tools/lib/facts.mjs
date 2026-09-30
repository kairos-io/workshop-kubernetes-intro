// The fixed set of facts in format v0. schema/v0/SPEC.md repeats this table for other readers.
// Order is the order the site asks the questions in.
export const FACTS = ["virtualization", "os", "arch", "runtime"];

export const VALUES = {
  virtualization: ["kairos-lab", "other"],
  os: ["linux", "macos", "windows"],
  arch: ["amd64", "arm64"],
  runtime: ["docker", "podman"],
};

export const LABELS = {
  virtualization: { "kairos-lab": "kairos-lab", other: "your own virtualization software" },
  os: { linux: "Linux", macos: "macOS", windows: "Windows" },
  arch: { amd64: "amd64", arm64: "arm64" },
  runtime: { docker: "Docker", podman: "Podman" },
};

export const QUESTIONS = {
  virtualization: "How will you run the VMs?",
  os: "What does your computer run?",
  arch: "What CPU architecture does your computer have?",
  runtime: "Which container runtime do you use?",
};
