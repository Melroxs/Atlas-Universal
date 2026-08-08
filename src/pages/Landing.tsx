import { motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Cable,
  Check,
  Database,
  Layers,
  Radar,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  Workflow,
} from "lucide-react";
import { useNavigate } from "react-router";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

const LAYERS = [
  {
    icon: Database,
    name: "Core Foundation",
    tag: "Phase 1",
    description:
      "Tenants, roles, permissions, document ingestion, provenance and an audit trail for every decision.",
    points: ["Auth & organizations", "Knowledge provenance", "Audit logging"],
  },
  {
    icon: Cable,
    name: "Connection Engine",
    tag: "Phase 2",
    description:
      "Every fragmented source — drives, spreadsheets, PDFs, email, CRMs — normalized into one knowledge base.",
    points: ["Connector registry", "Sync scheduling", "Normalization layer"],
  },
  {
    icon: Layers,
    name: "Intelligence Model",
    tag: "Phase 3",
    description:
      "Versioned industry, geographic and regulatory packs applied to your company's actual reality.",
    points: ["Industry packs", "Entity & policy extraction", "Evidence linking"],
  },
  {
    icon: Target,
    name: "Decision Engine",
    tag: "Phase 4",
    description:
      "Atlas compares what should happen with what's happening, then surfaces ranked, evidence-backed recommendations.",
    points: ["Gap & risk detection", "Priority scoring", "Approval routing"],
  },
];

const PIPELINE = [
  { icon: Upload, label: "Ingest", text: "Documents, spreadsheets, emails and system data land in one secure workspace." },
  { icon: BrainCircuit, label: "Extract", text: "Entities, policies, workflows and terminology become a labeled knowledge graph." },
  { icon: Search, label: "Compare", text: "Your reality is measured against company SOPs and applicable intelligence packs." },
  { icon: Target, label: "Recommend", text: "Gaps and risks become ranked, evidence-backed recommendations for a human to approve." },
  { icon: RefreshCcw, label: "Execute & learn", text: "Approved actions close the loop — outcomes recalibrate Atlas's confidence." },
];

