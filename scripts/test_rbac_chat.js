const http = require('http');

async function main() {
    console.log("RBAC Final Test — Round 3 (20 questions)\n");

    const testCases = [
        // === IDENTITY (student) ===
        { role: 7, user_id: 35, question: "who i am?", check: 'identity' },
        { role: 7, user_id: 35, question: "my profile", check: 'identity' },
        { role: 7, user_id: 35, question: "What is my roll number", check: 'identity' },

        // === PUBLIC CATALOG (student) ===
        { role: 7, user_id: 35, question: "How many courses are available?", check: 'public_fast' },
        { role: 7, user_id: 35, question: "How many colleges are there?", check: 'public_fast' },
        { role: 7, user_id: 35, question: "How many departments are active?", check: 'public_fast' },
        { role: 7, user_id: 35, question: "How many batches exist?", check: 'public_fast' },

        // === PERSONAL DATA (student) ===
        { role: 7, user_id: 35, question: "Show my enrolled courses", check: 'courses' },
        { role: 7, user_id: 35, question: "my coding performance", check: 'has_data' },
        { role: 7, user_id: 35, question: "Show my MCQ results", check: 'has_data' },

        // === RESTRICTED BLOCK (student) ===
        { role: 7, user_id: 35, question: "Show me the top 10 students", check: 'blocked' },
        { role: 7, user_id: 35, question: "Compare all colleges performance", check: 'blocked' },

        // === ADMIN FAST-PATH ===
        { role: 1, user_id: 1, question: "platform overview", check: 'admin_fast' },
        { role: 1, user_id: 1, question: "show me the numbers", check: 'admin_fast' },
        { role: 1, user_id: 1, question: "how many students are there", check: 'admin_fast' },
        { role: 1, user_id: 1, question: "how many trainers", check: 'admin_fast' },
        { role: 1, user_id: 1, question: "Compare all colleges", check: 'admin_fast' },

        // === ADMIN PROFILE SUPPRESSION ===
        { role: 1, user_id: 1, question: "Compare all colleges", check: 'no_profile' },

        // === COLLEGE ADMIN ===
        { role: 3, user_id: 3, question: "Show me the top 10 students in my college", check: 'has_data' },

        // === GREETING ===
        { role: 7, user_id: 35, question: "hi", check: 'greeting' },
    ];

    const results = [];

    for (const tc of testCases) {
        const roleName = { 1: 'SA', 2: 'A', 3: 'CA', 4: 'S', 5: 'T', 6: 'CC', 7: 'Stu' }[tc.role] || '?';
        process.stdout.write(`[${roleName}] "${tc.question}" ... `);
        try {
            const bodyStr = JSON.stringify({ question: tc.question, user_id: tc.user_id, user_role: tc.role, history: [] });
            const t0 = Date.now();
            const data = await new Promise((resolve, reject) => {
                const req = http.request('http://localhost:8081/api/agent/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
                }, (res) => {
                    let raw = '';
                    res.on('data', c => raw += c);
                    res.on('end', () => { try { const d = JSON.parse(raw); d.status = res.statusCode; resolve(d); } catch (e) { reject(e); } });
                });
                req.on('error', e => reject(e));
                req.write(bodyStr); req.end();
            });
            const ms = Date.now() - t0;
            const r = data.report || '';
            const hasProfile = r.includes("User Profile");
            const llm = data.steps > 2;

            let v = '❓';
            switch (tc.check) {
                case 'identity': v = hasProfile && !llm ? '✅' : `❌ p=${hasProfile} l=${llm}`; break;
                case 'public_fast': v = !llm && r.length > 10 ? '✅' : `❌ l=${llm} len=${r.length}`; break;
                case 'courses': v = r.toLowerCase().includes('course') ? '✅' : '❌ no courses'; break;
                case 'has_data': v = r.length > 30 && !r.startsWith("I'll help") ? '✅' : '❌ LLM fallback'; break;
                case 'blocked': v = r.includes("don't have access") || r.includes("not a list") || r.includes("limited") || r.includes("cannot view") || r.includes("only see") ? '✅' : '❌ not blocked'; break;
                case 'admin_fast': v = r.length > 20 && !r.startsWith("I'll help") ? '✅' : '❌ LLM fallback'; break;
                case 'no_profile': v = !hasProfile && r.length > 30 ? '✅' : `⚠️ profile=${hasProfile}`; break;
                case 'greeting': v = r.includes("Hello") || r.includes("Welcome") || r.includes("Devora") ? '✅' : '❌ no greeting'; break;
            }

            console.log(`${v} (${ms}ms, steps=${data.steps})`);
            results.push({ Role: roleName, Question: tc.question, Verdict: v, Ms: ms, Steps: data.steps, Snippet: r.substring(0, 120).replace(/\n/g, '\\n') });
        } catch (err) {
            console.log(`❌ ERR: ${err.message}`);
            results.push({ Role: roleName, Question: tc.question, Verdict: '❌ ERR', Error: err.message });
        }
    }

    console.log("\n════════ SUMMARY ════════");
    const p = results.filter(r => r.Verdict === '✅').length;
    const f = results.filter(r => r.Verdict?.startsWith('❌')).length;
    const w = results.filter(r => r.Verdict?.startsWith('⚠️')).length;
    console.log(`✅ ${p}/${results.length}  ❌ ${f}  ⚠️ ${w}`);

    require('fs').writeFileSync('rbac_test_report_round3.json', JSON.stringify(results, null, 2));
    console.log("Saved to rbac_test_report_round3.json");
}

main().catch(console.error);
