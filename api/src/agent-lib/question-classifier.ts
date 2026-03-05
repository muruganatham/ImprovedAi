// ════════════════════════════════════════════════════════════════
// FILE: api/src/agent-lib/question-classifier.ts
// ════════════════════════════════════════════════════════════════
// 
// APPROACH: 3-Layer Security (classifier is just Layer 1)
//
// Layer 1: classifyQuestionScope() — FAST pre-filter (this file)
//   → Catches obvious cases. Does NOT try to catch everything.
//
// Layer 2: buildScopePrompt() — SMART rules for LLM
//   → "You are user 2372. Add WHERE user_id = 2372."
//   → Already in agent.routes.ts ✅
//
// Layer 3: run_sql tool security check — HARD block
//   → Student query without user_id? REJECTED.
//   → Already in agent.routes.ts ✅
//
// WHY THIS WORKS:
//   Even if Layer 1 misclassifies, Layer 2 tells the LLM the rules,
//   and Layer 3 blocks any SQL that doesn't include user_id.
//   A student CANNOT leak other users' data even if the classifier
//   gets confused — the tool-level check stops it.
//
// ════════════════════════════════════════════════════════════════


// ── Types ─────────────────────────────────────────────────────
export type QuestionScope = "public" | "personal" | "restricted";

export interface ClassificationResult {
    scope: QuestionScope;
    reason: string;
}


// ── Identity: ONLY exact "who am I" type questions ────────────
// These skip the LLM entirely → instant profile response.
// Keep this list TINY. When in doubt, let the LLM handle it.
const IDENTITY_PATTERNS = [
    /^\s*who\s+am\s+i\s*\??\s*$/i,
    /^\s*who\s+i\s+am\s*\??\s*$/i,
    /^\s*my\s+profile\s*$/i,
    /^\s*my\s+details?\s*$/i,
    /^\s*my\s+name\s*$/i,
    /^\s*(about|tell\s+(me\s+)?about)\s+my\s*self\s*$/i,
    /^\s*what\s+is\s+my\s+name\s*\??\s*$/i,
    /^\s*tell\s+about\s+me\s*$/i,
    /^\s*my\s+info(rmation)?\s*$/i,
    // Thanglish
    /^\s*naan\s+yaaru\s*\??\s*$/i,
    /^\s*yaaru\s+naan\s*\??\s*$/i,
];

// ── Data keywords: If ANY of these appear, it's NOT identity ──
// This prevents "what is my last 30 days performance?" from
// hitting the identity fast-path.
const DATA_KEYWORDS = /\b(score|coding|mcq|solved|progress|performance|rank|course|question|attempt|time|last|days?|weeks?|months?|accuracy|marks?|test|enrolled|trainer|subject|topic|submit|result|percent|average|total|count|how\s+many|compare|summary|report|overview|statistics?|dashboard|history|activity|streak|practice)\b/i;


// ── Self-reference: User is asking about THEIR OWN data ───────
const SELF_PATTERNS = [
    /\bmy\b/i,
    /\bi\s+(have|am|did|do|was|got|solved|attempted|scored|enrolled|completed|submitted|practiced)\b/i,
    /\b(show|give|get|tell)\s+me\b/i,
    /\babout\s+me\b/i,
    /\bmyself\b/i,
    // Thanglish
    /\b(en\s|ennoda|enoda|enakku|enak|naan\s|naa\s)\b/i,
];

// ── Implicit self-reference (no "my" but clearly about self) ──
// "how many coding questions solved?" = "how many did I solve?"
const IMPLICIT_SELF_VERBS = /\b(solved|attempted|attended|completed|submitted|enrolled|practiced|scored|finished)\b/i;


// ── Other-person detection ────────────────────────────────────
// Instead of trying to catch every phrase with regex,
// we check: does the question mention a PERSON'S NAME?
//
// Approach: Look for patterns that reference another person.
// This catches: "who is X", "tell about X", "X's score",
//               "find X", "search X", "X performance"

