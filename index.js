require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const mongoose = require('mongoose');
const brain = require('./brain');
const gate = require('./gate');
const autonomy = require('./autonomy');
const comms = require('./comms');

// ── CHANNELS ──────────────────────────────────────────────
const gmailChannel = require('./channels/gmail');
const telegramChannel = require('./channels/telegram');
const whatsappChannel = require('./channels/whatsapp');

// ── MONITORING ────────────────────────────────────────────
app.get('/', (req, res) => res.send('👑 Gilgamesh est en ligne.'));

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        mongodb: mongoose.connection.readyState === 1 ? '✅' : '❌',
        whatsapp: global.waConnected ? '✅' : '❌',
        timestamp: new Date().toISOString()
    });
});

app.get('/reset-auth', async (req, res) => {
    try {
        const collections = mongoose.connection.collections;
        if (collections['auths']) {
            await collections['auths'].deleteMany({});
        }
        res.send('✅ Auth reset. Redémarre le service sur Render.');
    } catch (err) {
        res.status(500).send(`❌ Erreur: ${err.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`✅ Serveur de monitoring actif sur le port ${PORT}`);
});

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

// ── GMAIL ──────────────────────────────────────────────────
const gmailChannel = require('./channels/gmail');

async function startGilgamesh() {
    console.log('👑 Gilgamesh Nicholas Bruno — Démarrage...');
    await connectDB();
    
    // Initialiser Gmail
    await gmailChannel.initGmail();
    
    // Envoyer notification de démarrage
    await gmailChannel.sendToWonder(
        'Démarrage',
        `Gilgamesh est en ligne.\n\nHeure: ${new Date().toLocaleString('fr-FR')}`
    );

    connectWA().catch(err => {
        console.error('⚠️ WhatsApp non disponible:', err.message);
    });

    console.log('👑 Gilgamesh en ligne. Empire NWB actif.');
}

// ── WHATSAPP ──────────────────────────────────────────────
global.waConnected = false;
let sock = null;
let isReconnecting = false;

async function connectWA() {
    try {
        const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
        const { useMongoDBAuthState } = require('./auth-mongo');
        const { Boom } = require('@hapi/boom');
        const pino = require('pino');

        const WONDER_JID = `${process.env.WONDER_NUMBER}@s.whatsapp.net`;

        const { state, saveCreds } = await useMongoDBAuthState();
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
        });

        if (!sock.authState.creds.registered) {
            const phoneNumber = process.env.WONDER_NUMBER;
            if (phoneNumber) {
                setTimeout(async () => {
                    try {
                        let code = await sock.requestPairingCode(phoneNumber);
                        code = code?.match(/.{1,4}/g)?.join("-") || code;
                        console.log(`\n👑 [ PAIRING CODE ] : ${code.toUpperCase()}\n`);
                    } catch (err) {
                        console.error('❌ Pairing error:', err.message);
                        setTimeout(async () => {
                            try {
                                let code = await sock.requestPairingCode(phoneNumber);
                                code = code?.match(/.{1,4}/g)?.join("-") || code;
                                console.log(`\n👑 [ PAIRING CODE RETRY ] : ${code.toUpperCase()}\n`);
                            } catch (e) {
                                console.error('❌ Pairing définitivement échoué:', e.message);
                            }
                        }, 15000);
                    }
                }, 3000);
            }
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                global.waConnected = true;
                isReconnecting = false;
                console.log('✅ Gilgamesh connecté à WhatsApp');
                await send(WONDER_JID, `👑 *Gilgamesh en ligne.*\nJe suis là, Wonder.`);
                autonomy.init(send, WONDER_JID);
            }

            if (connection === 'close') {
                global.waConnected = false;
                const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = code !== DisconnectReason.loggedOut;
                console.log(`⚠️ WhatsApp déconnecté (code ${code})`);

                if (shouldReconnect && !isReconnecting) {
                    isReconnecting = true;
                    console.log('🔄 Reconnexion dans 15s...');
                    setTimeout(async () => {
                        try { await connectWA(); }
                        catch (err) { isReconnecting = false; }
                    }, 15000);
                } else if (!shouldReconnect) {
                    console.log('❌ WhatsApp déconnecté définitivement.');
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

                const text = (
                    m.message?.conversation ||
                    m.message?.extendedTextMessage?.text ||
                    m.message?.imageMessage?.caption || ''
                ).trim();
                if (!text) continue;

                if (text.startsWith('!') || text.startsWith('/')) {
                    await handleCommand(jid, sender, text, isWonder);
                    return;
                }

                const isGroup = jid.endsWith('@g.us');
                const isMentioned = text.toLowerCase().includes('gilgamesh');
                if (!isGroup || isMentioned || isWonder) {
                    await handleAI(jid, sender, text, isWonder);
                }
            }
        });

    } catch (err) {
        console.error('❌ WhatsApp init error:', err.message);
        console.log('⚠️ Gilgamesh continue sans WhatsApp...');
    }
}

// ── COMMANDES ─────────────────────────────────────────────
async function handleCommand(jid, sender, text, isWonder) {
    const [cmd, ...args] = text.slice(1).split(' ');
    const arg = args.join(' ');

    switch (cmd.toLowerCase()) {
        case 'ping':
            await send(jid, `👑 En ligne.`);
            break;
        case 'status':
            await send(jid, `*GILGAMESH STATUS*\n\n⚡ WhatsApp: ${global.waConnected ? '✅' : '❌'}\n🗄️ MongoDB: ${mongoose.connection.readyState === 1 ? '✅' : '❌'}\n🧠 Groq: ✅\n⚡ Savage: ✅`);
            break;
        case 'pense':
        case 'think':
            if (!isWonder) return await send(jid, `Accès réservé.`);
            const thought = await brain.thinkCode(arg);
            await send(jid, thought);
            break;
        case 'update':
            if (!isWonder) return await send(jid, `Accès réservé.`);
            const result = await gate.selfUpdate(arg);
            await send(jid, result.succes ? `✅ ${result.message}` : `❌ ${result.erreur}`);
            break;
        case 'rollback':
            if (!isWonder) return await send(jid, `Accès réservé.`);
            const rb = await gate.rollback(arg);
            await send(jid, rb.succes ? `✅ ${rb.message}` : `❌ ${rb.erreur}`);
            break;
        case 'historique':
            if (!isWonder) return await send(jid, `Accès réservé.`);
            const hist = await gate.historique();
            await send(jid, hist);
            break;
        case 'aide':
        case 'help':
            await send(jid, `*COMMANDES GILGAMESH*\n\n!ping\n!status\n!pense [prompt]\n!update [instruction]\n!rollback [fichier]\n!historique\n\n— Gilgamesh Nicholas Bruno 👑`);
            break;
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
        if (!global.waConnected || !sock) return;
        await sock.sendMessage(jid, { text });
    } catch (err) {
        console.error('send error:', err.message);
    }
}

// ── START ─────────────────────────────────────────────────
async function startGilgamesh() {
    console.log('👑 Gilgamesh Nicholas Bruno — Démarrage...');
    await connectDB();

    // WhatsApp — optionnel, ne bloque pas le démarrage
    connectWA().catch(err => {
        console.error('⚠️ WhatsApp non disponible:', err.message);
    });

    console.log('👑 Gilgamesh en ligne. Empire NWB actif.');
}

startGilgamesh().catch(err => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});
