const fs = require('fs');
const http = require('http');
const path = require('path');

async function main() {
    const studentFile = path.join(__dirname, '..', 'student.txt');
    const content = fs.readFileSync(studentFile, 'utf8');

    // Extract questions
    const questionRegex = /--- Q\d+: (.*?) ---/g;
    const questions = [];
    let match;
    while ((match = questionRegex.exec(content)) !== null) {
        questions.push(match[1]);
    }

    console.log(`Found ${questions.length} questions in student.txt`);

    let newOutput = `========================================================================
STUDENT ROLE (Role 7) - RBAC TEST RESULTS (DYNAMIC LLM CLASSIFIER)
User ID: 2372
Generated: ${new Date().toLocaleString()}
========================================================================\n\n`;

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        console.log(`[${i + 1}/${questions.length}] Testing: "${q}"`);

        try {
            const bodyStr = JSON.stringify({
                question: q,
                user_id: 2372,
                user_role: 7,
                history: []
            });

            const t0 = Date.now();
            const data = await new Promise((resolve, reject) => {
                const req = http.request('http://localhost:8081/api/agent/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
                }, (res) => {
                    let raw = '';
                    res.on('data', c => raw += c);
                    res.on('end', () => {
                        try {
                            const d = JSON.parse(raw);
                            d.statusCode = res.statusCode;
                            resolve(d);
                        } catch (e) { reject(e); }
                    });
                });
                req.on('error', e => reject(e));
                req.write(bodyStr); req.end();
            });

            const ms = Date.now() - t0;
            const r = data.report || data.error || 'No report';
            const sql = data.sql || '';
            const steps = data.steps !== undefined ? data.steps : 0;

            newOutput += `--- Q${i + 1}: ${q} ---\n`;
            newOutput += `Steps: ${steps} | Time: ${ms}ms\n`;
            newOutput += `Response:\n${r}\n`;
            if (sql) {
                newOutput += `SQL Generated:\n${sql}\n`;
            }
            newOutput += `\n`;

        } catch (err) {
            console.error(`Error on Q${i + 1}:`, err);
            newOutput += `--- Q${i + 1}: ${q} ---\nError: ${err.message}\n\n`;
        }
    }

    fs.writeFileSync(studentFile, newOutput);
    console.log(`\nSuccess! Updated ${studentFile}`);
}

main().catch(console.error);
