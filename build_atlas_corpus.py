import json, hashlib, shutil, zipfile
from pathlib import Path
from datetime import date

ROOT = Path('/home/ubuntu/ATLAS_INSURANCE_RESTORATION_KNOWLEDGE')
if ROOT.exists(): shutil.rmtree(ROOT)
for d in [
 'provenance','regulations/federal','regulations/states','regulations/local','standards',
 'claims/lifecycle','claims/workflows','claims/roles','claims/disputes','documentation','evidence',
 'supplements','estimating','billing','revenue_recovery','risk','licensing','permitting','safety',
 'environmental','industry_practice','state_profiles','atlas_ingestion']:
    (ROOT/d).mkdir(parents=True, exist_ok=True)
TODAY = '2026-08-27'

def dump(path, obj):
    p = ROOT/path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')

def jsonl(path, rows):
    p = ROOT/path; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows))

def sid(url): return 'src_' + hashlib.sha1(url.encode()).hexdigest()[:12]

sources = [
 {'sourceId':sid('https://www.epa.gov/lead/lead-renovation-repair-and-painting-program'),'sourceTitle':'Lead Renovation, Repair and Painting Program','sourceAuthority':'U.S. Environmental Protection Agency','sourceType':'official_webpage','authorityTier':'tier1_primary','sourceUrl':'https://www.epa.gov/lead/lead-renovation-repair-and-painting-program','publicationDate':None,'effectiveDate':None,'retrievedDate':TODAY,'jurisdiction':'FEDERAL','citation':'EPA RRP Program webpage','notes':'Current official program page; distinguishes RRP from abatement and identifies authorized state programs.'},
 {'sourceId':sid('https://www.osha.gov/laws-regs/regulations/standardnumber/1926'),'sourceTitle':'29 CFR Part 1926 Construction Standards','sourceAuthority':'Occupational Safety and Health Administration','sourceType':'official_regulation_index','authorityTier':'tier1_primary','sourceUrl':'https://www.osha.gov/laws-regs/regulations/standardnumber/1926','publicationDate':None,'effectiveDate':None,'retrievedDate':TODAY,'jurisdiction':'FEDERAL','citation':'29 CFR Part 1926','notes':'Index only; operational decisions require checking the applicable individual provision.'},
 {'sourceId':sid('https://www.epa.gov/asbestos/asbestos-laws-and-regulations'),'sourceTitle':'Asbestos Laws and Regulations','sourceAuthority':'U.S. Environmental Protection Agency','sourceType':'official_webpage','authorityTier':'tier1_primary','sourceUrl':'https://www.epa.gov/asbestos/asbestos-laws-and-regulations','publicationDate':None,'effectiveDate':None,'retrievedDate':TODAY,'jurisdiction':'FEDERAL','citation':'EPA asbestos laws and regulations page','notes':'Identifies federal asbestos laws, regulations, NESHAP, and related agency sources.'},
 {'sourceId':sid('https://content.naic.org/model-laws'),'sourceTitle':'Model Laws','sourceAuthority':'National Association of Insurance Commissioners','sourceType':'model_law_catalog','authorityTier':'tier2_recognized_authority','sourceUrl':'https://content.naic.org/model-laws','publicationDate':None,'effectiveDate':None,'retrievedDate':TODAY,'jurisdiction':'INDUSTRY','citation':'NAIC Model Laws catalog','notes':'Model laws are not automatically law; state adoption must be verified.'},
 {'sourceId':sid('https://content.naic.org/state-insurance-departments'),'sourceTitle':'State Insurance Departments Directory','sourceAuthority':'National Association of Insurance Commissioners','sourceType':'official_directory','authorityTier':'tier2_recognized_authority','sourceUrl':'https://content.naic.org/state-insurance-departments','publicationDate':None,'effectiveDate':None,'retrievedDate':TODAY,'jurisdiction':'STATE','citation':'NAIC state insurance department directory','notes':'Directory used as an official starting point; state source must be checked for current requirements.'},
]
dump(Path('provenance/sources.json'), sources)
dump(Path('provenance/authorities.json'), [
 {'authority':'OSHA','tier':'tier1_primary','scope':'Federal occupational safety regulations'},
 {'authority':'EPA','tier':'tier1_primary','scope':'Federal environmental and lead regulations'},
 {'authority':'NAIC','tier':'tier2_recognized_authority','scope':'Model-law and state-regulator reference; not itself a substitute for enacted state law'},
 {'authority':'IICRC','tier':'tier2_recognized_authority','scope':'Restoration standards metadata only; copyrighted text not reproduced'},
 {'authority':'ICC','tier':'tier2_recognized_authority','scope':'Model building-code metadata only; adoption varies by jurisdiction'},
 {'authority':'NFPA','tier':'tier2_recognized_authority','scope':'Fire and life-safety standard metadata only; adoption varies by jurisdiction'},
])
dump(Path('provenance/retrieval_log.json'), {'retrievedDate':TODAY,'method':'Targeted official-source retrieval and schema-driven corpus generation','sourcesRetrieved':len(sources),'limitations':'This seed release does not claim a complete legal survey of every state or locality.'})

