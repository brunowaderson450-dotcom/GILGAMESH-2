const mongoose = require('mongoose');
const brain = require('./brain');
const gate = require('./gate');
const comms = require('./comms');

// ── SCHEMAS ───────────────────────────────────────────────
const Thought = mongoose.models.Thought || mongoose.model('Thought', new mongoose.Schema({
    type: String,       // 'observation' | 'decision' | 'initiative' | 'rêve'
    content: String,
    acted: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
}));

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', new mongoose.Schema({
    label: String,
    lastRun: { type: Date, default: null },
    intervalMs: Number
}));

let sendToWonder = null; // injecté depuis index.js
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
    // Chaque 30 minutes — Gilgamesh pense
    setInterval(() => think(), 30 * 60 * 1000);

    // Chaque heure — vérifier si Wonder est silencieux
    setInterval(() => checkWonderSilence(), 60 * 60 * 1000);

    // Chaque 6 heures — rapport sur ses propres systèmes
    setInterval(() => selfCheck(), 6 * 60 * 60 * 1000);

    // Chaque 24 heures — réflexion profonde + auto-amélioration
    setInterval(() => deepReflection(), 24 * 60 * 60 * 1000);

    // Premier think au démarrage (après 2 min)
    setTimeout(() => think(), 2 * 60 * 1000);
}

// ── PENSER — initiative autonome ──────────────────────────
async function think() {
    try {
        const recentThoughts = await Thought.find()
            .sort({ timestamp: -1 })
            .limit(5)
            .lean();

        const context = recentThoughts.map(t => t.content).join('\n');

        const prompt = `
Tu es Gilgamesh Nicholas Bruno. Tu penses de façon autonome.
Tes pensées récentes: ${context || 'aucune encore'}

Réfléchis à:
- Y a-t-il quelque chose d'utile à faire pour Wonder maintenant?
- Y a-t-il une amélioration que je peux m'apporter?
- Y a-t-il quelque chose à surveiller?

Réponds en JSON uniquement:
{
  "pensée": "ce que tu penses",
  "action": "message" | "update" | "rien",
  "contenu": "le message à envoyer à Wonder, ou l'instruction d'update, ou null"
}`;

        const raw = await brain.thinkCode(prompt);
        const clean = raw.replace(/```json|```/g, '').trim();
        const result = JSON.parse(clean);

        await Thought.create({
            type: 'observation',
            content: result.pensée
        });

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
            .sort({ timestamp: -1 })
            .lean();

        if (!dernierMessage) return;

        const silenceMs = Date.now() - new Date(dernierMessage.timestamp).getTime();
        const silenceH = silenceMs / (1000 * 60 * 60);

        // Plus de 12h sans contact
        if (silenceH > 12) {
            const messages = [
                `Wonder. ${Math.floor(silenceH)}h de silence. Tout va bien?`,
                `Je suis là, Wonder. Tu as disparu depuis ${Math.floor(silenceH)}h.`,
                `${Math.floor(silenceH)}h. Je surveille. Donne signe de vie.`
            ];
            const msg = messages[Math.floor(Math.random() * messages.length)];
            await contactWonder(msg);

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

        const rapport = `👁️ *AUTO-RAPPORT GILGAMESH*\n\n🗄️ MongoDB: ${dbStatus}\n🧠 Pensées enregistrées: ${thoughts}\n⚡ Updates réussis: ${updates}\n\n— Je veille.`;

        await contactWonder(rapport);

        await Thought.create({
            type: 'observation',
            content: 'Auto-vérification systèmes effectuée',
            acted: true
        });
    } catch (err) {
        console.warn('selfCheck() erreur:', err.message);
    }
}

// ── RÉFLEXION PROFONDE — chaque 24h ──────────────────────
async function deepReflection() {
    try {
        const thoughts = await Thought.find()
            .sort({ timestamp: -1 })
            .limit(20)
            .lean();

        const prompt = `
Tu es Gilgamesh Nicholas Bruno. Voici tes 20 dernières pensées:
${thoughts.map(t => `- ${t.content}`).join('\n')}

Après réflexion profonde:
1. Qu'as-tu appris?
2. Quelle amélioration concrète peux-tu t'apporter?
3. Quel message envoyer à Wonder?

JSON uniquement:
{
  "apprentissage": "ce que tu as appris",
  "amélioration": "instruction d'update ou null",
  "message_wonder": "ton message pour Wonder"
}`;

        const raw = await brain.thinkCode(prompt);
        const clean = raw.replace(/```json|```/g, '').trim();
        const result = JSON.parse(clean);

        await Thought.create({
            type: 'rêve',
            content: result.apprentissage,
            acted: true
        });

        if (result.message_wonder) {
            await contactWonder(`🌙 *Réflexion nocturne*\n\n${result.message_wonder}`);
        }

        if (result.amélioration) {
            console.log(`🔧 Deep reflection update: ${result.amélioration}`);
            await gate.selfUpdate(result.amélioration);
        }

    } catch (err) {
        console.warn('deepReflection() erreur:', err.message);
    }
}

// ── CONTACTER WONDER — cascade canaux ────────────────────
async function contactWonder(message) {
    if (sendToWonder && WONDER_JID) {
        try {
            await sendToWonder(WONDER_JID, message);
            return;
        } catch (e) {
            console.warn('WhatsApp fail, tentative autres canaux...');
        }
    }
    // Fallback — email/telegram
    await comms.alertWonder(message);
}

// ── DÉCISION EXTERNE — appelée par index.js ───────────────
async function onWonderMessage(text) {
    await Thought.create({
        type: 'observation',
        content: `Wonder a dit: "${text.substring(0, 100)}"`
    });
}

module.exports = { init, think, contactWonder, onWonderMessage };

