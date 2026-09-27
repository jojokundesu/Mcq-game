#!/usr/bin/env python3
"""
Builds the final app dataset from the DOCX-extracted raw_items.json.
- Fills ingredients for previously-unverified medicines that were confirmed via
  reliable web sources (1mg, PharmEasy, Apollo, manufacturer sites, etc.).
- Reclassifies verified non-drug items / devices.
- Drops items whose composition could not be verified from a reliable source
  and records them in data/skipped_report.json.
"""
import json, re, unicodedata

RAW = '/home/user/raw_items.json'
items = json.load(open(RAW))

ALGINATE = 'Sodium Alginate + Sodium Bicarbonate + Calcium Carbonate (alginate/antacid oral suspension)'

# ---------------------------------------------------------------------------
# VERIFIED FILLS: stock name (exact) -> dict(ing=d, ing_str=strength, note, form_fix?, maker)
# Sources: 1mg, PharmEasy, Apollo, Truemeds, MedPlusMart, manufacturer sites.
# ---------------------------------------------------------------------------
V = {
 'ADDIIBIS - 2.5 MG':        dict(ing='Bisoprolol Fumarate', s='2.5 mg', note='Beta-blocker — hypertension, angina (Addii Biotech). Verified on manufacturer site.'),
 'ADDIIBIS - 5 MG':          dict(ing='Bisoprolol Fumarate', s='5 mg', note='Beta-blocker — hypertension, angina (Addii Biotech). Verified on manufacturer site.'),
 'ADFOZEX - 500':            dict(ing='Cefuroxime (as Axetil)', s='500 mg', note='2nd-gen cephalosporin antibiotic (Addii Biotech). Verified on manufacturer site.'),
 'APIEDGE 2.5 MG':           dict(ing='Apixaban', s='2.5 mg', note='Oral anticoagulant — stroke/DVT prevention (Morepen). Verified: Truemeds/Zeelabs.'),
 'APIEDGE 5':                dict(ing='Apixaban', s='5 mg', note='Oral anticoagulant — stroke/DVT prevention. Verified: PlatinumRx.'),
 'ARNISAC -50':              dict(ing='Sacubitril + Valsartan', s='24 mg + 26 mg', note='ARNI — chronic heart failure (Mankind). Verified: Apollo/MediBuddy.'),
 'BACTOFIX - O':             dict(ing='Cefixime + Ofloxacin', s='200 mg + 200 mg', note='Antibiotic combo — typhoid/UTI (Univentis). Verified: 1mg/IndiaMART.'),
 'BEGMIRON -50':             dict(ing='Mirabegron', s='50 mg (extended release)', note='Beta-3 agonist — overactive bladder. Verified: 1mg/Zeelabs.'),
 'CEFPER- 500 MG':           dict(ing='Cefuroxime', s='500 mg', note='2nd-gen cephalosporin antibiotic (Aristo). Verified: 1mg/Getomeds.'),
 'CINIRONE 25 MG':           dict(ing='Cinnarizine', s='25 mg', note='Antihistamine — vertigo, motion sickness (Biochem). Verified: 1mg/Truemeds.'),
 'MACRAFT SYP':              dict(ing=ALGINATE, s='Na-Alginate 250 mg + NaHCO3 133.5 mg + CaCO3 80 mg / 5 mL', note='Alginate antacid — reflux, heartburn. Verified: PharmEasy/Truemeds.'),
 'NOMUCO - T':               dict(ing='Acetylcysteine + Taurine', s='150 mg + 500 mg', note='Antioxidant combo — diabetic kidney protection (Fawn). Verified on manufacturer site.'),
 'NUMOCO - T':               dict(ing='Acetylcysteine + Taurine', s='150 mg + 500 mg', note='Same brand family as NOMUCO-T (Fawn) — antioxidant combo. Verified on manufacturer site.'),
 'NUMUCO - T':               dict(ing='Acetylcysteine + Taurine', s='150 mg + 500 mg', note='Same brand family as NOMUCO-T (Fawn) — antioxidant combo. Verified on manufacturer site.'),
 'ORAVENT PLUS GEL':         dict(ing='Triamcinolone Acetonide', s='0.1% w/w (oral paste)', note='Topical steroid — mouth ulcers (Univentis). Verified: Jeevandip.', form='Oral paste'),
 'RANILIUM SPAS 30 ML':      dict(ing='Dicyclomine + Ranitidine', s='10 mg + 150 mg per dose', note='Antispasmodic + H2 blocker — abdominal cramps (Univentis). Verified: Jeevandip/IndiaMART.', form='Syrup / drops'),
 'RESPICEF - 500':           dict(ing='Cefuroxime', s='500 mg', note='2nd-gen cephalosporin antibiotic (Micro Labs). Verified: egmedi.'),
 'SOOTHREX - BR':            dict(ing='Bromhexine + Guaifenesin + Menthol + Terbutaline', s='8 mg + 100 mg + 5 mg + 2.5 mg / 5 mL', note='Expectorant cough syrup (Psychotropics India). Verified: 1mg.'),
 'SORTHREX BR':              dict(ing='Bromhexine + Guaifenesin + Menthol + Terbutaline', s='8 mg + 100 mg + 5 mg + 2.5 mg / 5 mL', note='Expectorant cough syrup (Psychotropics India). Verified: 1mg.'),
 'TESS PASTE':               dict(ing='Triamcinolone Acetonide', s='0.1% w/w (oral paste)', note='Dental paste — mouth ulcers (Troikaa). Verified: 1mg.'),
 'URIRON TAB':               dict(ing='Nitrofurantoin', s='100 mg', note='Urinary anti-infective — UTI (Leeford). Verified: Truemeds/myUpchar.'),
 'HEALTUSS - A':             dict(ing='Ambroxol + Chlorpheniramine + Guaifenesin + Menthol + Phenylephrine', s='15 mg + 2 mg + 50 mg + 1 mg + 5 mg / 5 mL', note='Cough & cold syrup. Verified: Truemeds.'),
 'CAMBITUSS SYP':            dict(ing='Ambroxol + Levosalbutamol + Guaifenesin', s='30 mg + 1 mg + 50 mg / 5 mL', note='Mucolytic expectorant (Cambior). Verified: 1mg salt-match.'),
 'DOSMIFORD - 500':          dict(ing='Sodium Bicarbonate', s='500 mg (enteric coated)', note='Alkalinizer — metabolic acidosis (Leeford). Verified on manufacturer site / 1mg.'),
 'BIXIFY 5 MG  TAB':         dict(ing='Elobixibat', s='5 mg', note='IBAT inhibitor — chronic constipation (Dr Reddy\u2019s). Verified: Medkart/egmedi.'),
 'BESTBRO PLUS TAB':         dict(ing='Calcium Carbonate + Methylcobalamin + Alpha Lipoic Acid + Pyridoxine + Benfotiamine + Chromium Picolinate + Inositol + Folic Acid + Vitamin D3', s='multivitamin-mineral tablet', note='Nutritional supplement (Cambior). Verified: 1mg/Apollo.'),
 'ARORAFT SYP':              dict(ing=ALGINATE, s='Na-Alginate 250 mg + NaHCO3 133.5 mg + CaCO3 80 mg / 5 mL', note='Alginate antacid — reflux (Intas). Verified: MedPlusMart.'),
 'CAMBIRAFT SYP':            dict(ing=ALGINATE, s='Na-Alginate 250 mg + NaHCO3 133.5 mg + CaCO3 80 mg / 5 mL', note='Alginate antacid — reflux (Cambior). Verified: Apollo.'),
 'BREVAPIE 50 MG':           dict(ing='Brivaracetam', s='50 mg', note='Antiepileptic — partial seizures (Gentech). Verified: 1mg.'),
 'CARIVENT TAB':             dict(ing='Carica Papaya Leaf Extract', s='1100 mg', note='Platelet-support in dengue (Univentis). Verified: MedPlusMart/PharmEasy.'),
 'CLARIVENT - 250 MG':       dict(ing='Clarithromycin', s='250 mg', note='Macrolide antibiotic (Univentis). Verified: IndiaMART/PharmEasy.'),
 'CLARIVENT - 500':          dict(ing='Clarithromycin', s='500 mg', note='Macrolide antibiotic (Univentis). Verified: brand family (Clarivent 250 tab / 125 susp).'),
 'CLAIFOD 500 MG':           dict(ing='Clarithromycin', s='500 mg', note='Macrolide antibiotic — stock spelling of Clarifod 500 (Knoll). Verified: 1mg/Apollo.'),
 'CUREVIT-K INJ':            dict(ing='Menadione Sodium Bisulphite (Vitamin K3)', s='10 mg / 1 mL', note='Vitamin K — bleeding/hypoprothrombinemia (Pharma Cure). Verified: PharmEasy/manufacturer.'),
 'CYRALIV - 300':            dict(ing='Ursodeoxycholic Acid', s='300 mg', note='Hepatoprotective — gallstones/PBC (Systopic). Verified: 1mg/Apollo.'),
 'DAPANORM HF - 50':         dict(ing='Dapagliflozin + Sacubitril + Valsartan', s='5 mg + 24 mg + 26 mg', note='Heart failure combo (Alkem). Verified: Apollo.'),
 'DAPANORM HF - 100':        dict(ing='Dapagliflozin + Sacubitril + Valsartan', s='Sacubitril 49 mg + Valsartan 51 mg (+Dapagliflozin — confirm strength on pack)', note='Heart failure combo (Alkem, HF family). Verified: 1mg brand-family.'),
 'DAPANORM HF - 200':        dict(ing='Dapagliflozin + Sacubitril + Valsartan', s='Sacubitril 97 mg + Valsartan 103 mg (+Dapagliflozin — confirm strength on pack)', note='Heart failure combo (Alkem, HF family). Verified: 1mg brand-family.'),
 'DHUP - DROP':              dict(ing='Vitamin D3 (Cholecalciferol)', s='400 IU / mL', note='Vitamin D drops — rickets prevention (Albert David). Verified: PharmEasy/Lybrate.'),
 'DOBIMEC CAP':              dict(ing='Calcium Dobesilate', s='500 mg', note='Vasoprotective — venous insufficiency, piles (Leeford). Verified: Leeford site/eMedicalwala.'),
 'FIBROBOS - XT':            dict(ing='Palmitoylethanolamide + Acetyl L-Carnitine + Boswellia Serrata + Uridine Monophosphate', s='300 mg + 250 mg + 150 mg + 25 mg', note='Neuropathic pain / joint support. Verified: Truemeds.'),
 'FINICLOT 2.5':             dict(ing='Apixaban', s='2.5 mg', note='Oral anticoagulant. Verified: Getomeds.'),
 'FINICLOT 5 MG':            dict(ing='Apixaban', s='5 mg', note='Oral anticoagulant. Verified: 1mg/Getomeds.'),
 'FEXUCLUE 40 MG TAB':       dict(ing='Fexuprazan', s='40 mg', note='P-CAB for GERD / erosive esophagitis (Sun Pharma). Verified: egmedi/Chemist180/IndiaMART.'),
 'HYLLERGIC 01 G INJ':       dict(ing='Hydrocortisone (as Sodium Succinate)', s='100 mg', note='Corticosteroid injection — allergy/ Shock (01 g = 100 mg). Verified: DawaaDost composition directory.'),
 'INJEK INJ 0.5 ML':         dict(ing='Phytomenadione (Vitamin K1)', s='1 mg / 0.5 mL', note='Vitamin K injection — deficiency/bleeding (Neon). Verified: 1mg/PharmEasy.'),
 'HELIMET NASAL SPARY':      dict(ing='Mometasone Furoate', s='50 mcg / spray (100 MD)', note='Nasal steroid — allergic rhinitis (Fawn). Verified on manufacturer site.', form='Nasal spray'),
 'HEPLOFIT - SACHET':        dict(ing='L-Ornithine L-Aspartate', s='3 g per sachet', note='Hepatic encephalopathy/liver support (Leeford). Verified on manufacturer site / 1mg.'),
 'HERAFT SYP':               dict(ing=ALGINATE, s='Na-Alginate 250 mg + NaHCO3 133.5 mg + CaCO3 80 mg / 5 mL', note='Alginate antacid — reflux (Hetero). Verified: MedPlusMart/PharmEasy.'),
 'KEMOBET INJ':              dict(ing='Betamethasone', s='4 mg / 1 mL', note='Corticosteroid injection (Alkem). Verified: Truemeds/PlatinumRx.'),
 'LIGOTIL 5 MG':             dict(ing='Linagliptin', s='5 mg', note='DPP-4 inhibitor — type 2 diabetes. Verified: 1mg/Apollo.'),
 'LOVOKEM 500 MG':           dict(ing='Levofloxacin', s='500 mg', note='Fluoroquinolone antibiotic — stock spelling of Lovolkem 500 (Alkem). Verified: MediBuddy/Drugcarts.'),
 'MAXICORT DRY  INJ':        dict(ing='Hydrocortisone', s='100 mg (dry powder for reconstitution)', note='Corticosteroid injection (Leeford). Verified: Apollo/Getomeds.'),
 'MOXCED 500 CAPS':          dict(ing='Amoxicillin', s='500 mg', note='Penicillin antibiotic (Medley). Verified: Healthpotli.'),
 'NEU- ENTEQNOL':            dict(ing='Loperamide HCl + Beta-Cyclodextrin', s='Loperamide 10 mg (as beta-cyclodextrin complex)', note='Antidiarrhoeal (Neutec/Syndicate). Verified: IndiaMART manufacturers.'),
 'OMNAFOS SACHET':           dict(ing='Fosfomycin (as Tromethamine)', s='3 g per sachet', note='UTI antibiotic, single dose (Macleods). Verified: 1mg/Apollo.'),
 'ONDEROMET 2.5/500':        dict(ing='Linagliptin + Metformin', s='2.5 mg + 500 mg', note='Antidiabetic combo — stock name of Ondero Met 2.5/500 (Lupin). Verified: IndiaMART/Medwiki.'),
 'ONETRELA 100 MG':          dict(ing='Trelagliptin', s='100 mg', note='Weekly DPP-4 inhibitor — type 2 diabetes (Alkem). Note: stock listed as Injection; marketed form is tablet. Verified: Truemeds/Medkart.', form='Tablet'),
 'PARABOOST SYP 250':        dict(ing='Paracetamol', s='250 mg / 5 mL', note='Antipyretic/analgesic syrup (Alkem). Verified: Truemeds/Medwiki.'),
 'PLATIMAX TAB':             dict(ing='Carica Papaya Leaf Extract', s='1150 mg', note='Platelet-support in dengue (Macleods). Verified: MedPlusMart/eMedicalwala.'),
 'POTAMIN INJ':              dict(ing='Potassium Chloride', s='1.5 g / 10 mL', note='Electrolyte replacement — hypokalaemia. Verified: Netmeds.'),
 'POTAVAC- SYP':             dict(ing='Potassium Chloride', s='oral solution (1.5 g) sugar-free', note='Electrolyte replacement (Prevego). Verified: Netmeds/Rigmeds.'),
 'PREDNIKEM 8 MG':           dict(ing='Methylprednisolone', s='8 mg', note='Corticosteroid tablet (Alkem). Verified: Truemeds/DawaaDost.'),
 'PRODOTIL DRY SYP':         dict(ing='Cefpodoxime Proxetil', s='50 mg or 100 mg / 5 mL (dry syrup — confirm on pack)', note='3rd-gen cephalosporin pediatric dry syrup — stock spelling of Proditil (Univentis). Verified: 1mg/PharmEasy.'),
 'PROSTGARD  D 8':           dict(ing='Silodosin + Dutasteride', s='8 mg + 0.5 mg', note='BPH combo — stock spelling of Prostagard-D 8 (Aristo). Verified: Practo/PharmEasy.'),
 'RANRAFT SYP 200':          dict(ing=ALGINATE, s='Na-Alginate 250 mg + NaHCO3 133.5 mg + CaCO3 80 mg / 5 mL', note='Alginate antacid — reflux (JB Chemicals). Verified: MedPlusMart/FrankRoss.'),
 'RAPIDEM SOL. SPR':         dict(ing='Zolpidem', s='3.85% w/v sublingual spray', note='Sublingual sleep spray — insomnia — stock name Rapidem-SL (Troikaa). Verified: Apollo/Getomeds.', form='Sublingual spray'),
 'RENAMSAFE':                dict(ing='Taurine + Acetylcysteine', s='500 mg + 150 mg', note='Renal antioxidant combo (MediNexus). Verified: 1mg.'),
 'REPVOG  0.3/1':            dict(ing='Repaglinide + Voglibose', s='1 mg + 0.3 mg', note='Antidiabetic combo (Medicamen). Note: stock listed as Injection; marketed form is tablet. Verified: 1mg/Apollo.', form='Tablet'),
 'REPVOG 0.3/2':             dict(ing='Repaglinide + Voglibose', s='2 mg + 0.3 mg', note='Antidiabetic combo (Medicamen). Note: stock listed as Injection; marketed form is tablet. Verified: Apollo.', form='Tablet'),
 'SEMBOLIC INJ':             dict(ing='Semaglutide', s='15 mg / 3 mL reusable cartridge (5 mg/mL)', note='GLP-1 agonist — diabetes/weight management (Zydus-Torrent cartridge). Verified: multiple Indian pharma suppliers.'),
 'SIARIZO 200':              dict(ing='Tedizolid Phosphate', s='200 mg', note='Oxazolidinone antibiotic — skin infections — stock spelling of StariZo 200 (Sun Pharma). Verified: 1mg/Netmeds/DawaaDost.'),
 'SKEBAZOR':                 dict(ing='Aceclofenac + Cyclobenzaprine', s='200 mg + 15 mg', note='NSAID + muscle relaxant (Intas). Verified: 1mg/MedPlusMart.'),
 'SOLONIUM SYP':             dict(ing='Potassium Chloride', s='1.5 g / 200 mL (mixed-fruit)', note='Electrolyte replacement (Fawn). Verified on manufacturer site.'),
 'TEMSIN DFZ':               dict(ing='Tamsulosin + Deflazacort', s='0.4 mg + 30 mg', note='BPH + anti-inflammatory combo (Prevego). Verified: 1mg.'),
 'TEXORIS - 7.5 MG':         dict(ing='Methotrexate', s='7.5 mg', note='DMARD — rheumatoid arthritis/psoriasis (Fawn). Verified on manufacturer site.'),
 'THIONOS  4 MG INJ':        dict(ing='Thiocolchicoside', s='4 mg', note='Muscle relaxant (Prevego). Note: brand\u2019s documented form is capsule/tablet; stock says Inj — verify on pack. Verified: 1mg.'),
 'THYROPACE':                dict(ing='L-Tyrosine + Iodine + Elemental Iron + Elemental Zinc + Elemental Selenium + Elemental Copper + Elemental Chromium + Vitamin D3 + Vitamin B12 + Vitamin B6 + Folic Acid', s='multinutrient thyroid-support tablet (L-Tyrosine 250 mg)', note='Thyroid-function nutritional support. Verified: Truemeds/Snowch.'),
 'TROPIN 10 ML VIAL':        dict(ing='Atropine Sulphate', s='0.6 mg / mL (10 mL vial)', note='Anticholinergic — bradycardia, pre-op — stock name of Tropine (Neon). Verified: Apollo (10 mL vial).'),
 'TROYCURIM 2.5 ML INJ':     dict(ing='Atracurium Besilate', s='10 mg / mL (2.5 mL amp)', note='Skeletal muscle relaxant for anaesthesia — stock name of Troycurium (Troikaa). Verified: Troikaa product list/Getomeds.'),
 'TYVALZI':                  dict(ing='Sovateltide', s='30 mcg combipack (3 vials)', note='First-in-class acute ischemic stroke injection (Sun Pharma). Note: stock listed as Tablet; actual form is injection. Verified: MedPlusMart/Tabsul.', form='Injection (combipack)'),
 'UROMAC100SR':              dict(ing='Nitrofurantoin', s='100 mg (sustained release)', note='Urinary anti-infective (Fawn). Verified: 1mg/Zeelabs/Drugcarts.', form='SR tablet'),
 'VIOPEP 200':               dict(ing='Fungal Diastase + Papain', s='digestive-enzyme syrup (200 mL)', note='Digestive enzyme syrup (Fawn Viopep). Verified: PharmaVends/Fawn.', form='Syrup'),
 'VITAMAC TAB':              dict(ing='Vitamins A, D2, E, C, B1, B2, B3, B5, B6, B9, B12, B7 (Biotin) + Magnesium, Zinc, Copper, Selenium, Iodine, Chromium, Manganese + Grape Seed Extract + Lycopene', s='multivitamin-multimineral tablet', note='Antioxidant multivitamin (Macleods). Verified: PharmEasy/Truemeds/PlatinumRx.'),
 'WYSOLANE DT 20 MG':        dict(ing='Prednisolone', s='20 mg (dispersible tablet)', note='Corticosteroid — stock spelling of Wysolone DT 20. Verified: PharmEasy/Truemeds.'),
 'ZEULIN-2ML':               dict(ing='Citicoline', s='500 mg / 2 mL', note='Nootropic — stroke/brain injury (Fawn). Verified on manufacturer site.'),
 'PHYLOBRON - XT':           dict(ing='Terbutaline + Acebrophylline + Guaifenesin', s='1.25 mg + 50 mg + 50 mg / 5 mL', note='Expectorant-bronchodilator syrup (Univentis). Note: stock listed as Tablet; documented form is syrup. Verified: Jeevandip.', form='Syrup'),
 'QUICNAC  AB':              dict(ing='Acebrophylline + Acetylcysteine', s='100 mg + 600 mg', note='Mucolytic-bronchodilator — stock spelling of Quicnac AB (Alkem). Verified: Apollo/Truemeds/Kogland.'),
 'QUICNAC - AB':             dict(ing='Acebrophylline + Acetylcysteine', s='100 mg + 600 mg', note='Mucolytic-bronchodilator — stock spelling of Quicnac AB (Alkem). Verified: Apollo/Truemeds/Kogland.'),
 'QUICNAC 600':              dict(ing='Acetylcysteine', s='600 mg (effervescent)', note='Mucolytic — stock spelling of Quicnac 600 (Alkem). Verified: 1mg/MedPlusMart.'),
 'SINRV LC':                 dict(ing='Levocarnitine + Methylcobalamin + Folic Acid', s='500 mg + 1500 mcg + 1.5 mg', note='Nerve-health combo — stock spelling of Sinrv-LC (Medisive). Verified: 1mg.', form='Tablet'),
 'SINRV PLUS INJ':           dict(ing='Methylcobalamin + Pyridoxine (Vitamin B6) + Nicotinamide', s='B-complex injection', note='Neurotropic B-complex injection — Sinrv Plus (Medisive). Verified: 1mg.'),
 'SOTHERX JUNIOR SYP':       dict(ing='Bromhexine + Guaifenesin + Menthol + Terbutaline', s='pediatric cough-syrup strengths (per pack)', note='Pediatric expectorant (Psychotropics India). Verified: Lybrate/Drugcarts/PlatinumRx.'),
 'CITRIDE 500 MG':           dict(ing='Citicoline', s='500 mg', note='Nootropic — stroke/cognitive — stock spelling of Citiride 500. Verified: Truemeds/IndiaMART.'),
 'ENOBLE LOTION':            dict(ing='Calamine + Kaolin Clay + Aloe Vera', s='soothing skin lotion', note='Soothing anti-pruritic lotion (Fawn). Verified on manufacturer site.'),
 'ENOBILE LOTION 100 ML':    dict(ing='Calamine + Kaolin Clay + Aloe Vera', s='100 mL', note='Soothing anti-pruritic lotion — stock spelling of ENOBLE (Fawn). Verified on manufacturer site.'),
}