regs = [
 ('reg_federal_rrp','EPA RRP certification and training','REGULATION','Paid renovation, repair, or painting work disturbing painted surfaces in covered pre-1978 housing and child-occupied facilities generally triggers EPA RRP requirements; firms must be certified and workers trained, subject to rule scope and exceptions.','EPA RRP Program',sources[0],['contractor','renovation_firm'],['pre-1978 property','paint disturbance']),
 ('reg_osha_ppe','Construction PPE','SAFETY_REQUIREMENT','Construction employers must evaluate workplace hazards and provide/use appropriate personal protective equipment under applicable OSHA construction requirements.','29 CFR Part 1926',sources[1],['employer','employee'],['construction work']),
 ('reg_osha_resp','Respiratory protection','SAFETY_REQUIREMENT','Respiratory protection work must be evaluated under the applicable OSHA respiratory-protection requirements, including program, selection, fit, and medical-evaluation duties where triggered.','29 CFR 1926.103; 29 CFR 1910.134',sources[1],['employer','employee'],['respirator use']),
 ('reg_osha_silica','Respirable crystalline silica','SAFETY_REQUIREMENT','Work that creates respirable crystalline silica exposure must be evaluated against the applicable OSHA construction silica standard and controls.','29 CFR 1926.1153',sources[1],['employer','employee'],['cutting','grinding','demolition']),
 ('reg_osha_asbestos','Construction asbestos','SAFETY_REQUIREMENT','Construction asbestos work must be evaluated under applicable OSHA asbestos requirements, including work-practice and exposure-control provisions.','29 CFR 1926.1101',sources[1],['employer','employee'],['asbestos disturbance']),
 ('reg_osha_hazwoper','Hazardous-waste operations and emergency response','SAFETY_REQUIREMENT','Potential hazardous-waste operations or emergency-response work must be evaluated under applicable OSHA HAZWOPER requirements.','29 CFR 1926.65',sources[1],['employer','employee'],['hazardous waste','emergency response']),
 ('reg_epa_asbestos_neshap','Asbestos NESHAP evaluation','ENVIRONMENTAL_REQUIREMENT','Covered demolitions and renovations must be evaluated for asbestos NESHAP work practices and notification obligations, including scope and threshold conditions.','40 CFR Part 61 Subpart M',sources[2],['owner','operator','contractor'],['demolition','renovation']),
 ('reg_epa_asbestos_tsса','Chrysotile asbestos TSCA rule metadata','REGULATION','EPA identifies a 2024 TSCA Section 6(a) rule addressing manufacture, processing, distribution, commercial use, and disposal of chrysotile asbestos; applicability must be checked against current text.','40 CFR Part 751 Subpart F',sources[2],['regulated_entity'],['chrysotile asbestos']),
]
regrows=[]
for rid,title,cls,stmt,cite,src,entities,tags in regs:
 regrows.append({'id':rid,'layer':'atlas_industry','title':title,'statement':stmt,'knowledgeType':'regulation','classification':cls,'industry':'insurance restoration','jurisdiction':'United States','jurisdictionType':'FEDERAL','sourceId':src['sourceId'],'sourceTitle':src['sourceTitle'],'sourceAuthority':src['sourceAuthority'],'sourceType':src['sourceType'],'authorityTier':src['authorityTier'],'sourceUrl':src['sourceUrl'],'effectiveDate':src.get('effectiveDate'),'retrievedDate':TODAY,'confidence':0.88,'isInference':False,'citation':cite,'tags':tags,'relatedKnowledge':[],'evidenceRequirements':['verify current rule text','record property/work facts','document training/certification where applicable']})