function GraphVisual() {
  const nodes = [
    { id: "claim", x: 120, y: 130, r: 26, label: "Claim", tone: "text-rose-300" },
    { id: "sop", x: 300, y: 70, r: 24, label: "SOP", tone: "text-violet-300" },
    { id: "invoice", x: 430, y: 190, r: 22, label: "Invoice", tone: "text-emerald-300" },
    { id: "carrier", x: 300, y: 250, r: 24, label: "Carrier", tone: "text-sky-300" },
    { id: "policy", x: 90, y: 260, r: 20, label: "Policy", tone: "text-cyan-300" },
    { id: "signal", x: 480, y: 80, r: 20, label: "Signal", tone: "text-amber-300" },
  ];
  const edges = [
    ["claim", "sop"],
    ["claim", "carrier"],
    ["claim", "invoice"],
    ["sop", "signal"],
    ["carrier", "policy"],
    ["invoice", "signal"],
    ["carrier", "signal"],
  ];
  const pos = (id: string) => nodes.find((n) => n.id === id)!;
  return (
    <svg viewBox="0 0 560 320" className="w-full">
      <defs>
        <radialGradient id="graphGlow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="oklch(0.752 0.132 178 / 0.18)" />
          <stop offset="100%" stopColor="oklch(0.752 0.132 178 / 0)" />
        </radialGradient>
      </defs>
      <rect width="560" height="320" fill="url(#graphGlow)" rx="16" />
      {edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={pos(a).x}
          y1={pos(a).y}
          x2={pos(b).x}
          y2={pos(b).y}
          stroke="oklch(1 0 0 / 0.14)"
          strokeWidth="1"
        />
      ))}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={n.r + 8} fill="oklch(0.157 0.016 258 / 0.6)" />
          <circle cx={n.x} cy={n.y} r={n.r} fill="oklch(0.752 0.132 178 / 0.12)" stroke="oklch(0.752 0.132 178 / 0.45)" strokeWidth="1" />
          <text x={n.x} y={n.y + 4} textAnchor="middle" fill="oklch(0.95 0.008 258)" fontSize="11" fontFamily="ui-monospace, monospace">
            {n.label}
          </text>
        </g>
      ))}
      {/* pulsing radar sweeps */}
      <motion.circle
        cx={pos("claim").x}
        cy={pos("claim").y}
        fill="none"
        stroke="oklch(0.752 0.132 178 / 0.5)"
        initial={{ r: 26, opacity: 0.7 }}
        animate={{ r: 60, opacity: 0 }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
      />
      <motion.circle
        cx={pos("signal").x}
        cy={pos("signal").y}
        fill="none"
        stroke="oklch(0.802 0.14 80 / 0.55)"
        initial={{ r: 20, opacity: 0.7 }}
        animate={{ r: 52, opacity: 0 }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut", delay: 1.2 }}
      />
    </svg>
  );
}

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* ambient background */}
      <div className="atlas-glow-teal pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
      <div className="atlas-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />

      {/* ------------------------------------------------------------------ */}
      {/* Nav */}
      {/* ------------------------------------------------------------------ */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <button
          type="button"
          onClick={() => navigate("/auth")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-85"
        >
          <div className="flex size-9 items-center justify-center rounded-lg bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/30">
            <Radar className="size-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Atlas</span>
        </button>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#layers" className="transition-colors hover:text-foreground">Intelligence layers</a>
          <a href="#pipeline" className="transition-colors hover:text-foreground">How it reasons</a>
          <a href="#evidence" className="transition-colors hover:text-foreground">Evidence-first</a>
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="group flex items-center gap-2 rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-teal-950 shadow-[0_0_24px_rgba(45,212,191,0.25)] transition-all hover:bg-teal-300 hover:shadow-[0_0_32px_rgba(45,212,191,0.4)]"
          >
            Open Atlas
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Hero */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-24 pt-16 lg:grid-cols-2 lg:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <p className="atlas-eyebrow mb-4 flex items-center gap-2">
            <Sparkles className="size-3.5" />
            Universal AI operating system for business
          </p>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Your whole company,
            <br />
            one living{" "}
            <span className="bg-gradient-to-r from-teal-300 via-cyan-300 to-teal-300 bg-clip-text text-transparent">
              intelligence layer
            </span>
            .
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            Atlas isn't another CRM or spreadsheet. It sits <em>above</em> your documents, systems
            and workflows — reads everything, builds a knowledge graph, compares it against what
            should happen, and tells you exactly what to do next. Every answer cites its source.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/auth")}
              className="group flex items-center gap-2 rounded-lg bg-teal-400 px-5 py-2.5 text-sm font-semibold text-teal-950 shadow-[0_0_28px_rgba(45,212,191,0.3)] transition-all hover:bg-teal-300 hover:shadow-[0_0_40px_rgba(45,212,191,0.45)]"
            >
              Launch Atlas
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a
              href="#layers"
              className="rounded-lg border border-border/70 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-teal-400/40 hover:text-teal-200"
            >
              See the layers
            </a>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {["Evidence-backed answers", "Role-based approvals", "Full audit trail"].map((f) => (
              <span key={f} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-teal-300" />
                {f}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
          className="relative"
        >
          <div className="atlas-grid-fine rounded-2xl border border-border/70 bg-card/60 p-5 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Knowledge graph · live
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-300">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                reasoning
              </span>
            </div>
            <GraphVisual />
            <div className="mt-3 rounded-xl border border-teal-400/20 bg-teal-400/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs font-medium text-teal-100">
                  <ShieldCheck className="size-3.5 text-teal-300" />
                  Claim #1042 · drying log gap detected
                </p>
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                  HIGH
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                Missing moisture readings days 4–6 will delay invoicing · grounded in 3 sources
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Layers */}
      {/* ------------------------------------------------------------------ */}
      <section id="layers" className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <p className="atlas-eyebrow mb-3">The stack</p>
          <h2 className="text-3xl font-semibold tracking-tight">
            One platform, five phases of intelligence
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Built in the order real businesses need it — a universal core first, then connections,
            then a reasoning layer that keeps learning from outcomes.
          </p>
        </motion.div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LAYERS.map((layer, i) => {
            const Icon = layer.icon;
            return (
              <motion.div
                key={layer.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="group rounded-xl border border-border/70 bg-card/60 p-5 transition-colors hover:border-teal-400/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300 ring-1 ring-teal-400/20 transition-transform group-hover:scale-105">
                    <Icon className="size-5" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    {layer.tag}
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold">{layer.name}</h3>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{layer.description}</p>
                <ul className="mt-3 space-y-1">
                  {layer.points.map((p) => (
                    <li key={p} className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                      <Check className="size-3 text-teal-300/70" />
                      {p}
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Pipeline */}
      {/* ------------------------------------------------------------------ */}
      <section id="pipeline" className="relative z-10 border-y border-border/60 bg-card/30 py-20">
        <div className="mx-auto w-full max-w-6xl px-5">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <p className="atlas-eyebrow mb-3">How it reasons</p>
            <h2 className="text-3xl font-semibold tracking-tight">From raw files to decisions</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Atlas turns your operational history into recommendations — without asking anyone to
              change how they work.
            </p>
          </motion.div>
          <div className="mt-12 grid gap-3 md:grid-cols-5">
            {PIPELINE.map((p, i) => {
              const Icon = p.icon;
              return (
                <motion.div
                  key={p.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="relative rounded-xl border border-border/70 bg-card/70 p-4"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-teal-300" />
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{p.label}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{p.text}</p>
                  {i < PIPELINE.length - 1 && (
                    <ArrowRight className="absolute -right-3 top-1/2 hidden size-4 -translate-y-1/2 text-teal-400/50 md:block" />
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Evidence-first */}
      {/* ------------------------------------------------------------------ */}
      <section id="evidence" className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <motion.div {...fadeUp}>
            <p className="atlas-eyebrow mb-3">Evidence-first</p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Atlas never guesses. It cites.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Every answer is labeled FACT, RULE, OBSERVATION, INFERENCE or RECOMMENDATION — with a
              confidence score and links to the exact documents it came from. If the evidence
              doesn't support an answer, Atlas says so.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                ["Source hierarchy", "Regulations rank above AI inference; confidence reflects it."],
                ["Provenance on everything", "Entities and assertions remember which document they came from."],
                ["Human in the loop", "High-impact recommendations wait for a manager's approval."],
              ].map(([k, v]) => (
                <li key={k} className="flex gap-3">
                  <Workflow className="mt-0.5 size-4 shrink-0 text-teal-300" />
                  <div>
                    <p className="text-sm font-medium">{k}</p>
                    <p className="text-xs text-muted-foreground">{v}</p>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-xl shadow-black/30"
          >
            <div className="flex items-center gap-2 border-b border-border/60 pb-3">
              <div className="flex size-7 items-center justify-center rounded-lg bg-teal-400/15 text-teal-300">
                <Radar className="size-4" />
              </div>
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Ask Atlas
              </span>
              <span className="ml-auto rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                RULE
              </span>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              “What documentation is required before we can invoice?”
            </p>
            <p className="mt-3 text-sm leading-6 text-foreground">
              Per the company SOP, every invoice requires a signed authorization, dated photographs,
              and — for water losses — a drying log with readings recorded every 12 hours [1].
              Northbrook additionally requires net-30 submission within 30 days of completion [2].
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["[1] Restoration SOP §2", "[2] Carrier requirements brief"].map((c) => (
                <span
                  key={c}
                  className="rounded-md border border-teal-400/25 bg-teal-400/5 px-2 py-1 font-mono text-[11px] text-teal-200"
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>Confidence</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-[88%] rounded-full bg-emerald-400" />
                </div>
                <span className="font-mono text-[11px]">88%</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CTA */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="atlas-glow-teal relative overflow-hidden rounded-2xl border border-teal-400/20 px-6 py-14 text-center"
        >
          <div className="atlas-grid-fine pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <p className="atlas-eyebrow mb-3">Get started in minutes</p>
            <h2 className="mx-auto max-w-xl text-3xl font-semibold tracking-tight">
              Give Atlas your paperwork. Get your business back.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Create a workspace, map your systems, upload a few documents — and watch Atlas start
              surfacing what matters.
            </p>
            <button
              type="button"
              onClick={() => navigate("/auth")}
              className="group mt-8 inline-flex items-center gap-2 rounded-lg bg-teal-400 px-6 py-3 text-sm font-semibold text-teal-950 shadow-[0_0_32px_rgba(45,212,191,0.3)] transition-all hover:bg-teal-300 hover:shadow-[0_0_48px_rgba(45,212,191,0.45)]"
            >
              Open Atlas free
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer */}
      {/* ------------------------------------------------------------------ */}
      <footer className="relative z-10 border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/25">
              <Radar className="size-3.5" />
            </div>
            <span className="text-sm font-semibold">Atlas</span>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60">
            read · reason · recommend · execute
          </p>
          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in →
          </button>
        </div>
      </footer>
    </div>
  );
}
