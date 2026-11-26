// SOS TAG NFC — todo el servidor en un archivo: /api/crear, /api/tag, /api/alert
const crypto = require('crypto'), zlib = require('zlib');

/* ---------- ficha demo ---------- */
const DEMO = {
  "7F3A-92C1": {
    name: "María Ramírez Torres", age: 34, role: "Ciclista", city: "Guadalajara, Jal.", blood: "O+",
    allergies: ["Penicilina", "Látex", "Ibuprofeno"], conditions: ["Asma moderada", "Hipotiroidismo"],
    meds: ["Salbutamol inhalado", "Levotiroxina 50 mcg"], insurance: { name: "Seguro GNP", policy: "••••4821" },
    contacts: [{ name: "Luis Torres", rel: "Padre", phone: "+523300000001" }, { name: "Ana Ramírez", rel: "Hermana", phone: "+523300000002" }]
  }
};

/* ---------- token cifrado (AES-256-GCM) ---------- */
const key = () => {
  if (!process.env.TOKEN_SECRET) throw new Error('Falta TOKEN_SECRET');
  return crypto.createHash('sha256').update(process.env.TOKEN_SECRET).digest();
};
const encode = o => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(zlib.deflateRawSync(JSON.stringify(o))), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
};
const decode = t => {
  try {
    const b = Buffer.from(t, 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(zlib.inflateRawSync(Buffer.concat([d.update(b.subarray(28)), d.final()])).toString());
  } catch { return null; }
};
const lookup = id => DEMO[id] || (id.length > 40 ? decode(id) : null);

/* ---------- /api/crear ---------- */
const s = (v, n = 80) => String(v || '').replace(/[<>]/g, '').trim().slice(0, n);
const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => s(x, 60)).filter(Boolean).slice(0, 12);
const phone = v => {
  let t = String(v || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(t)) t = '+52' + t;
  return /^\+\d{10,15}$/.test(t) ? t : null;
};
function crear(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  const contacts = (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 3)
    .map(c => ({ name: s(c.name, 50), rel: s(c.rel, 30), phone: phone(c.phone) })).filter(c => c.name && c.phone);
  if (!s(b.name) || !contacts.length) return res.status(400).json({ error: 'Falta tu nombre o al menos un contacto con teléfono válido.' });
  const p = {
    name: s(b.name), age: parseInt(b.age) || '', role: s(b.role, 40), city: s(b.city, 50), blood: s(b.blood, 5) || '?',
    allergies: list(b.allergies), conditions: list(b.conditions), meds: list(b.meds),
    insurance: s(b.insurance) ? { name: s(b.insurance), policy: s(b.policy, 30) } : null, contacts
  };
  try { res.json({ url: `https://${req.headers.host}/t/${encode(p)}` }); }
  catch { res.status(500).json({ error: 'Servidor sin configurar: agrega la variable TOKEN_SECRET en Vercel y haz Redeploy.' }); }
}

/* ---------- /api/tag ---------- */
function tag(req, res) {
  const p = lookup(String(req.query.id || ''));
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...p, contacts: p.contacts.map(c => ({ name: c.name, rel: c.rel, tel: c.phone })) });
}

/* ---------- /api/alert ---------- */
const last = new Map(), WAIT = 5 * 60 * 1000;
async function twilio(to, from, body) {
  const sid = process.env.TWILIO_SID, tok = process.env.TWILIO_TOKEN;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });
  return r.ok;
}
async function alerta(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const t0 = Date.now(), { id, lat, lon, acc } = req.body || {};
  const p = lookup(String(id || ''));
  if (!p) return res.status(404).json({ error: 'not_found' });
  const n = last.get(id);
  if (n && Date.now() - n < WAIT) return res.json({ sent: 0, total: p.contacts.length, throttled: true });
  last.set(id, Date.now());
  const hasLoc = Number.isFinite(+lat) && Number.isFinite(+lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const loc = hasLoc
    ? `Ubicación: https://maps.google.com/?q=${(+lat).toFixed(5)},${(+lon).toFixed(5)}${Number.isFinite(+acc) ? ` (±${Math.round(acc)} m)` : ''}`
    : 'Ubicación no disponible (el tag fue escaneado sin permiso de GPS).';
  const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
  const body = `🚨 SOS TAG: ${p.name} fue escaneada tras un posible percance (${hora}). ${loc} Tipo ${p.blood}${p.allergies.length ? ', alergias: ' + p.allergies.join(', ') : ''}.`;
  const live = process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_SMS_FROM;
  let sent = 0;
  for (const c of p.contacts) {
    if (!live) { console.log('[DRY RUN]', c.phone, body); sent++; continue; }
    const jobs = [twilio(c.phone, process.env.TWILIO_SMS_FROM, body)];
    if (process.env.TWILIO_WA_FROM) jobs.push(twilio('whatsapp:' + c.phone, 'whatsapp:' + process.env.TWILIO_WA_FROM, body));
    const ok = await Promise.all(jobs.map(j => j.catch(() => false)));
    if (ok.some(Boolean)) sent++;
  }
  res.json({ sent, total: p.contacts.length, dry: !live, ms: Date.now() - t0 });
}

/* ---------- enrutador ---------- */
module.exports = (req, res) => {
  const a = String(req.query.action || '');
  if (a === 'crear') return crear(req, res);
  if (a === 'tag') return req.method === 'POST' ? alerta(req, res) : tag(req, res);
  if (a === 'alert') return alerta(req, res);
  res.status(404).json({ error: 'not_found' });
};