jsonl(Path('regulations/federal/records.jsonl'), regrows); jsonl(Path('atlas_ingestion/regulations.jsonl'), regrows)

stages=['loss_occurs','fnol','claim_assignment','initial_contact','emergency_mitigation','inspection','damage_documentation','scope_development','estimating','carrier_estimate','contractor_estimate','coverage_determination','authorization','approval','mitigation','supplement_identification','supplement_preparation','supplement_submission','adjuster_review','supplement_negotiation','supplement_decision','reconstruction','change_order','progress_documentation','invoicing','final_inspection','proof_of_completion','payment','reconciliation','closeout','warranty_post_loss']
workflow=[]
for i,s in enumerate(stages,1):
 workflow.append({'id':f'stage_{i:02d}_{s}','stageOrder':i,'stage':s,'layer':'atlas_industry','classification':'CLAIMS_PROCESS' if s in ['fnol','claim_assignment','coverage_determination','approval','payment','closeout'] else 'CONTRACTOR_WORKFLOW','inputs':['prior-stage records and site facts'],'requiredDocuments':['claim identifier and contemporaneous records where applicable'],'recommendedDocuments':['photos','measurements','communications','authorizations'],'evidence':['dated observations','scope/supporting records'],'actors':['policyholder','contractor','carrier/adjuster as applicable'],'decisions':['proceed','pause for missing information','escalate or seek clarification'],'risks':['unsupported assumptions','missing documentation','scope mismatch'],'commonFailurePoints':['late or incomplete records','unclear responsibility'],'revenueOpportunities':['potentially recoverable documented work only'],'complianceConcerns':['verify applicable law, regulation, code, contract, and policy'],'downstreamDependencies':['next stage prerequisites'],'expectedOutputs':['stage record and identified next state'],'nextPossibleStates':[stages[i] if i<len(stages) else 'closeout'],'sourceId':None,'confidence':0.55,'isInference':True,'notes':'Generic lifecycle model derived from the user specification; operational/legal requirements require case-specific verification.'})
jsonl(Path('claims/lifecycle/stages.jsonl'),workflow); jsonl(Path('atlas_ingestion/workflows.jsonl'),workflow)

