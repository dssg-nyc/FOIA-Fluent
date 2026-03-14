"""Key sections of the Freedom of Information Act (5 U.S.C. 552).

Source: uscode.house.gov (Office of the Law Revision Counsel)
These are the actual statutory provisions relevant to FOIA request drafting.
Claude must ONLY cite language from these sections — never from training data.
"""

FOIA_STATUTE = {
    "citation": "5 U.S.C. 552",
    "title": "Freedom of Information Act",
    "sections": {
        "request_rights": {
            "cite": "5 U.S.C. 552(a)(3)(A)",
            "text": (
                "Except with respect to the records made available under paragraphs (1) and (2) "
                "of this subsection, and except as provided in subparagraph (3), each agency, upon "
                "any request for records which (i) reasonably describes such records and (ii) is made "
                "in accordance with published rules stating the time, place, fees (if any), and "
                "procedures to be followed, shall make the records promptly available to any person."
            ),
        },
        "format_preference": {
            "cite": "5 U.S.C. 552(a)(3)(B)",
            "text": (
                "In making any record available to a person under this paragraph, an agency shall "
                "provide the record in any form or format requested by the person if the record is "
                "readily reproducible by the agency in that form or format. Each agency shall make "
                "reasonable efforts to maintain its records in forms or formats that are reproducible "
                "for purposes of this section."
            ),
        },
        "time_limits": {
            "cite": "5 U.S.C. 552(a)(6)(A)(i)",
            "text": (
                "Each agency, upon any request for records made under paragraph (1), (2), or (3) "
                "of this subsection, shall (i) determine within 20 days (excepting Saturdays, "
                "Sundays, and legal public holidays) after the receipt of any such request whether "
                "to comply with such request and shall immediately notify the person making such "
                "request of such determination and the reasons therefor, and of the right of such "
                "person to appeal to the head of the agency any adverse determination."
            ),
        },
        "expedited_processing": {
            "cite": "5 U.S.C. 552(a)(6)(E)(i)",
            "text": (
                "Each agency shall promulgate regulations, pursuant to notice and receipt of public "
                "comment, providing for expedited processing of requests for records (I) in cases "
                "in which the person requesting the records demonstrates a compelling need; and "
                "(II) in other cases determined by the agency."
            ),
        },
        "compelling_need_definition": {
            "cite": "5 U.S.C. 552(a)(6)(E)(v)",
            "text": (
                "For purposes of this subparagraph, the term 'compelling need' means (I) that a "
                "failure to obtain requested records on an expedited basis under this paragraph "
                "could reasonably be expected to pose an imminent threat to the life or physical "
                "safety of an individual; or (II) with respect to a request made by a person "
                "primarily engaged in disseminating information, urgency to inform the public "
                "concerning actual or alleged Federal Government activity."
            ),
        },
        "fee_categories": {
            "cite": "5 U.S.C. 552(a)(4)(A)(ii)",
            "text": (
                "Fee schedules shall provide for the recovery of only the direct costs of search, "
                "duplication, and review. Review costs shall include only the direct costs incurred "
                "during the initial examination of a document for the purposes of determining "
                "whether the documents must be disclosed under this section and for the purposes of "
                "withholding any portions exempt from disclosure under this section. Review costs "
                "may not include any costs incurred in resolving issues of law or policy that may "
                "be raised in the course of processing a request under this section."
            ),
        },
        "fee_waiver": {
            "cite": "5 U.S.C. 552(a)(4)(A)(iii)",
            "text": (
                "Documents shall be furnished without any charge or at a charge reduced below the "
                "fees established under clause (ii) if disclosure of the information is in the "
                "public interest because it is likely to contribute significantly to public "
                "understanding of the operations or activities of the government and is not "
                "primarily in the commercial interest of the requester."
            ),
        },
        "appeal_rights": {
            "cite": "5 U.S.C. 552(a)(6)(A)(i)",
            "text": (
                "The person making the request shall be notified of the right to appeal to the "
                "head of the agency any adverse determination."
            ),
        },
    },
    "exemptions": {
        "b1": {
            "cite": "5 U.S.C. 552(b)(1)",
            "name": "National Security",
            "text": (
                "Specifically authorized under criteria established by an Executive order to be "
                "kept secret in the interest of national defense or foreign policy and are in fact "
                "properly classified pursuant to such Executive order."
            ),
        },
        "b2": {
            "cite": "5 U.S.C. 552(b)(2)",
            "name": "Internal Agency Rules",
            "text": "Related solely to the internal personnel rules and practices of an agency.",
        },
        "b3": {
            "cite": "5 U.S.C. 552(b)(3)",
            "name": "Statutory Exemptions",
            "text": (
                "Specifically exempted from disclosure by statute (other than section 552b of this "
                "title), if that statute (A)(i) requires that the matters be withheld from the "
                "public in such a manner as to leave no discretion on the issue; or (ii) establishes "
                "particular criteria for withholding or refers to particular types of matters to "
                "be withheld; and (B) if enacted after the date of enactment of the OPEN FOIA Act "
                "of 2009, specifically cites to this paragraph."
            ),
        },
        "b4": {
            "cite": "5 U.S.C. 552(b)(4)",
            "name": "Trade Secrets / Confidential Business Information",
            "text": "Trade secrets and commercial or financial information obtained from a person and privileged or confidential.",
        },
        "b5": {
            "cite": "5 U.S.C. 552(b)(5)",
            "name": "Deliberative Process / Privileged",
            "text": (
                "Inter-agency or intra-agency memorandums or letters that would not be available "
                "by law to a party other than an agency in litigation with the agency, provided "
                "that the deliberative process privilege shall not apply to records created 25 years "
                "or more before the date on which the records were requested."
            ),
        },
        "b6": {
            "cite": "5 U.S.C. 552(b)(6)",
            "name": "Personal Privacy",
            "text": (
                "Personnel and medical files and similar files the disclosure of which would "
                "constitute a clearly unwarranted invasion of personal privacy."
            ),
        },
        "b7": {
            "cite": "5 U.S.C. 552(b)(7)",
            "name": "Law Enforcement",
            "text": (
                "Records or information compiled for law enforcement purposes, but only to the "
                "extent that the production of such law enforcement records or information "
                "(A) could reasonably be expected to interfere with enforcement proceedings, "
                "(B) would deprive a person of a right to a fair trial or an impartial adjudication, "
                "(C) could reasonably be expected to constitute an unwarranted invasion of personal "
                "privacy, (D) could reasonably be expected to disclose the identity of a confidential "
                "source, (E) would disclose techniques and procedures for law enforcement "
                "investigations or prosecutions, or (F) could reasonably be expected to endanger "
                "the life or physical safety of any individual."
            ),
        },
        "b8": {
            "cite": "5 U.S.C. 552(b)(8)",
            "name": "Financial Institutions",
            "text": (
                "Contained in or related to examination, operating, or condition reports prepared "
                "by, on behalf of, or for the use of an agency responsible for the regulation or "
                "supervision of financial institutions."
            ),
        },
        "b9": {
            "cite": "5 U.S.C. 552(b)(9)",
            "name": "Geological Information",
            "text": "Geological and geophysical information and data, including maps, concerning wells.",
        },
    },
}
