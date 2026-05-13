require('dotenv').config();
const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const brain = require('../brain');

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_WONDER = process.env.EMAIL_TO;

// ── ENVOI ─────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

async function sendEmail(to, subject, body) {
    try {
        await transporter.sendMail({
            from: `Gilgamesh Nicholas Bruno <${EMAIL_USER}>`,
            to, subject, text: body
        });
        console.log(`📧 Email envoyé à ${to}`);
        return { success: true };
    } catch (err) {
        console.error('❌ Envoi email:', err.message);
        return { success: false };
    }
}

async function sendToWonder(subject, message) {
    return await sendEmail(EMAIL_WONDER, `👑 Gilgamesh — ${subject}`, message);
}

async function alertWonder(message) {
    return await sendToWonder('Alerte', message);
}

// ── LECTURE IMAP ──────────────────────────────────────────
function startEmailListener() {
    if (!EMAIL_USER || !EMAIL_PASS) {
        console.log('⚠️ Gmail: credentials manquants');
        return;
    }

    const imap = new Imap({
        user: EMAIL_USER,
        password: EMAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
        console.log('📧 Gmail connecté — Gilgamesh écoute...');
        imap.openBox('INBOX', false, (err, box) => {
            if (err) return console.error('❌ Inbox:', err.message);

            imap.on('mail', () => {
                const fetch = imap.seq.fetch(`${box.messages.total}:*`, {
                    bodies: '', markSeen: true
                });
                fetch.on('message', (msg) => {
                    msg.on('body', async (stream) => {
                        try {
                            const parsed = await simpleParser(stream);
                            const text = parsed.text?.trim();
                            if (!text) return;
                            const fromEmail = parsed.from?.value?.[0]?.address;
                            const subject = parsed.subject || 'Sans sujet';
                            console.log(`📧 Email de: ${fromEmail}`);
                            const reply = await brain.process('gmail_' + fromEmail, text);
                            await sendEmail(fromEmail, `Re: ${subject}`, reply);
                        } catch (e) {
                            console.error('❌ Traitement email:', e.message);
                        }
                    });
                });
            });
        });
    });

    imap.once('error', (err) => {
        console.error('❌ Gmail IMAP:', err.message);
        setTimeout(startEmailListener, 30000);
    });

    imap.once('end', () => {
        console.log('⚠️ Gmail déconnecté. Reconnexion 30s...');
        setTimeout(startEmailListener, 30000);
    });

    imap.connect();
}

module.exports = { sendEmail, sendToWonder, alertWonder, startEmailListener };
