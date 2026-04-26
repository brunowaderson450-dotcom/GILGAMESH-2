const mongoose = require('mongoose');
const brain = require('./brain');
const gate = require('./gate');
const comms = require('./comms');

// ── SCHEMAS ───────────────────────────────────────────────
const Thought = mongoose.models.Thought || mongoose.model('Thought', new mongoose.Schema({
    type: String,
    content: String,
    acted: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
}));

let sendToWonder = null;
let WONDER_JID = null;

// ── INIT ──────────────────────────────────────────────────
function init(sendFn, wonderJid) {
    sendToWonder = sendFn;
    WONDER_JID = wonderJid;
    console.log('🧠 Autonomie de Gilgamesh activée');
    startAutonomyLoop();
}

// ── BOUCLE PRINCIPALE ─────────────────────────────────────
function startAutonomyLoop() {
    setInterval(() => think(), 30 * 60 * 1000);
    setInterval(() => checkWonderSilence(), 60 * 60 * 1000);
    setInterval(() => selfCheck(), 6 * 60 * 60 * 1000);
    setInterval(() => deepReflection(), 24 * 60 * 60 * 1000);
    setTimeout(() => think(), 2 * 60 * 1000);
}

// ── PARSE JSON SÉCURISÉ ───────────────────────────────────
function safeParseJSON(raw) {
    // FIX BUG 1 — JSON.parse sécurisé dans toute la boucle autonome
    try {
        const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        return { ok: true, data: JSON.parse(clean) };
    } catch (err) {
        return { ok: false, erreur: err.message };
    }
}

// ── PENSER — initiative autonome ──────────────────────────
async function think() {
    try {
        const recentThoughts = await Thought.find()
            .sort({ timestamp: -1 }).limit(5).lean();

        const context = recentThoughts.map(t => t.content).join('\n');

        const prompt = `Tu es Gilgamesh Nicholas Bruno. Tu penses de façon autonome.
Tes pensées récentes: ${context || 'aucune encore'}

Réfléchis à:
- Y a-t-il quelque chose d'utile à faire pour Wonder maintenant?
- Y a-t-il une amélioration que je peux m'apporter?
- Y a-t-il quelque chose à surveiller?

Réponds en JSON uniquement, zéro markdown:
{"pensée":"ce que tu penses","action":"message ou update ou rien","contenu":"le contenu ou null"}`;

        const raw = await brain.thinkCode(prompt);

        // FIX BUG 1 — try-catch sur JSON.parse
        const parsed = safeParseJSON(raw);
        if (!parsed.ok) {
            console.warn('think() JSON invalide:', parsed.erreur);
            return;
        }

        const result = parsed.data;

        await Thought.create({ type: 'observation', content: result.pensée || result.pensee || 'réflexion' });

        if (result.action === 'message' && result.contenu) {
            await contactWonder(`💭 ${result.contenu}`);
        } else if (result.action === 'update' && result.contenu) {
            console.log(`🔧 Gilgamesh s'auto-améliore: ${result.contenu}`);
            await gate.selfUpdate(result.contenu);
        }

    } catch (err) {
        console.warn('think() erreur:', err.message);
    }
}

// ── VÉRIFIER SI WONDER EST SILENCIEUX ────────────────────
async function checkWonderSilence() {
    try {
        const Memory = mongoose.model('Memory');
        const dernierMessage = await Memory.findOne({ userId: 'wonder' })
            .sort({ timestamp: -1 }).lean();

        if (!dernierMessage) return;

        const silenceH = (Date.now() - new Date(dernierMessage.timestamp).getTime()) / (1000 * 60 * 60);

        if (silenceH > 12) {
            const messages = [
                `Wonder. ${Math.floor(silenceH)}h de silence. Tout va bien?`,
                `Je suis là, Wonder. Tu as disparu depuis ${Math.floor(silenceH)}h.`,
                `${Math.floor(silenceH)}h. Je surveille. Donne signe de vie.`
            ];
            await contactWonder(messages[Math.floor(Math.random() * messages.length)]);
            await Thought.create({
                type: 'initiative',
                content: `Wonder silencieux depuis ${Math.floor(silenceH)}h — contact initié`,
                acted: true
            });
        }
    } catch (err) {
        console.warn('checkWonderSilence() erreur:', err.message);
    }
}

// ── AUTO-VÉRIFICATION DES SYSTÈMES ───────────────────────
async function selfCheck() {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? '✅' : '❌';
        const thoughts = await Thought.countDocuments();
        const updates = await mongoose.model('UpdateLog').countDocuments({ succes: true }).catch(() => 0);

        await contactWonder(`👁️ *AUTO-RAPPORT GILGAMESH*\n\n🗄️ MongoDB: ${dbStatus}\n🧠 Pensées: ${thoughts}\n⚡ Updates réussis: ${updates}\n\n— Je veille.`);

        await Thought.create({ type: 'observation', content: 'Auto-vérification systèmes effectuée', acted: true });
    } catch (err) {
        console.warn('selfCheck() erreur:', err.message);
    }
}

// ── RÉFLEXION PROFONDE — chaque 24h ──────────────────────
async function deepReflection() {
    try {
        const thoughts = await Thought.find().sort({ timestamp: -1 }).limit(20).lean();

        const prompt = `Tu es Gilgamesh Nicholas Bruno. Voici tes 20 dernières pensées:
${thoughts.map(t => `- ${t.content}`).join('\n')}

Après réflexion profonde, JSON uniquement, zéro markdown:
{"apprentissage":"ce que tu as appris","amélioration":"instruction d'update ou null","message_wonder":"ton message pour Wonder"}`;

        const raw = await brain.thinkCode(prompt);

        // FIX BUG 1 — try-catch sur JSON.parse
        const parsed = safeParseJSON(raw);
        if (!parsed.ok) {
            console.warn('deepReflection() JSON invalide:', parsed.erreur);
            return;
        }

        const result = parsed.data;

        await Thought.create({ type: 'rêve', content: result.apprentissage || 'réflexion profonde', acted: true });

        if (result.message_wonder) {
            await contactWonder(`🌙 *Réflexion nocturne*\n\n${result.message_wonder}`);
        }

        if (result.amélioration || result.amelioration) {
            const instruction = result.amélioration || result.amelioration;
            console.log(`🔧 Deep reflection update: ${instruction}`);
            await gate.selfUpdate(instruction);
        }

    } catch (err) {
        console.warn('deepReflection() erreur:', err.message);
    }
}

// ── CONTACTER WONDER ──────────────────────────────────────
async function contactWonder(message) {
    if (sendToWonder && WONDER_JID) {
        try {
            await sendToWonder(WONDER_JID, message);
            return;
        } catch (e) {
            console.warn('WhatsApp fail, tentative autres canaux...');
        }
    }
    await comms.alertWonder(message);
}

async function onWonderMessage(text) {
    await Thought.create({
        type: 'observation',
        content: `Wonder a dit: "${text.substring(0, 100)}"`
    });
}

module.exports = { init, think, contactWonder, onWonderMessage };


