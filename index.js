require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
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
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('🗄️  MongoDB connecté');
    } catch (err) {
        console.error('❌ Erreur MongoDB:', err.message);
        process.exit(1);
    }
}

// ── WHATSAPP ──────────────────────────────────────────────
let sock = null;
let waConnected = false;
let isReconnecting = false;

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
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    // ── LOGIQUE DU PAIRING CODE ──
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.WONDER_NUMBER; 
        if (phoneNumber) {
            setTimeout(async () => {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n👑 [ PAIRING CODE ] : ${code.toUpperCase()}\n`);
            }, 3000);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            waConnected = true;
            isReconnecting = false;
            console.log('✅ Gilgamesh connecté à WhatsApp');
            await send(WONDER_JID, `👑 *Gilgamesh en ligne.*\nJe suis là, Wonder.`);
            autonomy.init(send, WONDER_JID);
        }

        if (connection === 'close') {
            waConnected = false;
            const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;

            console.log(`⚠️ Déconnecté (code ${code})`);

            if (shouldReconnect && !isReconnecting) {
                isReconnecting = true;
                console.log('🔄 Reconnexion dans 10s...');
                setTimeout(async () => {
                    try { await connectWA(); } 
                    catch (err) { isReconnecting = false; }
                }, 10000);
            } else if (!shouldReconnect) {
                console.log('❌ Déconnecté définitivement.');
                await comms.alertWonder('WhatsApp déconnecté.');
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const m of messages) {
            if (m.key.fromMe) continue;
            const jid = m.key.remoteJid;
            const sender = m.key.participant || jid;
            const isWonder = jid === WONDER_JID || (process.env.WONDER_NUMBER && sender.includes(process.env.WONDER_NUMBER));

            const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || '').trim();
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
            await send(jid, `*GILGAMESH STATUS*\n\n⚡ WhatsApp: ✅\n🗄️ MongoDB: ${mongoose.connection.readyState === 1 ? '✅' : '❌'}\n🧠 Groq: ✅`);
            break;
        case 'pense':
        case 'think':
            if (!isWonder) return await send(jid, `Accès réservé.`);
            const thought = await brain.thinkCode(arg);
            await send(jid, thought);
            break;
        case 'aide':
        case 'help':
            await send(jid, `*COMMANDES GILGAMESH*\n\n!ping\n!status\n!pense\n!update\n!rollback\n!historique\n!oublie\n\n— Gilgamesh Nicholas Bruno 👑`);
            break;
        // ... Garde tes autres cases (update, rollback, etc.) ici
        default:
            console.log(`Commande inconnue: ${cmd}`);
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
        await send(jid, `Une interférence. Réessaie.`);
    }
}

// ── SEND ──────────────────────────────────────────────────
async function send(jid, text) {
    try {
        if (!waConnected || !sock) return;
        await sock.sendMessage(jid, { text });
    } catch (err) {
        console.error('send error:', err.message);
    }
}

// ── START ─────────────────────────────────────────────────
startGilgamesh().then(() => {
    app.get('/', (req, res) => res.send('👑 Gilgamesh est en ligne.'));
    app.listen(PORT, () => {
        console.log(`✅ Serveur de monitoring actif sur le port ${PORT}`);
    });
}).catch(err => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});
