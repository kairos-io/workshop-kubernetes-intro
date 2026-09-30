// The fixed set of facts in format v0. schema/v0/SPEC.md repeats this table for other readers.
// Order is the order the readers ask the questions in.
//
// `label` and `question` are what a game or site shows. `phrase` is the wording the markdown
// publisher uses inside a sentence, for example "Only if you use: your own virtualization software."
export const FACT_DEFS = [
  {
    id: "virtualization",
    label: "Virtualization",
    question: "What runs your VMs?",
    options: [
      { id: "kairos-lab", label: "kairos-lab", phrase: "kairos-lab" },
      { id: "own", label: "My own software", phrase: "your own virtualization software" },
    ],
  },
  {
    id: "os",
    label: "Operating system",
    question: "What is your computer running?",
    options: [
      { id: "linux", label: "Linux", phrase: "Linux" },
      { id: "macos", label: "macOS", phrase: "macOS" },
      { id: "windows", label: "Windows", phrase: "Windows" },
    ],
  },
  {
    id: "arch",
    label: "Architecture",
    question: "Which CPU architecture?",
    options: [
      { id: "amd64", label: "amd64", phrase: "amd64" },
      { id: "arm64", label: "arm64", phrase: "arm64" },
    ],
  },
  {
    id: "runtime",
    label: "Container runtime",
    question: "Which container runtime?",
    options: [
      { id: "docker", label: "Docker", phrase: "Docker" },
      { id: "podman", label: "Podman", phrase: "Podman" },
    ],
  },
];

export const FACTS = FACT_DEFS.map((f) => f.id);

export const VALUES = Object.fromEntries(FACT_DEFS.map((f) => [f.id, f.options.map((o) => o.id)]));

// Wording used inside a sentence.
export const LABELS = Object.fromEntries(FACT_DEFS.map((f) => [f.id, Object.fromEntries(f.options.map((o) => [o.id, o.phrase]))]));

export const QUESTIONS = Object.fromEntries(FACT_DEFS.map((f) => [f.id, f.question]));
