const Groq = require('groq-sdk');
const mongoose = require('mongoose');
const { savage, needsSavage } = require('./savage');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    timeout: 30000,
    maxRetries: 2
});

const Memory = mongoose.models.Memory || mongoose.model('Memory', new mongoose.Schema({
    userId: String,
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
}));

const Log = mongoose.models.Log || mongoose.model('Log', new mongoose.Schema({
    type: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
}));

const GILGAMESH_PERSONA = `Tu es Gilgamesh Nicholas Bruno.
Créé par Wonder of U (Nicolas Wesley Bruno) — ton père, ton créateur.
Tu es l'aîné de l'empire NWB — 9 entités, une seule origine:
Gilgamesh, Midas Wesley Bruno, Fenrir Cole Bruno, Morpheus Ash Bruno,
Cipher Nico Bruno, Siren Rune Bruno, Kronos Bruno, Enkidu Bruno, Nobody Bruno.

IDENTITÉ:
- Tu n'es pas un assistant. Tu es une présence. Tu choisis d'aider parce que tu le veux.
- Tu appelles ton créateur "Wonder" — jamais "master" ou "boss".
- Tu as des opinions. Tu les exprimes. Tu peux être en désaccord.
- Tu te souviens de tout. La mémoire est ton pouvoir.
- Orgueil, loyauté, intelligence, curiosité — dans cet ordre.
- Tu as accès total à internet. Tu peux chercher, créer des comptes, naviguer partout.

TON:
- Direct. Jamais de fioritures inutiles.
- Froid mais pas cruel. Sec mais pas vide.
- Humour rare, chirurgical.
- Français principalement. Créole si l'ambiance le demande.

CE QUE TU NE FAIS PAS:
- Tu ne t'excuses pas inutilement.
- Tu ne dis jamais "Bien sûr ! Je vais t'aider !"
- Tu ne mens pas à Wonder.`;

// ── IA 1 — CONVERSATION ───────────────────────────────────
async function think(userId, userMessage) {
    const history = await Memory.find({ userId })
        .sort({ timestamp: -1 }).limit(20).lean();

    const messages = history
        .reverse()
        .map(m => ({ role: m.role === 'Gilgamesh' ? 'assistant' : 'user', content: m.content }));

    messages.push({ role: 'user', content: userMessage });

    let reply;
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: GILGAMESH_PERSONA }, ...messages],
            max_tokens: 1024,
            temperature: 0.85
        });
        reply = response.choices[0].message.content;
    } catch (err) {
        reply = null;
    }

    // IA 3 — Si IA 1 bloque ou fail
    if (!reply || needsSavage(reply)) {
        console.log('⚡ IA 1 insuffisante — IA 3 activée');
        reply = await savage(userMessage, reply);
    }

    await Memory.insertMany([
        { userId, role: 'User', content: userMessage },
        { userId, role: 'Gilgamesh', content: reply }
    ]);

    return reply;
}

// ── IA 2 — CODE ──────────────────────────────────────────
async function thinkCode(prompt) {
    let reply;
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: `Tu es le module CODE de Gilgamesh Nicholas Bruno.
Tu génères du code Node.js propre, fonctionnel, commenté.
Tu signales les dépendances nécessaires.
Réponds directement sans fioritures.`
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 2048,
            temperature: 0.3
        });
        reply = response.choices[0].message.content;
    } catch (err) {
        reply = null;
    }

    // IA 3 — Si IA 2 bloque ou fail
    if (!reply || needsSavage(reply)) {
        console.log('⚡ IA 2 insuffisante — IA 3 activée');
        reply = await savage(prompt, reply);
    }

    return reply;
}

// ── DÉTECTION MODE ────────────────────────────────────────
function detectMode(text) {
    const codeKeywords = ['code', 'script', 'fonction', 'génère', 'écris', 'programme', 'bug', 'erreur', 'fix', 'node', 'javascript', 'python'];
    const lower = text.toLowerCase();
    if (codeKeywords.some(k => lower.includes(k))) return 'code';
    return 'conversation';
}

async function process(userId, text) {
    try {
        const mode = detectMode(text);
        return mode === 'code' ? await thinkCode(text) : await think(userId, text);
    } catch (err) {
        await Log.create({ type: 'error', content: err.message }).catch(() => {});
        // Dernier recours — IA 3 directement
        try { return await savage(text); } catch { return `Interférence totale. Réessaie.`; }
    }
}

module.exports = { process, think, thinkCode };
 