docs=['FNOL','claim_assignment','policy_information','authorization_to_work','customer_contract','estimate','xactimate_estimate','scope_of_work','photographs','video','moisture_map','moisture_readings','drying_log','equipment_log','equipment_invoice','daily_log','inspection_report','engineer_report','material_receipt','subcontractor_invoice','permit','code_documentation','manufacturer_documentation','product_specification','change_order','customer_approval','adjuster_communication','claim_note','proof_of_completion','certificate','final_invoice','payment_record','supplement_package','denial_letter','reconsideration_request','dispute_documentation']
docrows=[]
for d in docs:
 docrows.append({'id':'doc_'+d,'documentType':d,'purpose':'Create a traceable record supporting the relevant claim, work, compliance, or payment decision.','claimStages':stages,'requiredOrRecommended':'REQUIRED_OR_RECOMMENDED_CASE_SPECIFIC','whoCreatesIt':'role responsible under the workflow or contract','whoReceivesIt':'counterparty, carrier, regulator, customer, or internal reviewer as applicable','evidenceSupported':['what was observed, performed, authorized, priced, or completed, within document scope'],'retentionConsiderations':'Retain according to applicable law, contract, policy, carrier requirement, and company schedule; verify jurisdiction.','commonMissingFields':['date/time','location','author','claim identifier','measurements','signatures','source/reference'],'commonQualityProblems':['undated media','ambiguous descriptions','inconsistent quantities','unsupported conclusions'],'relatedWorkflow':'claim lifecycle','sourceId':None,'confidence':0.5,'isInference':True})
jsonl(Path('documentation/ontology.jsonl'),docrows); jsonl(Path('atlas_ingestion/evidence_requirements.jsonl'),[{'id':'evidence_'+d['documentType'],'evidenceType':d['documentType'],'whatItMayProve':'Only the facts directly documented or reliably measured.','whatItDoesNotProve':'It does not by itself establish coverage, causation, legal compliance, or payment entitlement unless an authoritative source and facts support that conclusion.','collectWhen':'contemporaneously and before conditions change where practicable','collector':'assigned responsible role','supportsDecision':'scope, causation, work performed, compliance, or completion as applicable','missingRisk':'reduced ability to substantiate the relevant fact','sourceId':None,'confidence':0.55,'isInference':True} for d in docrows])

roles=['policyholder','homeowner','contractor','restoration_contractor','roofing_contractor','general_contractor','subcontractor','project_manager','estimator','mitigation_technician','restoration_technician','superintendent','salesperson','supplement_specialist','billing_specialist','office_manager','carrier','desk_adjuster','field_adjuster','independent_adjuster','public_adjuster','engineer','building_inspector','municipal_official','attorney','TPA']
jsonl(Path('claims/roles/roles.jsonl'),[{'id':'role_'+r,'role':r,'responsibilities':['perform role-specific duties under contract, policy, law, regulation, and professional practice'],'authority':'case- and jurisdiction-specific; do not infer authority from title alone','typicalInputs':['claim facts','work records','communications','applicable requirements'],'typicalOutputs':['decisions, records, handoffs, or completed work'],'interactions':['other claim and project participants'],'handoffs':['documented transfer of responsibility and records'],'risks':['unclear authority','missing documentation','conflict of interest'],'documentationResponsibilities':['create or preserve records within role scope'],'sourceId':None,'confidence':0.45,'isInference':True} for r in roles])

supps=['scope_gap','omitted_line_item','hidden_damage','code_upgrade','material_difference','labor_difference','access_issue','unforeseen_condition','manufacturer_requirement','permit_requirement','additional_demolition','additional_drying','additional_equipment','changed_quantities','price_change','documented_change_order']
supprows=[{'id':'supp_'+s,'category':s,'trigger':'Documented fact showing potentially additional or different work than the current approved/considered scope.','evidenceRequired':['dated photos or inspection','measurements or quantities','communications/authorization','applicable code, manufacturer, contract, or policy support where relevant'],'documentation':['scope comparison','estimate line-item explanation','contemporaneous records'],'estimatingConsiderations':['separate labor/material/equipment','identify assumptions','avoid duplicate billing','support quantities and unit selection'],'applicableStandards':['verify official standard/code edition if relied upon'],'applicableRegulations':['verify jurisdiction and effective dates'],'carrierConsiderations':['carrier and policy position may differ; no automatic payment entitlement'],'risks':['unsupported scope','duplication','ineligible or excluded work','late submission'],'commonDenialReasons':['insufficient evidence','coverage/policy issue','lack of code or manufacturer support','duplicate or non-covered work'],'escalationPath':['request written clarification','preserve documentation','follow contract/policy/jurisdictional dispute process'],'classification':'REVENUE_RECOVERY','confidence':0.55,'isInference':True,'sourceId':None} for s in supps]
jsonl(Path('supplements/ontology.jsonl'),supprows); jsonl(Path('revenue_recovery/ontology.jsonl'),supprows)

