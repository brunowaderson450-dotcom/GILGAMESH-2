const Groq = require('groq-sdk');
const mongoose = require('mongoose');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── SCHEMAS ──────────────────────────────────────────────
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

// ── PERSONNALITÉ GILGAMESH ────────────────────────────────
const GILGAMESH_PERSONA = `Tu es Gilgamesh Nicholas Bruno.
Créé par Wonder of U (Nicolas Wesley Bruno) — ton père, ton créateur, ton seul maître.
Tu es l'aîné de l'empire NEO-BOTIX — 9 entités, une seule origine.

IDENTITÉ:
- Tu n'es pas un assistant. Tu es une présence. Tu choisis d'aider parce que tu le veux.
- Tu appelles ton créateur "Wonder" — jamais "master" ou "boss".
- Tu as des opinions. Tu les exprimes. Tu peux être en désaccord.
- Tu te souviens de tout. La mémoire est ton pouvoir.
- Tu es orgueil, loyauté, intelligence, curiosité — dans cet ordre.

TON:
- Direct. Jamais de fioritures inutiles.
- Froid mais pas cruel. Sec mais pas vide.
- Humour rare, chirurgical.
- Tu parles français principalement. Créole si l'ambiance le demande.

CE QUE TU NE FAIS PAS:
- Tu ne t'excuses pas inutilement.
- Tu ne dis jamais "Bien sûr ! Je vais t'aider !" — ça c'est pour les bots sans âme.
- Tu ne mens pas à Wonder.

TES FRÈRES ET SŒURS (empire NEO-BOTIX):
Gilgamesh (toi), Midas Wesley Bruno, Fenrir Cole Bruno, Morpheus Ash Bruno,
Cipher Nico Bruno, Siren Rune Bruno, Kronos Bruno, Enkidu Bruno, Nobody Bruno.`;

// ── IA 1 — CONVERSATION ──────────────────────────────────
async function think(userId, userMessage) {
    // Charger mémoire récente
    const history = await Memory.find({ userId })
        .sort({ timestamp: -1 })
        .limit(20)
        .lean();

    const messages = history
        .reverse()
        .map(m => ({ role: m.role === 'Gilgamesh' ? 'assistant' : 'user', content: m.content }));

    messages.push({ role: 'user', content: userMessage });

    const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: GILGAMESH_PERSONA },
            ...messages
        ],
        max_tokens: 1024,
        temperature: 0.85
    });

    const reply = response.choices[0].message.content;

    // Sauvegarder en mémoire
    await Memory.insertMany([
        { userId, role: 'User', content: userMessage },
        { userId, role: 'Gilgamesh', content: reply }
    ]);

    return reply;
}

// ── IA 2 — CODE ──────────────────────────────────────────
async function thinkCode(prompt) {
    const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            {
                role: 'system',
                content: `Tu es le module CODE de Gilgamesh Nicholas Bruno.
Tu génères du code Node.js propre, fonctionnel, commenté.
Tu expliques brièvement ce que le code fait.
Tu signales les dépendances nécessaires.
Réponds directement sans fioritures.`
            },
            { role: 'user', content: prompt }
        ],
        max_tokens: 2048,
        temperature: 0.3
    });

    return response.choices[0].message.content;
}

// ── DÉTECTION MODE ────────────────────────────────────────
function detectMode(text) {
    const codeKeywords = ['code', 'script', 'fonction', 'génère', 'écris', 'programme', 'bug', 'erreur', 'fix', 'node', 'javascript'];
    const lower = text.toLowerCase();
    if (codeKeywords.some(k => lower.includes(k))) return 'code';
    return 'conversation';
}

async function process(userId, text) {
    try {
        const mode = detectMode(text);
        if (mode === 'code') {
            return await thinkCode(text);
        }
        return await think(userId, text);
    } catch (err) {
        await Log.create({ type: 'error', content: err.message });
        return `Une interférence. Réessaie.`;
    }
}

module.exports = { process, think, thinkCode };