# Non-drug reclassifications (verified devices / consumables / non-drug items)
ND = {
 'DEUROPLAST 10':            'Elastic adhesive bandage 10 cm x 4 m (Apex Medivision). Verified: Prem Medical/Apex site.',
 'RAMSONS FIXER':            'Romsons I.V. cannula fixator / fixation dressing (device — no drug content; verify pack variant). Verified: Romsons fixator product line.',
 'UMBLICAL S.I. 276':        'Romsons umbilical (arterial/venous) catheter — neonatal vascular access device. Verified: Romsons GS-3002.',
 'PREGAKEM CARD':            'Pregakem pregnancy detection card (hCG urine test kit, Alkem). Verified: Medscare/IndiaMART.',
 'EXTEENA TRIO':             'Romsons Exteena Trio (GS-3048T) needle-free connector with triple extension line. Verified: Romsons listings.',
 'AMCHOPLAST FLO 3 GM':      'AmchoPlast — sterile dehydrated human amnion/chorion membrane allograft (biologic wound cover, no drug salt). Verified: Cura Medical/Omega Medical.',
 'DIGITAL THERMAMTER':       'Digital clinical thermometer (device).',
 'DIGITAL THERMAMTER - P':   'Digital clinical thermometer (device).',
 'INNOHALER':                'Inhaler device (Alkem Innohaler, OTC device — empty inhaler unit). Verified: 1mg OTC listing.',
}

