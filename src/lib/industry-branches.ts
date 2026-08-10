// ---------------------------------------------------------------------------
// Onboarding industry branch questions (UI config only).
//
// These questions drive the Setup wizard's branching step. They previously
// lived in src/convex/data/packs.ts, but that module ships ~38 KB of backend
// pack data — importing it from a page dragged the whole file into the client
// bundle AND pulled the Convex module into the client TypeScript program,
// which was one of the reasons the platform deploy build ran out of time and
// memory. Keep this file free of any Convex imports.
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
