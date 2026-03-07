"""Federal agencies commonly targeted by FOIA requests.

All FOIA portal URLs and contact info verified against foia.gov and agency websites.
Each agency includes its CFR regulation reference and submission-specific notes.

Last verified: March 2026
"""

FEDERAL_AGENCIES = {
    "DHS": {
        "name": "Department of Homeland Security",
        "abbreviation": "DHS",
        "description": "Oversees immigration enforcement, border security, cybersecurity, disaster response (FEMA), and transportation security (TSA).",
        "foia_website": "https://www.dhs.gov/foia",
        "foia_email": "foia@hq.dhs.gov",
        "foia_regulation": "6 C.F.R. Part 5",
        "jurisdiction": "federal",
        "submission_notes": "DHS has component-specific FOIA offices. For immigration/detention records, file with ICE or CBP directly for faster processing.",
    },
    "ICE": {
        "name": "U.S. Immigration and Customs Enforcement",
        "abbreviation": "ICE",
        "description": "Enforces immigration and customs laws, operates detention facilities, conducts investigations into cross-border crime and immigration violations.",
        "foia_website": "https://www.ice.gov/foia",
        "foia_email": "ice-foia@ice.dhs.gov",
        "foia_regulation": "6 C.F.R. Part 5 (DHS regulations apply)",
        "jurisdiction": "federal",
        "submission_notes": "ICE FOIA requests can be submitted online via the ICE FOIA portal. For detention records, include the detainee's A-number if available. Expect significant processing times for law enforcement records.",
    },
    "CBP": {
        "name": "U.S. Customs and Border Protection",
        "abbreviation": "CBP",
        "description": "Manages borders, ports of entry, and international trade. Handles border patrol operations and customs enforcement.",
        "foia_website": "https://www.cbp.gov/site-policy-notices/foia",
        "foia_email": "cbpfoia@cbp.dhs.gov",
        "foia_regulation": "6 C.F.R. Part 5 (DHS regulations apply)",
        "jurisdiction": "federal",
        "submission_notes": "CBP processes first-party (about yourself) and third-party requests differently. Include travel dates and port of entry if requesting personal records.",
    },
    "USCIS": {
        "name": "U.S. Citizenship and Immigration Services",
        "abbreviation": "USCIS",
        "description": "Administers immigration benefits including visas, naturalization, asylum, and work permits.",
        "foia_website": "https://www.uscis.gov/records/request-records-through-the-freedom-of-information-privacy-act",
        "foia_email": "uscis.foia@uscis.dhs.gov",
        "foia_regulation": "6 C.F.R. Part 5 (DHS regulations apply)",
        "jurisdiction": "federal",
        "submission_notes": "USCIS has a separate online portal (FIRST) for FOIA requests. Include receipt numbers or A-numbers when requesting case-specific records.",
    },
    "FBI": {
        "name": "Federal Bureau of Investigation",
        "abbreviation": "FBI",
        "description": "Federal law enforcement agency handling counterterrorism, cybercrime, public corruption, civil rights violations, and major criminal investigations.",
        "foia_website": "https://vault.fbi.gov/fdps-1/foia-request",
        "foia_email": "foiparequest@fbi.gov",
        "foia_regulation": "28 C.F.R. Part 16 (DOJ regulations)",
        "jurisdiction": "federal",
        "submission_notes": "FBI has a large backlog. Check the FBI Vault (vault.fbi.gov) first — many records are already released. Use eFOIA portal for electronic submissions.",
    },
    "DOJ": {
        "name": "Department of Justice",
        "abbreviation": "DOJ",
        "description": "Federal law enforcement and legal affairs. Includes components like the FBI, DEA, ATF, BOP, and the Office of Information Policy (OIP) which oversees FOIA government-wide.",
        "foia_website": "https://www.justice.gov/oip",
        "foia_email": "MRUFOIA.Requests@usdoj.gov",
        "foia_regulation": "28 C.F.R. Part 16",
        "jurisdiction": "federal",
        "submission_notes": "DOJ has many components with separate FOIA offices. Route requests to the specific component (FBI, DEA, BOP, etc.) for faster processing. DOJ OIP handles policy and appeals.",
    },
    "DEA": {
        "name": "Drug Enforcement Administration",
        "abbreviation": "DEA",
        "description": "Enforces controlled substances laws and regulations. Investigates drug trafficking and distribution.",
        "foia_website": "https://www.dea.gov/foia",
        "foia_email": "DEA.FOIA@usdoj.gov",
        "foia_regulation": "28 C.F.R. Part 16 (DOJ regulations)",
        "jurisdiction": "federal",
        "submission_notes": "DEA frequently invokes law enforcement exemptions (b)(7). Be specific about the records sought to minimize exemption claims.",
    },
    "ATF": {
        "name": "Bureau of Alcohol, Tobacco, Firearms and Explosives",
        "abbreviation": "ATF",
        "description": "Regulates firearms, explosives, alcohol, and tobacco. Investigates related federal crimes.",
        "foia_website": "https://www.atf.gov/resource-center/foia",
        "foia_email": "foiamail@atf.gov",
        "foia_regulation": "28 C.F.R. Part 16 (DOJ regulations)",
        "jurisdiction": "federal",
        "submission_notes": "ATF processes requests through its Disclosure Division. Firearms trace data has specific statutory restrictions under the Tiahrt Amendment.",
    },
    "CIA": {
        "name": "Central Intelligence Agency",
        "abbreviation": "CIA",
        "description": "Foreign intelligence agency. Collects, analyzes, and disseminates intelligence on foreign governments, organizations, and individuals.",
        "foia_website": "https://www.cia.gov/readingroom/",
        "foia_email": "",
        "foia_regulation": "32 C.F.R. Part 1900",
        "jurisdiction": "federal",
        "submission_notes": "CIA FOIA requests must be submitted by mail or through the CIA FOIA portal. Check the CIA Reading Room first. Expect heavy use of national security exemption (b)(1). No email submissions.",
    },
    "EPA": {
        "name": "Environmental Protection Agency",
        "abbreviation": "EPA",
        "description": "Protects human health and the environment. Regulates air/water quality, chemicals, waste disposal, and environmental enforcement.",
        "foia_website": "https://www.epa.gov/foia",
        "foia_email": "hq.foia@epa.gov",
        "foia_regulation": "40 C.F.R. Part 2",
        "jurisdiction": "federal",
        "submission_notes": "EPA has regional offices with their own FOIA contacts. Route requests to the appropriate regional office for location-specific records. FOIAonline portal available for electronic submissions.",
    },
    "DOD": {
        "name": "Department of Defense",
        "abbreviation": "DOD",
        "description": "Oversees the U.S. military including Army, Navy, Air Force, Marines, and Space Force. Manages defense policy, military operations, and veterans' affairs coordination.",
        "foia_website": "https://open.defense.gov/FOIA/",
        "foia_email": "",
        "foia_regulation": "32 C.F.R. Part 286",
        "jurisdiction": "federal",
        "submission_notes": "DOD is decentralized — each military branch and defense agency has its own FOIA office. Route to the specific component (Army, Navy, etc.) for faster processing.",
    },
    "STATE": {
        "name": "Department of State",
        "abbreviation": "State",
        "description": "Conducts foreign policy, diplomatic relations, and consular services. Manages passports, visas (abroad), and international treaties.",
        "foia_website": "https://foia.state.gov/",
        "foia_email": "FOIArequest@state.gov",
        "foia_regulation": "22 C.F.R. Part 171",
        "jurisdiction": "federal",
        "submission_notes": "State Department has a large backlog and frequently invokes (b)(1) national security and (b)(5) deliberative process exemptions. Check the Virtual Reading Room first.",
    },
    "HHS": {
        "name": "Department of Health and Human Services",
        "abbreviation": "HHS",
        "description": "Oversees public health, Medicare/Medicaid, FDA, CDC, NIH, and social services programs.",
        "foia_website": "https://www.hhs.gov/foia/",
        "foia_email": "",
        "foia_regulation": "45 C.F.R. Part 5",
        "jurisdiction": "federal",
        "submission_notes": "HHS has component-specific FOIA offices (FDA, CDC, NIH, CMS). Route to the specific operating division for faster processing.",
    },
    "VA": {
        "name": "Department of Veterans Affairs",
        "abbreviation": "VA",
        "description": "Provides healthcare, benefits, and memorial services to U.S. military veterans and their families.",
        "foia_website": "https://www.va.gov/foia/",
        "foia_email": "",
        "foia_regulation": "38 C.F.R. Part 1",
        "jurisdiction": "federal",
        "submission_notes": "VA FOIA requests should specify whether records are from VHA (health), VBA (benefits), or NCA (memorial affairs). Medical records may be faster to obtain through Privacy Act requests.",
    },
    "USDA": {
        "name": "Department of Agriculture",
        "abbreviation": "USDA",
        "description": "Manages agriculture policy, food safety (FSIS), forest service, rural development, and nutrition programs (SNAP).",
        "foia_website": "https://www.usda.gov/ogc/office-information-affairs/foia-division",
        "foia_email": "USDAFOIA@usda.gov",
        "foia_regulation": "7 C.F.R. Part 1",
        "jurisdiction": "federal",
        "submission_notes": "USDA has many sub-agencies with separate FOIA offices. Route to the specific agency (FSIS, Forest Service, APHIS, etc.) for faster results.",
    },
    "DOE": {
        "name": "Department of Energy",
        "abbreviation": "DOE",
        "description": "Manages energy policy, nuclear weapons programs, national laboratories, and energy research.",
        "foia_website": "https://www.energy.gov/management/freedom-information-act",
        "foia_email": "FOIA-Central@hq.doe.gov",
        "foia_regulation": "10 C.F.R. Part 1004",
        "jurisdiction": "federal",
        "submission_notes": "DOE FOIA requests involving nuclear or classified information will face additional review. Specify the DOE site or national lab if known.",
    },
    "SEC": {
        "name": "Securities and Exchange Commission",
        "abbreviation": "SEC",
        "description": "Regulates securities markets, enforces securities laws, and oversees financial disclosures by public companies.",
        "foia_website": "https://www.sec.gov/foia",
        "foia_email": "foiapa@sec.gov",
        "foia_regulation": "17 C.F.R. Part 200",
        "jurisdiction": "federal",
        "submission_notes": "Many SEC filings and enforcement actions are already public via EDGAR. Check EDGAR first before filing a FOIA request.",
    },
    "FTC": {
        "name": "Federal Trade Commission",
        "abbreviation": "FTC",
        "description": "Protects consumers and promotes competition. Enforces antitrust laws and consumer protection regulations.",
        "foia_website": "https://www.ftc.gov/legal-library/foia",
        "foia_email": "FOIA@ftc.gov",
        "foia_regulation": "16 C.F.R. Part 4",
        "jurisdiction": "federal",
        "submission_notes": "FTC publishes many enforcement actions and reports publicly. Check the FTC Legal Library before filing a FOIA request.",
    },
    "NARA": {
        "name": "National Archives and Records Administration",
        "abbreviation": "NARA",
        "description": "Preserves and provides access to federal government records, including historical documents, presidential libraries, and the Federal Register.",
        "foia_website": "https://www.archives.gov/foia",
        "foia_email": "foia@nara.gov",
        "foia_regulation": "36 C.F.R. Part 1250",
        "jurisdiction": "federal",
        "submission_notes": "Many NARA records are already publicly accessible. Check the National Archives Catalog first. Historical records (25+ years old) are generally available without a FOIA request.",
    },
    "OPM": {
        "name": "Office of Personnel Management",
        "abbreviation": "OPM",
        "description": "Manages the federal workforce, including hiring policies, employee benefits, retirement, and background investigations.",
        "foia_website": "https://www.opm.gov/information-management/freedom-of-information-act/",
        "foia_email": "foia@opm.gov",
        "foia_regulation": "5 C.F.R. Part 294",
        "jurisdiction": "federal",
        "submission_notes": "For personnel records of specific federal employees, the employing agency may be a better first contact than OPM.",
    },
    "BOP": {
        "name": "Federal Bureau of Prisons",
        "abbreviation": "BOP",
        "description": "Operates federal prisons and manages the custody and care of federal inmates.",
        "foia_website": "https://www.bop.gov/foia/",
        "foia_email": "BOP-OGC-FOIA@bop.gov",
        "foia_regulation": "28 C.F.R. Part 16 (DOJ regulations)",
        "jurisdiction": "federal",
        "submission_notes": "BOP processes first-party requests (inmates requesting own records) differently from third-party requests. Include inmate register number if available.",
    },
}


def get_agency(abbreviation: str) -> dict | None:
    """Look up an agency by abbreviation (case-insensitive)."""
    return FEDERAL_AGENCIES.get(abbreviation.upper())


def get_all_agencies() -> list[dict]:
    """Return all agencies as a list."""
    return list(FEDERAL_AGENCIES.values())


def get_agency_summary() -> str:
    """Return a formatted summary of all agencies for use in Claude prompts."""
    lines = []
    for key, agency in FEDERAL_AGENCIES.items():
        lines.append(
            f"- {agency['abbreviation']} ({agency['name']}): {agency['description']}"
        )
    return "\n".join(lines)
