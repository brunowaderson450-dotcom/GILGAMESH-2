const nodemailer = require('nodemailer');
const axios = require('axios');

// ── EMAIL ─────────────────────────────────────────────────
async function sendEmail(message) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });
        await transporter.sendMail({
            from: `Gilgamesh <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_TO,
            subject: '👑 Gilgamesh — Message',
            text: message
        });
        console.log('📧 Email envoyé');
        return true;
    } catch (err) {
        console.error('Email fail:', err.message);
        return false;
    }
}

// ── TELEGRAM ──────────────────────────────────────────────
async function sendTelegram(message) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
    try {
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: `👑 *Gilgamesh*\n\n${message}`,
            parse_mode: 'Markdown'
        });
        console.log('📱 Telegram envoyé');
        return true;
    } catch (err) {
        console.error('Telegram fail:', err.message);
        return false;
    }
}

// ── ALERT WONDER — cascade de canaux ─────────────────────
async function alertWonder(message) {
    console.log(`🚨 Alert Wonder: ${message}`);

    // Essai 1 — Telegram
    const tg = await sendTelegram(message);
    if (tg) return;

    // Essai 2 — Email
    const em = await sendEmail(message);
    if (em) return;

    // Rien ne marche — log
    console.error('❌ Impossible de contacter Wonder — tous les canaux down');
}

module.exports = { sendEmail, sendTelegram, alertWonder };
