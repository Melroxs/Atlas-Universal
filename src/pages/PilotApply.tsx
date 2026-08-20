import { useState } from "react";
import { useNavigate } from "react-router";
import { getSupabaseClient } from "@/lib/supabase";
import { CheckCircle, ArrowLeft, Loader2, Send } from "lucide-react";
import logo from "@/assets/logo.svg";

interface FormData {
  full_name: string;
  company_name: string;
  email: string;
  phone: string;
  website: string;
  company_type: string;
  role: string;
  monthly_claims: string;
  current_workflow: string;
  biggest_pain: string;
  heard_about: string;
  notes: string;
}

const COMPANY_TYPES = [
  "Roofing Contractor",
  "General Contractor",
  "Restoration Company",
  "Water Damage Restoration",
  "Fire Damage Restoration",
  "Public Adjuster",
  "Insurance Agency",
  "Other",
];

const HEARD_ABOUT = [
  "Google Search",
  "Social Media",
  "Industry Referral",
  "Conference / Trade Show",
  "Email Outreach",
  "Partner Recommendation",
  "Other",
];

export default function PilotApply() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({
    full_name: "",
    company_name: "",
    email: "",
    phone: "",
    website: "",
    company_type: "",
    role: "",
    monthly_claims: "",
    current_workflow: "",
    biggest_pain: "",
    heard_about: "",
    notes: "",
  });

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("System not configured. Please try again later.");
      }

      const { error: rpcError } = await supabase.rpc("pilot_apply", {
        p_full_name: form.full_name.trim(),
        p_company_name: form.company_name.trim(),
        p_email: form.email.trim(),
        p_phone: form.phone.trim() || null,
        p_website: form.website.trim() || null,
        p_company_type: form.company_type || null,
        p_role: form.role.trim() || null,
        p_monthly_claims: form.monthly_claims || null,
        p_current_workflow: form.current_workflow.trim() || null,
        p_biggest_pain: form.biggest_pain.trim() || null,
        p_heard_about: form.heard_about || null,
        p_notes: form.notes.trim() || null,
      });

      if (rpcError) throw rpcError;
      setSubmitted(true);
    } catch (err) {
      console.error("Pilot application error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-lg text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Application Received
            </h1>
            <p className="text-muted-foreground leading-relaxed">
              Thank you for your interest in Atlas. Our team will review your
              application and reach out within 1-2 business days to schedule
              your pilot consultation.
            </p>
            <p className="text-sm text-muted-foreground">
              We'll contact you at <strong>{form.email}</strong>
            </p>
          </div>
          <div className="flex flex-col gap-3 items-center pt-2">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Return to Atlas
            </button>
            <button
              type="button"
              onClick={() => navigate("/auth")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In (if you already have access)
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Atlas
          </button>
          <div className="flex items-center gap-3 mb-4">
            <img
              src={logo}
              alt="Atlas"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Request Pilot Access
              </h1>
              <p className="text-sm text-muted-foreground">
                Book a 15-minute consultation with our team
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Atlas is currently available through a controlled pilot program.
              Tell us about your company and we'll determine whether Atlas is a
              good fit for your workflow. After review, we'll schedule a brief
              consultation and get you set up.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contact Info */}
          <section className="space-y-4">
            <h2 className="text-sm font-medium text-foreground">
              Contact Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Full Name"
                required
                value={form.full_name}
                onChange={(v) => updateField("full_name", v)}
                placeholder="John Smith"
              />
              <Field
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(v) => updateField("email", v)}
                placeholder="john@company.com"
              />
              <Field
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={(v) => updateField("phone", v)}
                placeholder="(555) 123-4567"
              />
              <Field
                label="Company Name"
                required
                value={form.company_name}
                onChange={(v) => updateField("company_name", v)}
                placeholder="ABC Roofing & Restoration"
              />
            </div>
            <Field
              label="Company Website"
              value={form.website}
              onChange={(v) => updateField("website", v)}
              placeholder="https://www.abcroofing.com"
            />
          </section>

          {/* Company Details */}
          <section className="space-y-4">
            <h2 className="text-sm font-medium text-foreground">
              Company Details
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectField
                label="Company Type"
                value={form.company_type}
                onChange={(v) => updateField("company_type", v)}
                options={COMPANY_TYPES}
                placeholder="Select type..."
              />
              <Field
                label="Your Role"
                value={form.role}
                onChange={(v) => updateField("role", v)}
                placeholder="Owner, Operations Manager, etc."
              />
              <SelectField
                label="Approximate Monthly Claim Volume"
                value={form.monthly_claims}
                onChange={(v) => updateField("monthly_claims", v)}
                options={[
                  "1-10",
                  "11-25",
                  "26-50",
                  "51-100",
                  "100+",
                ]}
                placeholder="Select volume..."
              />
              <SelectField
                label="How did you hear about Atlas?"
                value={form.heard_about}
                onChange={(v) => updateField("heard_about", v)}
                options={HEARD_ABOUT}
                placeholder="Select..."
              />
            </div>
          </section>

          {/* Workflow */}
          <section className="space-y-4">
            <h2 className="text-sm font-medium text-foreground">
              Current Workflow
            </h2>
            <TextArea
              label="Current Claims/Supplement Workflow"
              value={form.current_workflow}
              onChange={(v) => updateField("current_workflow", v)}
              placeholder="Describe your current process for managing claims and supplements..."
              rows={3}
            />
            <TextArea
              label="Biggest Pain Point"
              value={form.biggest_pain}
              onChange={(v) => updateField("biggest_pain", v)}
              placeholder="What's the most frustrating part of your current workflow?"
              rows={2}
            />
            <TextArea
              label="Additional Notes"
              value={form.notes}
              onChange={(v) => updateField("notes", v)}
              placeholder="Anything else you'd like us to know..."
              rows={2}
            />
          </section>

          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={
                isSubmitting ||
                !form.full_name.trim() ||
                !form.company_name.trim() ||
                !form.email.trim()
              }
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Request Pilot Access
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate("/auth")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Already have access? Sign in
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

/* ── Tiny form primitives ──────────────────────────────────────────── */

function Field({
  label,
  type = "text",
  required,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
