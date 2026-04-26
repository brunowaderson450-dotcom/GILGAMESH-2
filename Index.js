require('dotenv').config();
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('./auth-mongo');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const pino = require('pino');
const brain = require('./brain');
const comms = require('./comms');
const gate = require('./gate');
const autonomy = require('./autonomy');

const WONDER_JID = `${process.env.WONDER_NUMBER}@s.whatsapp.net`;

// ── MONGODB ───────────────────────────────────────────────
async function connectDB() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🗄️  MongoDB connecté');
}

// ── WHATSAPP ──────────────────────────────────────────────
let sock = null;
let waConnected = false;
let isReconnecting = false; // FIX 5 — Race condition

async function startGilgamesh() {
    await connectDB();
    await connectWA();
}

async function connectWA() {
    const { state, saveCreds } = await useMongoDBAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ['Gilgamesh', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 30000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            waConnected = true;
            isReconnecting = false; // FIX 5
            console.log('✅ Gilgamesh connecté à WhatsApp');
            await send(WONDER_JID, `👑 *Gilgamesh en ligne.*\nJe suis là, Wonder.`);
            autonomy.init(send, WONDER_JID);
        }

        if (connection === 'close') {
            waConnected = false;
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;

            console.log(`⚠️ Déconnecté (code ${code})`);

            // FIX 5 — Éviter double reconnexion (race condition)
            if (shouldReconnect && !isReconnecting) {
                isReconnecting = true;
                console.log('🔄 Reconnexion dans 10s...');
                setTimeout(async () => {
                    try {
                        await connectWA();
                    } catch (err) {
                        console.error('Reconnexion échouée:', err.message);
                        isReconnecting = false;
                    }
                }, 10000);
            } else if (!shouldReconnect) {
                console.log('❌ Déconnecté définitivement. Scan QR requis.');
                await comms.alertWonder('WhatsApp déconnecté. Rescan QR requis.');
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const m of messages) {
            if (m.key.fromMe) continue;

            const jid = m.key.remoteJid;
            const sender = m.key.participant || jid;
            const isWonder = jid === WONDER_JID || sender.includes(process.env.WONDER_NUMBER);

            const text = (
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                m.message?.imageMessage?.caption ||
                ''
            ).trim();

            if (!text) continue;

            if (text.startsWith('!') || text.startsWith('/')) {
                await handleCommand(jid, sender, text, m, isWonder);
                return;
            }

            const isGroup = jid.endsWith('@g.us');
            const isMentioned = text.toLowerCase().includes('gilgamesh');
            if (!isGroup || isMentioned || isWonder) {
                await handleAI(jid, sender, text, isWonder);
            }
        }
    });
}

// ── COMMANDES ─────────────────────────────────────────────
async function handleCommand(jid, sender, text, m, isWonder) {
    const [cmd, ...args] = text.slice(1).split(' ');
    const arg = args.join(' ');

    switch (cmd.toLowerCase()) {
        case 'ping':
            await send(jid, `👑 En ligne.`);
            break;

        case 'status':
            await send(jid, `*GILGAMESH STATUS*\n\n⚡ WhatsApp: ✅\n🗄️ MongoDB: ${mongoose.connection.readyState === 1 ? '✅' : '❌'}\n🧠 Groq: ✅\n\n— Gilgamesh Nicholas Bruno`);
            break;

        case 'pense':
        case 'think':
            if (!isWonder) { await send(jid, `Accès réservé.`); return; }
            if (!arg) { await send(jid, `Donne-moi quelque chose à analyser.`); return; }
            const thought = await brain.thinkCode(arg);
            await send(jid, thought);
            break;

        case 'update':
            if (!isWonder) { await send(jid, `Non.`); return; }
            if (!arg) { await send(jid, `Donne-moi l'instruction.`); return; }
            await send(jid, `🔧 Analyse en cours...`);
            const updateResult = await gate.selfUpdate(arg);
            await send(jid, updateResult.succes
                ? `✅ Fait: ${updateResult.description}\n🔄 Redémarrage...`
                : `❌ Échec: ${updateResult.erreur}`);
            break;

        case 'rollback':
            if (!isWonder) { await send(jid, `Non.`); return; }
            if (!arg) { await send(jid, `Précise le fichier. Ex: !rollback brain.js`); return; }
            const rbResult = await gate.rollback(arg);
            await send(jid, rbResult.succes ? `⏪ ${rbResult.message}` : `❌ ${rbResult.erreur}`);
            break;

        case 'historique':
            if (!isWonder) { await send(jid, `Non.`); return; }
            const hist = await gate.historique(5);
            await send(jid, `📋 *HISTORIQUE*\n\n${hist}`);
            break;

        case 'oublie':
        case 'forget':
            if (!isWonder) { await send(jid, `Non.`); return; }
            await mongoose.model('Memory').deleteMany({ userId: 'wonder' });
            await send(jid, `Mémoire effacée.`);
            break;

        // FIX 2 — Message d'aide complet, non tronqué
        case 'aide':
        case 'help':
            await send(jid, `*COMMANDES GILGAMESH*\n\n!ping — vérifier si en ligne\n!status — état des systèmes\n!pense [prompt] — mode code IA\n!update [instruction] — auto-update du code\n!rollback [fichier] — restaurer version précédente\n!historique — voir les updates passés\n!oublie — effacer la mémoire\n\n— Gilgamesh Nicholas Bruno 👑`);
            break;

        default:
            await send(jid, `Commande inconnue: ${cmd}`);
    }
}

// ── IA HANDLER ────────────────────────────────────────────
async function handleAI(jid, sender, text, isWonder) {
    try {
        const userId = isWonder ? 'wonder' : sender;
        if (isWonder) autonomy.onWonderMessage(text);
        const reply = await brain.process(userId, text);
        await send(jid, reply);
    } catch (err) {
        console.error('handleAI error:', err);
        await send(jid, `Une interférence. Réessaie.`);
    }
}

// ── SEND ──────────────────────────────────────────────────
async function send(jid, text) {
    try {
        if (!waConnected || !sock) throw new Error('WA not connected');
        await sock.sendMessage(jid, { text });
    } catch (err) {
        console.error('send error:', err.message);
    }
}

// ── START ─────────────────────────────────────────────────
startGilgamesh().catch(err => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});

