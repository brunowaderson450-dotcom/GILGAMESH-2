require('dotenv').config();
const nodemailer = require('nodemailer');
const ImapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');

// ── CONFIG GMAIL ───────────────────────────────────────────
let transporter = null;
let imapConnection = null;
let gmailCheckInterval = null;

const IMAP_CONFIG = {
    imap: {
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    }
};

// ── CALLBACKS GLOBAL ────────────────────────────────────────
let onMessageReceived = null;

// ── INITIALISER GMAIL (SEND) ───────────────────────────────
async function initGmailSend() {
    try {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        await transporter.verify();
        console.log('✅ Gmail (SEND) initialisé');
        return true;
    } catch (err) {
        console.error('❌ Erreur Gmail SEND:', err.message);
        return false;
    }
}

// ── INITIALISER GMAIL (RECEIVE) ────────────────────────────
async function initGmailReceive() {
    try {
        imapConnection = await ImapSimple.connect(IMAP_CONFIG);
        console.log('✅ Gmail (RECEIVE) initialisé — En écoute');
        
        // Marquer les anciens emails comme lus
        await imapConnection.search(['UNSEEN']);
        
        return true;
    } catch (err) {
        console.error('❌ Erreur Gmail RECEIVE:', err.message);
        return false;
    }
}

// ── VÉRIFIER NOUVEAUX EMAILS ───────────────────────────────
async function checkNewEmails() {
    try {
        if (!imapConnection) return;

        // Récupérer les emails non lus
        const messages = await imapConnection.search(['UNSEEN']);

        if (messages.length === 0) return;

        console.log(`📧 ${messages.length} nouvel(s) email(s) reçu(s)`);

        for (const message of messages) {
            try {
                const parsed = await imapConnection.getMailbox((box) => {
                    return new Promise((resolve, reject) => {
                        imapConnection.imap.openBox('INBOX', false, (err, box) => {
                            if (err) reject(err);
                            else {
                                imapConnection.imap.fetchOne(message.uid, 
                                    { bodies: '' }, 
                                    (err, msg) => {
                                        if (err) reject(err);
                                        else {
                                            simpleParser(msg, {}, (err, parsed) => {
                                                if (err) reject(err);
                                                else resolve(parsed);
                                            });
                                        }
                                    }
                                );
                            }
                        });
                    });
                });

                // Extraire info de l'email
                const from = parsed.from?.text || 'unknown';
                const subject = parsed.subject || '(no subject)';
                const text = parsed.text || parsed.html || '(empty)';
                const messageId = message.uid;

                console.log(`📨 De: ${from} | Sujet: ${subject}`);

                // Callback avec le message
                if (onMessageReceived) {
                    await onMessageReceived({
                        from,
                        subject,
                        text: text.slice(0, 500), // Limiter à 500 chars
                        messageId,
                        timestamp: new Date()
                    });
                }

                // Marquer comme lu
                await imapConnection.addFlags(message.uid, '\\Seen');

            } catch (msgErr) {
                console.error('❌ Erreur parsing email:', msgErr.message);
            }
        }
    } catch (err) {
        console.error('❌ Erreur vérification emails:', err.message);
    }
}

// ── DÉMARRER LA VÉRIFICATION (POLLING) ──────────────────────
function startEmailPolling(interval = 30000) {
    console.log(`⏱️ Vérification des emails tous les ${interval / 1000}s`);
    
    gmailCheckInterval = setInterval(async () => {
        await checkNewEmails();
    }, interval);
}

// ── ARRÊTER LA VÉRIFICATION ────────────────────────────────
function stopEmailPolling() {
    if (gmailCheckInterval) {
        clearInterval(gmailCheckInterval);
        console.log('⏸️ Vérification des emails arrêtée');
    }
}

// ── ENVOYER EMAIL ──────────────────────────────────────────
async function sendEmail(to, subject, body, isHtml = false) {
    try {
        if (!transporter) {
            console.warn('⚠️ Gmail SEND non initialisé');
            await initGmailSend();
        }

        const mailOptions = {
            from: process.env.GMAIL_BOT_ADDRESS,
            to: to,
            subject: subject,
            [isHtml ? 'html' : 'text']: body
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`📤 Email envoyé à ${to}`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('❌ Erreur envoi email:', err.message);
        return { success: false, error: err.message };
    }
}

// ── RÉPONDRE À UN EMAIL ────────────────────────────────────
async function replyToEmail(to, subject, message) {
    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
    return await sendEmail(to, replySubject, message);
}

// ── ENVOYER À TOI (WONDER) ─────────────────────────────────
async function sendToWonder(subject, message) {
    return await sendEmail(
        process.env.EMAIL_TO,
        `👑 Gilgamesh — ${subject}`,
        message
    );
}

// ── CONFIGURER LE CALLBACK ─────────────────────────────────
function onMessage(callback) {
    onMessageReceived = callback;
    console.log('🔔 Callback Gmail configuré');
}

// ── RAPPORT JOURNALIER (HTML) ──────────────────────────────
async function sendDailyReport(logs) {
    const htmlBody = `
    <div style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; padding: 20px; border-radius: 8px;">
        <h1 style="color: #ffd700;">👑 Rapport Gilgamesh</h1>
        <p><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
        <hr style="border-color: #ffd700;">
        <h2>📊 Résumé</h2>
        <pre style="background: #333; padding: 10px; border-radius: 5px; overflow-x: auto; color: #0f0;">
${logs.join('\n')}
        </pre>
        <hr style="border-color: #ffd700;">
        <p style="font-size: 12px; color: #888;">NWB Empire — Gilgamesh Nicholas Bruno 👑</p>
    </div>
    `;

    return await sendToWonder('Rapport Journalier', htmlBody);
}

// ── NOTIFICATION D'ERREUR ──────────────────────────────────
async function notifyWonder(event, details) {
    const subject = `[${event}] Alerte Gilgamesh`;
    const message = `
⚠️ ${event}

${Object.entries(details)
    .map(([key, value]) => `• ${key}: ${value}`)
    .join('\n')}

— ${new Date().toLocaleString('fr-FR')}
    `;

    return await sendToWonder(subject, message);
}

// ── DISCONNECT ─────────────────────────────────────────────
async function disconnect() {
    try {
        stopEmailPolling();
        if (imapConnection) {
            await imapConnection.end();
            console.log('✅ Gmail IMAP déconnecté');
        }
    } catch (err) {
        console.error('❌ Erreur déconnexion Gmail:', err.message);
    }
}

// ── EXPORT ─────────────────────────────────────────────────
module.exports = {
    initGmailSend,
    initGmailReceive,
    sendEmail,
    replyToEmail,
    sendToWonder,
    sendDailyReport,
    notifyWonder,
    onMessage,
    startEmailPolling,
    stopEmailPolling,
    disconnect,
    checkNewEmails
};
