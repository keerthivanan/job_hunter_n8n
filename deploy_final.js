const fs = require('fs'), https = require('https');

// --- .env LOADER ---
function loadEnv() {
  try {
    const data = fs.readFileSync('.env', 'utf8');
    data.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) return;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env[key] = val;
    });
  } catch (e) { console.log('.env not found, using process.env'); }
}
loadEnv();

const KEY = process.env.N8N_API_KEY;
const HOST = process.env.N8N_HOST;
const WORKFLOW_ID = process.env.N8N_WORKFLOW_ID;
const CV_PATH = process.env.CV_PDF_PATH;

if (!KEY || !HOST || !WORKFLOW_ID || !CV_PATH) {
  console.error('ERROR: Missing required env vars. Check .env file.');
  process.exit(1);
}

const CV_BASE64 = fs.readFileSync(CV_PATH).toString('base64');
console.log('CV PDF loaded:', Math.round(CV_BASE64.length / 1024) + 'KB');

function api(m, p, b) {
  return new Promise(r => {
    const bd = b ? JSON.stringify(b) : null;
    const h = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
    if (bd) h['Content-Length'] = Buffer.byteLength(bd);
    const req = https.request({ hostname: HOST, port: 443, path: p, method: m, headers: h }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { r({ s: res.statusCode, d: JSON.parse(d) }); } catch(e) { r({ s: res.statusCode, d }); } });
    });
    req.on('error', e => r({ s: 'ERR', d: e.message }));
    if (bd) req.write(bd); req.end();
  });
}
function httpGet(path) {
  return new Promise(r => {
    const req = https.request({ hostname: HOST, port: 443, path, method: 'GET' }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => r({ s: res.statusCode, d }));
    });
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── NODE CODE STRINGS ─────────────────────────────────────────────────

const GENERATE_RESUME_CODE = [
  'const j = $input.item.json;',
  'const CV_BASE64 = ' + JSON.stringify(CV_BASE64) + ';',
  'return { json: { ...j, resumeBase64: CV_BASE64 } };'
].join('\n');

const PREPARE_PDF_CODE = [
  'const j = $input.item.json;',
  'const base64 = j.resumeBase64;',
  'if (!base64) return { json: j };',
  'const pdfBuffer = Buffer.from(base64, "base64");',
  'const binaryData = await this.helpers.prepareBinaryData(pdfBuffer, "Keerthivanan_S_Resume.pdf", "application/pdf");',
  'return { json: j, binary: { pdfAttachment: binaryData } };'
].join('\n');

const FILTER_CODE = [
  'let normalizedItems;',
  'try { normalizedItems = $("Normalize All Jobs").all(); } catch(e) { normalizedItems = []; }',
  'const seenIds = new Set();',
  'try {',
  '  for (const r of $input.all()) {',
  '    const j = r.json || {};',
  '    if (j.job_id) seenIds.add(String(j.job_id));',
  '    if (j.jobId) seenIds.add(String(j.jobId));',
  '    if (j.values && Array.isArray(j.values)) { for (const row of j.values) { if (row && row[0]) seenIds.add(String(row[0])); } }',
  '  }',
  '} catch(e) {}',
  'const allValid = normalizedItems.filter(i => { const j = i.json; return j && j.jobId && j.url && j.title && !j.message; });',
  'const newJobs = allValid.filter(i => !seenIds.has(String(i.json.jobId)));',
  'newJobs.sort((a, b) => new Date(b.json.postedAt||0) - new Date(a.json.postedAt||0));',
  'console.log("Normalized:", normalizedItems.length, "| Seen:", seenIds.size, "| New:", newJobs.length);',
  'if (newJobs.length === 0) return [{ json: { message: "No new jobs — all already applied" } }];',
  'return newJobs.slice(0, 3);'
].join('\n');

const SYSTEM_PROMPT = [
  'Write a 120-word job application email from Keerthivanan S.',
  'RULES:',
  '- First line: "Dear Hiring Team at [company],"',
  '- Paragraph 1 (2 sentences): Hook with CargoLink.sa + one key metric matching the job',
  '- Paragraph 2 (3 bullets): 3 achievements directly relevant to this specific job',
  '- Paragraph 3 (1 sentence): Mention LinkedIn, GitHub, live portfolio',
  '- Close: "My resume is attached. Happy to connect."',
  '- Signature: Sincerely,\\nKeerthivanan S\\nkeerthivanan.ds.ai@gmail.com | +91-709-276-1445',
  '- Include in body: "LinkedIn: https://linkedin.com/in/keerthi-vanan-s | GitHub: https://github.com/keerthivanan-s | Portfolio: https://cargolink.sa"',
  '- STRICT 120 words MAX. No headers. No bold. Plain text only.',
  '- Return JSON: {"subject": "Application: [role] | Keerthivanan S — AI Engineer", "body": "..."}'
].join('\\n');

const COMPOSE_EMAIL_CODE = [
  'const j = $input.item.json;',
  'const creds = await this.getCredentials("openAiApi");',
  'const OPENAI_KEY = creds.apiKey;',
  'const targetEmail = j.hrEmail || "keerthivanan7@gmail.com";',
  'const SYSTEM = ' + JSON.stringify(SYSTEM_PROMPT) + ';',
  'try {',
  '  const res = await this.helpers.httpRequest({',
  '    method: "POST",',
  '    url: "https://api.openai.com/v1/chat/completions",',
  '    headers: { "Authorization": "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },',
  '    body: JSON.stringify({',
  '      model: "gpt-4o-mini",',
  '      messages: [',
  '        { role: "system", content: SYSTEM },',
  '        { role: "user", content: "Job: " + j.title + " at " + j.company + " (" + (j.location||"Remote") + ")\\nDescription: " + (j.description||"").slice(0,600) + "\\n\\nCandidate facts: Gen AI Architect at CargoLink.sa. Built GPT-4+Qdrant RAG 65% faster, 95% accuracy, 1000+ users. Stack: Python, LangChain, FastAPI, Next.js 15, Docker, Redis, n8n. IEEE paper March 2025." }',
  '      ],',
  '      temperature: 0.6,',
  '      response_format: { type: "json_object" }',
  '    })',
  '  });',
  '  const raw = typeof res === "string" ? JSON.parse(res) : res;',
  '  const parsed = JSON.parse(raw.choices[0].message.content);',
  '  return { json: { ...j, hrEmail: targetEmail, emailSubject: parsed.subject, emailBody: parsed.body, emailSkipped: false } };',
  '} catch(e) {',
  '  return { json: { ...j, hrEmail: targetEmail,',
  '    emailSubject: "Application: " + j.title + " | Keerthivanan S — AI Engineer",',
  '    emailBody: "Dear Hiring Team at " + j.company + ",\\n\\nI built CargoLink.sa — a production logistics SaaS with 1000+ users, 99.5% uptime, and 65% faster AI-powered processing.\\n\\n• RAG system: GPT-4 + Qdrant, 95% quote accuracy, 500+ daily transactions\\n• Stack: Python, LangChain, FastAPI, Next.js 15, Docker, Redis, n8n\\n• Reduced costs 40%+ and deployment time from 2hrs to 15min\\n\\nLinkedIn: https://linkedin.com/in/keerthi-vanan-s | GitHub: https://github.com/keerthivanan-s | Portfolio: https://cargolink.sa\\n\\nMy resume is attached. Happy to connect.\\n\\nSincerely,\\nKeerthivanan S\\nkeerthivanan.ds.ai@gmail.com | +91-709-276-1445",',
  '    emailSkipped: false } };',
  '}'
].join('\n');

const FIND_HR_EMAIL_CODE = [
  'const j = $input.item.json;',
  'const desc = j.description || "", company = j.company || "", jobUrl = j.url || "";',
  'const EMAIL_RE = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g;',
  'const SKIP = ["example.","noreply","no-reply","privacy","@linkedin","@sentry","@w3",".png",".gif","test@","@email.com","@applicantpro","@lensa","@indeed","@glassdoor"];',
  'const descEmails = [...new Set([...(desc.matchAll?desc.matchAll(EMAIL_RE):[])].map(m=>m[0].toLowerCase()).filter(e=>!SKIP.some(s=>e.includes(s))))];',
  'if (descEmails.length > 0) return { json: { ...j, hrEmail: descEmails[0], emailMethod: "extracted" } };',
  'const JOB_BOARDS = ["linkedin.com","lensa.com","indeed.com","glassdoor.com","naukri.com","monster.com","ziprecruiter.com","lever.co","greenhouse.io"];',
  'let domain = "";',
  'if (jobUrl && !JOB_BOARDS.some(b=>jobUrl.includes(b))) { const m=jobUrl.match(/https?:\\/\\/(?:www\\.)?([^\\/]+)/); if(m) domain=m[1].toLowerCase(); }',
  'if (!domain) { const c=company.toLowerCase().replace(/\\s+(inc\\.?|ltd\\.?|llc|corp\\.?|group|technologies|tech|solutions|ai|global|systems|services|pvt|private|limited|consulting|labs?|software|digital)\\.?\\s*$/gi,"").replace(/[^a-z0-9]/g,""); domain=c.length>=3?c+".com":""; }',
  'if (!domain) return { json: { ...j, hrEmail: "hr@"+company.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,20)+".com", emailMethod: "guessed_name" } };',
  'return { json: { ...j, hrEmail: "hr@"+domain, emailMethod: "guessed_domain" } };'
].join('\n');

async function main() {
  const wf = JSON.parse(fs.readFileSync('APPLY_NOSCORE_FINAL.json', 'utf8'));

  wf.nodes.find(n => n.name === 'Generate Resume').parameters.jsCode = GENERATE_RESUME_CODE;
  wf.nodes.find(n => n.name === 'Prepare PDF Binary').parameters.jsCode = PREPARE_PDF_CODE;
  wf.nodes.find(n => n.name === 'Filter New Jobs').parameters.jsCode = FILTER_CODE;
  wf.nodes.find(n => n.name === 'Compose Email').parameters.jsCode = COMPOSE_EMAIL_CODE;
  wf.nodes.find(n => n.name === 'Find HR Email').parameters.jsCode = FIND_HR_EMAIL_CODE;
  console.log('All 5 nodes patched.');

  // Auto-discover PostgreSQL credential ID by name
  const creds = await api('GET', '/api/v1/credentials');
  const pgCred = (creds.d.data || []).find(c => c.name === 'PostgreSQL' && c.type === 'postgres');
  if (!pgCred) {
    console.log('\n⚠️  POSTGRES CREDENTIAL NOT FOUND IN N8N');
    console.log('Go to: https://' + HOST);
    console.log('Settings → Credentials → New → PostgreSQL');
    console.log('  Host:     db.rrlwxizsvrlznppatkgd.supabase.co');
    console.log('  Port:     5432');
    console.log('  Database: postgres');
    console.log('  User:     postgres');
    console.log('  Password: Keerthimaster1');
    console.log('  SSL:      Require');
    console.log('  Name it:  PostgreSQL');
    console.log('\nThen run: node deploy_final.js\n');
    process.exit(1);
  }
  console.log('PostgreSQL credential found: ID =', pgCred.id);
  // Inject real credential ID into Postgres nodes
  wf.nodes.filter(n => n.type === 'n8n-nodes-base.postgres').forEach(n => {
    n.credentials = { postgres: { id: pgCred.id, name: 'PostgreSQL' } };
  });

  console.log('Deactivating...');
  await api('POST', '/api/v1/workflows/' + WORKFLOW_ID + '/deactivate', null);
  await sleep(2000);

  console.log('Pushing workflow...');
  const push = await api('PUT', '/api/v1/workflows/' + WORKFLOW_ID, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' }
  });
  if (push.s !== 200) { console.log('PUSH FAILED:', JSON.stringify(push.d).slice(0, 300)); return; }
  console.log('Pushed OK.');

  const prev = await api('GET', '/api/v1/executions?workflowId=' + WORKFLOW_ID + '&limit=1');
  const lastId = (prev.d.data || [])[0] ? (prev.d.data || [])[0].id : 0;
  console.log('Last exec ID:', lastId);

  // Swap manual trigger → webhook to fire it
  const n2 = JSON.parse(JSON.stringify(push.d.nodes));
  const c2 = JSON.parse(JSON.stringify(push.d.connections));
  const t = n2.find(n => n.name === 'Run Manually');
  const wp = 'apply-' + Date.now();
  t.type = 'n8n-nodes-base.webhook'; t.typeVersion = 2; t.name = 'Webhook';
  t.parameters = { path: wp, httpMethod: 'GET', responseMode: 'onReceived' }; t.webhookId = 'whf-' + Date.now();
  if (c2['Run Manually']) { c2['Webhook'] = c2['Run Manually']; delete c2['Run Manually']; }

  await api('PUT', '/api/v1/workflows/' + WORKFLOW_ID, {
    name: wf.name, nodes: n2, connections: c2,
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' }
  });
  const act = await api('POST', '/api/v1/workflows/' + WORKFLOW_ID + '/activate', null);
  if (act.s !== 200) { console.log('Activate FAILED:', JSON.stringify(act.d).slice(0, 200)); await restore(wf); return; }
  console.log('Activated. Waiting 20s for webhook registration...');
  await sleep(20000);

  const wh = await httpGet('/webhook/' + wp);
  console.log('Webhook fired:', wh.s, String(wh.d).slice(0, 80));
  if (wh.s !== 200) { await restore(wf); return; }

  let execId = null;
  console.log('Watching execution (up to 10 min)...');
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const e = await api('GET', '/api/v1/executions?workflowId=' + WORKFLOW_ID + '&limit=5');
    const nx = (e.d.data || []).find(x => Number(x.id) > Number(lastId));
    if (nx) {
      if (!execId) { execId = nx.id; console.log('\nExecution #' + execId + ' — ' + nx.status); }
      if (nx.status !== 'running' && nx.status !== 'waiting' && nx.status !== 'new') {
        console.log('Finished:', nx.status); break;
      }
    }
    process.stdout.write(((i + 1) * 5) + 's ');
  }
  await restore(wf);
  if (!execId) { console.log('\nNo execution fired.'); return; }

  const det = await api('GET', '/api/v1/executions/' + execId + '?includeData=true');
  console.log('\n========== EXECUTION #' + execId + ' — ' + det.d.status + ' ==========');
  if (det.d.data && det.d.data.resultData && det.d.data.resultData.error)
    console.log('ERROR:', (det.d.data.resultData.error.message || '').slice(0, 200));
  const rd = det.d.data && det.d.data.resultData && det.d.data.resultData.runData;
  if (rd) {
    ['Webhook','Get Last Apify Run','Fetch Last Apify Dataset','Normalize All Jobs','Load Seen Job IDs',
     'Filter New Jobs','One Job At A Time','Generate Resume','Find HR Email','Compose Email',
     'Prepare PDF Binary','Has Email?','Send Email via Gmail','Log Applied Job'].forEach(name => {
      const nd = rd[name]; if (!nd) return;
      nd.forEach((run, ri) => {
        if (run.error) { console.log('  FAIL ' + name + '[' + ri + ']: ' + (run.error.message || '').slice(0, 120)); return; }
        const items = run.data && run.data.main && run.data.main[0];
        if (!items || !items.length) { console.log('  OK ' + name + '[' + ri + ']: 0 items'); return; }
        const j = (items[0] || {}).json || {};
        const info = { items: items.length };
        if (j.title) info.title = (j.title || '').slice(0, 30);
        if (j.company) info.co = j.company;
        if (j.hrEmail) info.email = j.hrEmail;
        if (j.emailSubject) info.subj = (j.emailSubject || '').slice(0, 55);
        if (j.resumeBase64) info.pdf = 'YES(' + Math.round(j.resumeBase64.length / 1024) + 'KB)';
        if (j.message) info.msg = j.message;
        console.log('  OK ' + name + '[' + ri + ']: ' + JSON.stringify(info));
      });
    });
  }
  console.log('==========================================================');
  console.log('\nDONE! Check keerthivanan7@gmail.com');
}

async function restore(wf) {
  await api('POST', '/api/v1/workflows/' + WORKFLOW_ID + '/deactivate', null);
  await api('PUT', '/api/v1/workflows/' + WORKFLOW_ID, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' }
  });
  console.log('Manual trigger restored.');
}

main().catch(console.error);