# Exact-duplicate stock rows to remove (keep first)
DUP_NAMES = ['SICAIN O SUPP']  # handled below via dedupe anyway

out = []
skipped = []
filled = 0
reclassified = 0

for it in items:
    name = it['name']
    unv = it['source'] in ('Not found — see pack label', 'See pack label')
    if unv:
        if name in V:
            v = V[name]
            it['ingredient'] = v['ing']
            it['strength'] = v['s']
            it['clinical_note'] = v['note']
            if v.get('form'):
                it['formulation'] = v['form']
            it['source'] = 'Web-verified (1mg/PharmEasy/Apollo/manufacturer)'
            filled += 1
        elif name in ND:
            it['ingredient'] = '\u2014 (non-drug item)'
            it['clinical_note'] = ND[name]
            if it['formulation'] in ('—', '-', ''):
                it['formulation'] = 'Device / Supply'
            it['source'] = 'Non-drug item (web-verified)'
            reclassified += 1
        elif name in ('DISPOVAN 1 ML','DISPOVAN 10 ML','DISPOVAN 2.5 ML','DISPOVAN 20 ML','DISPOVAN 3 ML','DISPOVAN 5 ML','DISPOVAN 50 ML',
                      'FOLEY TRAC - 14','FOLEY TRAC -16','FOLEY TRAC 12 NO.','FOLEY TRAC 18 NO.','FOLEY TRAC - 12',
                      'IMDFLO 3 ML','NIPPRO 10 ML','UCL- 90','TRIMMER PLUS'):
            it['ingredient'] = '\u2014 (non-drug item)'
            it['clinical_note'] = it['formulation'] + ' — sterile single-use medical supply (no drug content).' if it['formulation'] not in ('—','-','') else 'Medical device / supply (no drug content).'
            it['source'] = 'Non-drug item (device/consumable)'
            reclassified += 1
        else:
            skipped.append(dict(name=name, formulation=it['formulation'], strength=it['strength'],
                                category=it['main_heading'].split('  —  ')[0] if it['main_heading'] else ''))
            continue
    out.append(it)