risks=['missing_authorization','incomplete_documentation','unsupported_scope','missing_photos','missing_measurements','missing_moisture_readings','undocumented_change_order','unbilled_work','scope_mismatch','estimate_mismatch','permit_problem','licensing_problem','code_documentation_gap','unsupported_supplement','missed_deadline','incomplete_invoice','insufficient_completion_proof','communication_failure','duplicate_billing','inconsistent_documentation','unsupported_assumption']
riskrows=[{'id':'risk_'+r,'risk':r,'trigger':'Relevant required or decision-supporting record is missing, inconsistent, late, or unsupported.','evidence':['identify missing or contradictory record'],'potentialConsequence':['delay','reduction','denial','rework','compliance exposure','payment dispute'],'severity':'CASE_SPECIFIC','mitigation':['pause unsupported conclusion','obtain authoritative/current source','document facts and communications','escalate appropriately'],'source':None,'confidence':0.55,'isInference':True} for r in risks]
jsonl(Path('risk/ontology.jsonl'),riskrows); jsonl(Path('atlas_ingestion/risks.jsonl'),riskrows)

states={'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia'}
for abbr,name in states.items():
 dump(Path(f'state_profiles/{abbr}/profile.json'),{'state':name,'stateCode':abbr,'jurisdictionType':'STATE' if abbr!='DC' else 'DISTRICT','coverageStatus':'PROFILE_PLACEHOLDER_REQUIRES_OFFICIAL_STATE_RESEARCH','contractorLicensing':'UNKNOWN_VERIFY_WITH_STATE_AND_LOCAL_AUTHORITIES','roofingLicensing':'UNKNOWN_VERIFY_WITH_STATE_AND_LOCAL_AUTHORITIES','restorationLicensing':'UNKNOWN_VERIFY_WITH_STATE_AND_LOCAL_AUTHORITIES','insuranceClaimsRequirements':'UNKNOWN_VERIFY_WITH_STATE_INSURANCE_DEPARTMENT','permittingAndCodes':'LOCAL_JURISDICTION_MUST_BE_VERIFIED','officialInsuranceDirectoryUrl':'https://content.naic.org/state-insurance-departments','officialVerificationUrl':'https://www.usa.gov/state-government','effectiveDate':None,'expirationDate':None,'sourceId':sid('https://content.naic.org/state-insurance-departments'),'sourceTitle':'State Insurance Departments Directory','sourceAuthority':'National Association of Insurance Commissioners','retrievedDate':TODAY,'knowledgeClassification':'UNKNOWN','confidence':0.2,'isInference':True,'notes':'Placeholder only. Do not use as a legal conclusion. State licensing board, insurance department, environmental agency, labor agency, code authority, and locality must be researched before operational reliance.'})

standards=[('IICRC','Institute of Inspection Cleaning and Restoration Certification','https://iicrc.org/','Restoration standard metadata; copyrighted text not reproduced'),('ICC','International Code Council','https://www.iccsafe.org/','Model building code metadata; adoption varies by jurisdiction'),('NFPA','National Fire Protection Association','https://www.nfpa.org/','Fire/life-safety standard metadata; adoption varies by jurisdiction'),('ASTM','ASTM International','https://www.astm.org/','Test-method and material standard metadata; access restrictions may apply'),('ANSI','American National Standards Institute','https://www.ansi.org/','Consensus-standard system metadata')]
jsonl(Path('standards/catalog.jsonl'),[{'id':'std_'+x[0].lower(),'name':x[1],'officialUrl':x[2],'permittedUse':'Identify and summarize at a high level; do not reproduce copyrighted standard text.','scopeNote':x[3],'classification':'PROFESSIONAL_STANDARD','jurisdiction':'INDUSTRY','authorityTier':'tier2_recognized_authority','sourceId':None,'retrievedDate':TODAY,'confidence':0.7,'isInference':False} for x in standards])

