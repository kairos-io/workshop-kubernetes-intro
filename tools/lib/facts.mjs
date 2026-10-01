// The fixed set of facts in format v0: their ids, their values and their wording. schema/v0/SPEC.md
// repeats the ids and values for other readers.
//
// The order is the fixed order of facts in the generated game content and in the `only` objects. It is
// not the order of the questions. The loadout in workshop.yaml holds the questions and the option
// labels that a learner sees.
//
// `label` is the name of the fact, for example in a settings screen. `phrase` is the wording the markdown
// publisher uses inside a sentence, for example "Only if you use: your own virtualization software."
export const FACT_DEFS = [
  {
    id: "virtualization",
    label: "Virtualization",
    options: [
      { id: "kairos-lab", phrase: "kairos-lab" },
      { id: "own", phrase: "your own virtualization software" },
    ],
  },
  {
    id: "os",
    label: "OS",
    options: [
      { id: "linux", phrase: "Linux" },
      { id: "macos", phrase: "macOS" },
      { id: "windows", phrase: "Windows" },
    ],
  },
  {
    id: "arch",
    label: "Architecture",
    options: [
      { id: "amd64", phrase: "amd64" },
      { id: "arm64", phrase: "arm64" },
    ],
  },
  {
    id: "runtime",
    label: "Container runtime",
    options: [
      { id: "docker", phrase: "Docker" },
      { id: "podman", phrase: "Podman" },
    ],
  },
];

export const FACTS = FACT_DEFS.map((f) => f.id);

export const VALUES = Object.fromEntries(FACT_DEFS.map((f) => [f.id, f.options.map((o) => o.id)]));

// Wording used inside a sentence.
export const LABELS = Object.fromEntries(FACT_DEFS.map((f) => [f.id, Object.fromEntries(f.options.map((o) => [o.id, o.phrase]))]));