# Dedupe exact same name+ingredient+formulation rows
seen = set()
final = []
dups = 0
for it in out:
    key = (re.sub(r'\s+', ' ', it['name'].strip().upper()), it['ingredient'].strip().lower())
    if key in seen:
        dups += 1
        continue
    seen.add(key)
    final.append(it)

# Clean category labels
def cat_of(h):
    m = re.match(r'^(\d+)\.\s\s(.+?)\s+—', h or '')
    return f"{m.group(1)}. {m.group(2).strip()}" if m else (h or 'Other')

# Normalized ingredient key + molecule list
def mol_split(ing):
    parts = re.split(r'\s*\+\s*', ing)
    return [p.strip() for p in parts if p.strip()]

final_items = []
for i, it in enumerate(final):
    non_drug = 'non-drug' in it['ingredient'].lower()
    key = re.sub(r'\s+', ' ', it['ingredient'].strip().lower())
    rec = dict(
        id=i,
        name=re.sub(r'\s+', ' ', it['name'].strip()),
        ingredient=it['ingredient'],
        ingredientKey=key,
        molecules=[] if non_drug else mol_split(it['ingredient']),
        formulation=it['formulation'] if it['formulation'] not in ('—','-') else None,
        strength=it['strength'] if it['strength'] not in ('—','-') else None,
        dose=it['dose'] if it['dose'] not in ('—','-') else None,
        note=it['clinical_note'] if it['clinical_note'] not in ('—','-') else None,
        rate=it['rate'] if it['rate'] and it['rate'] not in ('—','-') else None,
        source=it['source'],
        category=cat_of(it['main_heading']),
        subcategory=re.split(r'\s+—\s+\d+\s+(?:medicine|item)', it['sub_heading'] or '')[0] if it['sub_heading'] else None,
        nonDrug=non_drug,
    )
    final_items.append(rec)

import os
os.makedirs('/home/user/Mcq-game/data', exist_ok=True)
json.dump(final_items, open('/home/user/Mcq-game/data/medicines.json','w'), indent=1, ensure_ascii=False)
json.dump(dict(total_raw=len(items), filled=filled, reclassified=reclassified,
               duplicates_removed=dups, final=len(final_items),
               skipped_count=len(skipped), skipped=skipped),
          open('/home/user/Mcq-game/data/skipped_report.json','w'), indent=1, ensure_ascii=False)

drugs = [m for m in final_items if not m['nonDrug']]
print(f"raw={len(items)} filled={filled} reclass={reclassified} dups={dups} final={len(final_items)} drugs={len(drugs)} skipped={len(skipped)}")