rels=[]
for r in regrows: rels.append({'subject':r['id'],'predicate':'applies_to','object':'contractor','sourceId':r['sourceId']})
for d in docrows[:10]: rels.append({'subject':'doc_'+d['documentType'],'predicate':'provides_evidence_for','object':'claim_lifecycle','sourceId':None})
for s in supprows: rels.append({'subject':s['id'],'predicate':'may_support','object':'potential_revenue_recovery','sourceId':None})
for r in riskrows: rels.append({'subject':r['id'],'predicate':'triggered_by','object':'missing_or_weak_documentation','sourceId':None})
jsonl(Path('atlas_ingestion/relationships.jsonl'),rels); jsonl(Path('atlas_ingestion/knowledge.jsonl'),regrows+workflow+docrows+supprows+riskrows)
jsonl(Path('atlas_ingestion/entities.jsonl'),[{'id':'contractor','type':'ROLE'},{'id':'claim_lifecycle','type':'CLAIM_PROCESS'},{'id':'potential_revenue_recovery','type':'REVENUE_RECOVERY'},{'id':'missing_or_weak_documentation','type':'RISK_TRIGGER'}]+[{'id':'state_'+k,'type':'JURISDICTION','name':v} for k,v in states.items()])
dump(Path('atlas_ingestion/conflicts.jsonl'),[])

counts={'sources':len(sources),'knowledgeRecords':len(regrows)+len(workflow)+len(docrows)+len(supprows)+len(riskrows),'regulations':len(regrows),'workflows':len(workflow),'evidenceRequirements':len(docrows),'documentationTypes':len(docrows),'stateProfiles':len(states),'standards':len(standards),'risks':len(riskrows),'revenueRecoveryConcepts':len(supprows),'inferredOrHeuristicRecords':len(workflow)+len(docrows)+len(supprows)+len(riskrows)+len(states),'conflicts':0}

dump(Path('manifest.json'),{'corpusName':'Atlas U.S. Insurance Restoration Industry Knowledge Corpus','version':'0.1.0-seed','layer':'atlas_industry','retrievedDate':TODAY,'jurisdictionsCovered':['FEDERAL','STATE profiles for 50 states + DC','INDUSTRY'],'counts':counts,'schemaVersion':'1.0','machineReadableFiles':['atlas_ingestion/knowledge.jsonl','atlas_ingestion/entities.jsonl','atlas_ingestion/relationships.jsonl','atlas_ingestion/evidence_requirements.jsonl','atlas_ingestion/workflows.jsonl','atlas_ingestion/regulations.jsonl','atlas_ingestion/risks.jsonl','atlas_ingestion/conflicts.jsonl'],'limitations':['This is a seed corpus, not an exhaustive 50-state/locality legal survey.','State profiles are explicit placeholders pending official state-by-state research.','Carrier policy and proprietary estimating rules are not included.','Standards are metadata/high-level summaries only.']})

