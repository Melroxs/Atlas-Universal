// ---------------------------------------------------------------------------
// Onboarding industry branch questions (UI config only).
//
// These questions drive the Setup wizard's branching step. They are UI-only
// configuration and must stay free of backend imports (the pack catalog ships
// separately in src/lib/atlas-data/packs.ts).
// ---------------------------------------------------------------------------

export const INDUSTRY_BRANCHES: Record<string, { question: string; options: string[] }[]> = {
  "insurance restoration": [
    {
      question: "Do you handle mitigation (emergency water / fire work)?",
      options: ["Yes, we do mitigation", "No, reconstruction only", "Both"],
    },
    {
      question: "Do you work directly with insurance carriers?",
      options: ["Yes, most of our work is carrier-paid", "Some", "No, retail only"],
    },
    {
      question: "Do you use Xactimate for estimating?",
      options: ["Yes, Xactimate", "Symbility / CoreLogic", "Other / in-house"],
    },
    {
      question: "Which field & job software do you use?",
      options: ["JobNimbus", "DASH", "CompanyCam", "None yet"],
    },
    {
      question: "Do you manage supplements on most jobs?",
      options: ["Frequently", "Occasionally", "Rarely"],
    },
  ],
  "legal services": [
    {
      question: "Which matter types do you handle most?",
      options: ["Personal injury", "Corporate / transactional", "Family", "Litigation"],
    },
    {
      question: "How do you bill?",
      options: ["Hourly", "Contingency", "Flat fee", "Mixed"],
    },
  ],
  construction: [
    {
      question: "Which project types do you take on?",
      options: ["Residential", "Commercial", "Remodel / renovation", "New build"],
    },
    {
      question: "Do you need to track lien waivers and pay applications?",
      options: ["Yes, regularly", "Occasionally", "No"],
    },
  ],
};
