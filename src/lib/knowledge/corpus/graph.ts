// ---------------------------------------------------------------------------
// Atlas Knowledge Corpus — Knowledge Graph Relationships
//
// Defines semantic relationships between knowledge records for the
// Evidence Graph. Relationships must reference valid entity IDs.
// ---------------------------------------------------------------------------

import type { CorpusGraphEdge } from "./manifest";

/** ~40 graph relationships connecting regulation, workflow, evidence, and risk. */
export const GRAPH_RELATIONSHIPS: CorpusGraphEdge[] = [
  // === Regulation → Jurisdiction ===
  { sourceId: "fed_osha_fall_protection", targetId: "jur_ca", relationship: "REGULATION_APPLIES_TO" },
  { sourceId: "fed_osha_fall_protection", targetId: "jur_tx", relationship: "REGULATION_APPLIES_TO" },
  { sourceId: "fed_osha_fall_protection", targetId: "jur_fl", relationship: "REGULATION_APPLIES_TO" },
  { sourceId: "fed_epa_lead_rrp", targetId: "jur_ny", relationship: "REGULATION_APPLIES_TO" },
  { sourceId: "fed_epa_lead_rrp", targetId: "jur_il", relationship: "REGULATION_APPLIES_TO" },
  { sourceId: "fed_epa_lead_rrp", targetId: "jur_pa", relationship: "REGULATION_APPLIES_TO" },

  // === Regulation → Workflow ===
  { sourceId: "fed_osha_fall_protection", targetId: "wf_reconstruction", relationship: "REGULATION_GOVERNS" },
  { sourceId: "fed_osha_hazard_communication", targetId: "wf_mitigation_execution", relationship: "REGULATION_GOVERNS" },
  { sourceId: "fed_osha_respiratory_protection", targetId: "wf_mitigation_execution", relationship: "REGULATION_GOVERNS" },
  { sourceId: "fed_epa_lead_rrp", targetId: "wf_demolition", relationship: "REGULATION_GOVERNS" },
  { sourceId: "fed_epa_asbestos", targetId: "wf_demolition", relationship: "REGULATION_GOVERNS" },
  { sourceId: "fed_fema_flood_insurance", targetId: "wf_fnol_filing", relationship: "REGULATION_GOVERNS" },
  { sourceId: "fed_osha_electrical_safety", targetId: "wf_mitigation_execution", relationship: "REGULATION_GOVERNS" },

  // === Regulation → Standard ===
  { sourceId: "fed_osha_fall_protection", targetId: "std_iicrc_s500", relationship: "REGULATION_CITES" },

  // === Standard → Workflow ===
  { sourceId: "std_iicrc_s500", targetId: "wf_mitigation_execution", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "std_iicrc_s520", targetId: "wf_mitigation_execution", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "std_iicrc_s530", targetId: "wf_reconstruction", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "std_irc_building", targetId: "wf_code_compliance_assessment", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "std_irc_building", targetId: "wf_permit_acquisition", relationship: "WORKFLOW_REQUIRES" },

  // === Workflow → Evidence ===
  { sourceId: "wf_fnol_filing", targetId: "doc_fnol_loss_report", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_fnol_filing", targetId: "doc_fnol_policy_info", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_fnol_filing", targetId: "doc_fnol_initial_photos", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_site_inspection", targetId: "doc_inspection_photos", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_site_inspection", targetId: "doc_inspection_moisture", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_initial_estimate", targetId: "doc_estimate_xactimate", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_initial_estimate", targetId: "doc_estimate_scope_of_work", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_mitigation_execution", targetId: "doc_mitigation_drying_log", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_mitigation_execution", targetId: "doc_mitigation_equipment_invoices", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_reconstruction", targetId: "doc_recon_permits", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_reconstruction", targetId: "doc_recon_change_orders", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_supplement_documentation", targetId: "doc_supplement_line_comparison", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_supplement_submission", targetId: "doc_supplement_cover_letter", relationship: "WORKFLOW_REQUIRES" },
  { sourceId: "wf_final_invoice", targetId: "doc_financial_final_invoice", relationship: "WORKFLOW_REQUIRES" },

  // === Workflow transitions ===
  { sourceId: "wf_fnol_filing", targetId: "wf_initial_contact", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_initial_contact", targetId: "wf_emergency_mitigation_dispatch", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_site_inspection", targetId: "wf_adjuster_meeting", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_adjuster_meeting", targetId: "wf_initial_estimate", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_initial_estimate", targetId: "wf_authorization", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_authorization", targetId: "wf_mitigation_execution", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_mitigation_execution", targetId: "wf_demolition", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_demolition", targetId: "wf_reconstruction", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_reconstruction", targetId: "wf_final_inspection", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_final_inspection", targetId: "wf_supplement_identification", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_final_inspection", targetId: "wf_estimate_reconciliation", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_estimate_reconciliation", targetId: "wf_final_invoice", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_final_invoice", targetId: "wf_payment_processing", relationship: "WORKFLOW_TRANSITIONS_TO" },
  { sourceId: "wf_payment_processing", targetId: "wf_job_closeout", relationship: "WORKFLOW_TRANSITIONS_TO" },

  // === Risk → Missing Evidence ===
  { sourceId: "risk_no_mitigation_docs", targetId: "doc_mitigation_drying_log", relationship: "RISK_CAUSED_BY" },
  { sourceId: "risk_incomplete_photos", targetId: "doc_inspection_photos", relationship: "RISK_CAUSED_BY" },
  { sourceId: "risk_no_change_orders", targetId: "doc_recon_change_orders", relationship: "RISK_CAUSED_BY" },

  // === Risk → Workflow trigger ===
  { sourceId: "risk_hidden_damage", targetId: "wf_supplement_identification", relationship: "MISSING_EVIDENCE_TRIGGERS" },
  { sourceId: "risk_scope_gap", targetId: "wf_supplement_identification", relationship: "MISSING_EVIDENCE_TRIGGERS" },

  // === Revenue → Supplement ===
  { sourceId: "rev_scope_gap_recovery", targetId: "wf_supplement_documentation", relationship: "SUPPLEMENT_AFFECTS" },
  { sourceId: "rev_code_upgrade", targetId: "wf_code_upgrade_supplement", relationship: "SUPPLEMENT_AFFECTS" },
  { sourceId: "rev_hidden_damage", targetId: "wf_supplement_identification", relationship: "SUPPLEMENT_AFFECTS" },
  { sourceId: "rev_change_order_capture", targetId: "wf_change_order_tracking", relationship: "SUPPLEMENT_AFFECTS" },
];