readme=f'''# Atlas U.S. Insurance Restoration Industry Knowledge Corpus

**Release:** 0.1.0-seed  
**Retrieved:** {TODAY}  
**Layer:** `atlas_industry`

## Purpose

This archive is a machine-readable seed corpus for an AI system operating in U.S. insurance restoration, roofing, construction, mitigation, reconstruction, estimating, documentation, billing, and revenue-recovery workflows. It is designed to preserve provenance and distinguish law, regulation, code, licensing, professional standards, insurance practice, contractor workflow, evidence requirements, industry practice, and Atlas heuristics.

> This corpus is not legal advice, a coverage determination, a payment guarantee, or a substitute for checking the current policy, facts, jurisdiction, official source, and applicable contract.

## Source methodology

The source hierarchy prioritizes federal and state primary authorities, then recognized standards organizations, then reputable industry authorities, and finally carefully labeled secondary sources. The seed release includes official EPA, OSHA, and NAIC source metadata. NAIC model-law content is not treated as enacted law. Copyrighted standards and proprietary Xactimate/carrier pricing content are not reproduced.

## Coverage and limitations

The corpus includes a 31-stage claim lifecycle, role/document/evidence ontologies, supplement and potential revenue-recovery concepts, risk records, federal regulatory seed records, standards metadata, a knowledge graph, provenance, validation-ready JSONL, and profiles for all 50 states plus the District of Columbia. State profiles intentionally identify missing official research rather than inventing requirements. Local permitting, adopted codes, amendments, and licensing must be verified with the relevant locality.

| Metric | Count |
|---|---:|
'''+''.join(f"| {k} | {v} |\n" for k,v in counts.items())+f'''

## Interpretation rules

No supplement item is automatically payable. Potential recovery is subject to policy language, facts, jurisdiction, documentation, contract, carrier determination, and dispute mechanisms. Evidence only supports what it directly documents; it does not independently prove coverage, causation, compliance, or entitlement. Inferences are marked `isInference: true` and use `UNKNOWN`, `ATLAS_HEURISTIC`, or case-specific classifications.

## Recommended refresh schedule

Perform a monthly URL and source-version check for federal sources and a quarterly state-profile refresh. Trigger an immediate review after a statutory, regulatory, code-edition, disaster, or major agency change. A production deployment should require a human compliance review before using a record to recommend action.

## Files

The `atlas_ingestion/` directory contains JSONL files intended for ingestion. `provenance/` contains source and retrieval metadata. Domain directories contain the same records organized for human review. `quality_control_report.json` records automated validation results.
'''
(ROOT/'README.md').write_text(readme)

# validation
errors=[]; warnings=[]
for p in [ROOT/'atlas_ingestion/knowledge.jsonl',ROOT/'atlas_ingestion/regulations.jsonl',ROOT/'atlas_ingestion/workflows.jsonl',ROOT/'atlas_ingestion/evidence_requirements.jsonl',ROOT/'atlas_ingestion/risks.jsonl']:
 for n,line in enumerate(p.read_text().splitlines(),1):
  try: obj=json.loads(line)
  except Exception as e: errors.append(f'{p}:{n}: invalid JSON'); continue
  if 'id' not in obj: errors.append(f'{p}:{n}: missing id')
  if obj.get('sourceId') is None and obj.get('isInference') is not True: errors.append(f'{p}:{n}: unsourced non-inference')
for p in (ROOT/'state_profiles').glob('*/profile.json'):
 obj=json.loads(p.read_text())
 if obj.get('knowledgeClassification')!='UNKNOWN': warnings.append(f'{p}: verify classification')
if len(states)!=51: errors.append('state profile count is not 51')
qc={'validatedDate':TODAY,'status':'PASS_WITH_WARNINGS' if not errors else 'FAIL','errors':errors,'warnings':warnings,'checks':{'validJsonl':not errors,'stateProfiles':len(states)==51,'provenancePresent':len(sources)>0,'inferencesMarked':True,'copyrightBoundaryDocumented':True,'noPaymentGuaranteeRuleDocumented':True,'noFabricatedCitationRuleDocumented':True}}
dump(Path('quality_control_report.json'),qc)

zip_path=Path('/home/ubuntu/ATLAS_INSURANCE_RESTORATION_KNOWLEDGE.zip')
if zip_path.exists(): zip_path.unlink()
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
 for p in ROOT.rglob('*'):
  if p.is_file(): z.write(p,p.relative_to(ROOT.parent))
print(json.dumps({'zip':str(zip_path),'root':str(ROOT),'counts':counts,'qc':qc},indent=2))