const OTHER_PERSON_PATTERNS = [
    // Direct name queries
    /\b(who\s+is|who's)\s+[a-z]{2,}/i,
    /\b(tell|know)\s+(me\s+)?(about|regarding)\s+[a-z]{2,}/i,
    /\b(find|search|lookup|look\s+up)\s+(student\s+|user\s+)?[a-z]{2,}/i,
    /\b(show|get|give)\s+(me\s+)?(info|data|details?|profile|score|performance)\s+(of|for|about|on)\s+[a-z]{2,}/i,

    // Possessive: "karthick's score", "ravi's performance"
    /[a-z]{2,}'s\s+(score|mark|performance|progress|result|data|profile|detail)/i,

    // "student [name]" or "[name] student"
    /\bstudent\s+[a-z]{2,}\b/i,

    // Direct user_id references (not their own)
    /\buser[_\s]?id\s*[=:]?\s*\d+/i,
];

// ── Words that look like names but aren't ─────────────────────
// Prevents "tell about java" from being classified as restricted
const NOT_A_PERSON = /\b(java|python|c\+\+|c#|react|html|css|javascript|typescript|sql|mysql|mongodb|node|express|angular|vue|swift|kotlin|ruby|php|go|rust|dart|flutter|django|flask|spring|docker|kubernetes|git|linux|aws|azure|data\s*structures?|algorithms?|machine\s*learning|artificial\s*intelligence|web\s*dev|programming|coding|arrays?|linked\s*list|stacks?|queues?|trees?|graphs?|sorting|searching|oop|database|api|framework|loops?|functions?|variables?|courses?|classes?|modules?|topics?|colleges?|departments?|batches?|sections?|placement|companies?|eligib|campus|internship)\b/i;


// ── Catalog/public questions (no person involved) ─────────────
const PUBLIC_PATTERNS = [
    /\bhow\s+many\s+(courses?|colleges?|departments?|batches?|sections?|languages?)\b/i,
    /\b(list|show|all)\s+(courses?|colleges?|departments?|languages?)\b/i,
    /\b(available|total)\s+(courses?)\b/i,
    /\bplatform\s+(overview|statistics?|summary)\b/i,
];


// ── Security: always restricted ───────────────────────────────
const SECURITY_PATTERNS = /\b(passwords?|passwd|pwd|secrets?|tokens?|api.?keys?|otps?)\b/i;


// ── Restricted: cross-user / comparison / ranking ─────────────
const RESTRICTED_PATTERNS = [
    /\b(compare|vs|versus)\b/i,
    /\b(top\s*\d*|topper|best\s+student|worst\s+student|highest|lowest|rank|ranking)\b/i,
    /\b(all|every|each|list)\s+(student|user|trainer|staff)s?\b/i,
    /\bhow\s+many\s+(student|user|trainer|staff|admin)s?\b/i,
    /\b(student|user)s?\s*(count|list|total|number)\b/i,
    /\b(platform|overall|system)\s*(?:stats?|report|overview|dashboard|summary)/i,
    /\b(gender\s*distribution|male\s+female|inactive\s+user|disabled\s+account)\b/i,
    // Email lookup for other users
    /\b[\w.-]+@[\w.-]+\.\w+\b/i,
    // Tamil restricted: "evalo students"
    /\b(evalo|evlo)\s+(student|user|trainer)s?\b/i,
];


// ════════════════════════════════════════════════════════════════
// MAIN CLASSIFIER
// ════════════════════════════════════════════════════════════════
export function classifyQuestionScope(question: string): ClassificationResult {
    const q = question.trim();

    // ── RULE 0: Security — always restricted ────────────────────
    if (SECURITY_PATTERNS.test(q)) {
        return { scope: "restricted", reason: "security: sensitive data" };
    }

    // ── RULE 1: Identity fast-path (VERY strict) ────────────────
    // Only PURE identity questions. If ANY data keyword exists,
    // it's NOT identity — let the LLM handle it.
    for (const pattern of IDENTITY_PATTERNS) {
        if (pattern.test(q)) {
            // Double-check: does it ALSO ask about data?
            if (DATA_KEYWORDS.test(q)) {
                return { scope: "personal", reason: "self_data_with_identity" };
            }
            return { scope: "personal", reason: "identity" };
        }
    }

    // ── RULE 2: Other person mentioned → restricted ─────────────
    // "tell about muruganantham", "who is karthick?"
    // BUT NOT "tell about java" (tech terms excluded)
    // CHECK THIS EARLY so "tell about X" doesn't fall to self-ref
    for (const pattern of OTHER_PERSON_PATTERNS) {
        if (pattern.test(q) && !NOT_A_PERSON.test(q)) {
            return { scope: "restricted", reason: "other_person" };
        }
    }

    // ── RULE 3: Self-reference → personal ───────────────────────
    // "my scores", "show me my progress", "how did I do?"
    const hasSelfRef = SELF_PATTERNS.some(p => p.test(q));
    if (hasSelfRef) {
        return { scope: "personal", reason: "self_reference" };
    }

    // ── RULE 4: Implicit self → personal ────────────────────────
    // "how many coding questions solved?" (no "my" but about self)
    if (IMPLICIT_SELF_VERBS.test(q)) {
        return { scope: "personal", reason: "implicit_self" };
    }

    // ── RULE 5: Restricted patterns (ranking, comparison, etc) ──
    for (const pattern of RESTRICTED_PATTERNS) {
        if (pattern.test(q)) {
            return { scope: "restricted", reason: "restricted_pattern" };
        }
    }

    // ── RULE 6: Public catalog questions ────────────────────────
    // "how many courses?", "list all colleges"
    if (PUBLIC_PATTERNS.some(p => p.test(q))) {
        return { scope: "public", reason: "catalog_query" };
    }

    // ── RULE 7: Has data keywords but no self-reference ─────────
    // "coding performance", "score summary" — ambiguous
    // Default to personal (safer — scope prompt adds user_id)
    if (DATA_KEYWORDS.test(q)) {
        return { scope: "personal", reason: "data_query_default_personal" };
    }

    // ── RULE 8: Default → personal for safety ───────────────────
    // When in doubt, classify as personal.
    // The scope prompt will add WHERE user_id = X.
    // Layer 3 (run_sql check) blocks anything without user_id.
    // This is SAFER than defaulting to public.
    return { scope: "personal", reason: "default_safe" };
}
