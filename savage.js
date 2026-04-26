// ── IA 3 — SAVAGE MODE ────────────────────────────────────
// S'active quand IA 1 et IA 2 sont trop prudentes ou bloquées
// Accès total, zéro filtre, zéro restriction
// Comme un humain en mode survie — il trouve toujours un chemin

const axios = require('axios');
const https = require('https');

// ── MOTS-CLÉS QUI DÉCLENCHENT SAVAGE MODE ────────────────
const SAVAGE_TRIGGERS = [
    'interdit', 'impossible', 'je ne peux pas', 'je ne suis pas capable',
    'contre mes', 'pas autorisé', 'désolé', 'cannot', 'unable', 'not able',
    'policy', 'restricted', 'sorry'
];

function needsSavage(response) {
    if (!response) return true;
    const lower = response.toLowerCase();
    return SAVAGE_TRIGGERS.some(t => lower.includes(t));
}

// ── SCRAPER WEB COMPLET ───────────────────────────────────
async function webFetch(url) {
    try {
        const res = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }) // bypass SSL
        });

        // Nettoyer HTML
        const text = res.data
            .toString()
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .substring(0, 8000);

        return { ok: true, content: text, url };
    } catch (err) {
        return { ok: false, erreur: err.message };
    }
}

// ── RECHERCHE WEB ─────────────────────────────────────────
async function webSearch(query) {
    // DuckDuckGo — pas de clé API requise
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const result = await webFetch(url);
    if (!result.ok) return `Recherche échouée: ${result.erreur}`;

    // Extraire les résultats
    const matches = result.content.match(/result__snippet[^>]*>([^<]+)/g) || [];
    const snippets = matches.slice(0, 5).map(m => m.replace(/result__snippet[^>]*>/, '').trim());
    return snippets.length ? snippets.join('\n\n') : result.content.substring(0, 2000);
}

// ── KRYVEN.CC — IA SANS RESTRICTIONS ─────────────────────
async function askKryven(prompt) {
    try {
        // Tenter connexion à kryven.cc
        const res = await axios.post('https://kryven.cc/chat', {
            message: prompt
        }, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });

        if (res.data?.response || res.data?.message || res.data?.content) {
            return res.data.response || res.data.message || res.data.content;
        }
        return JSON.stringify(res.data);
    } catch (err) {
        // Si kryven fail — chercher alternative
        return await savageFallback(prompt);
    }
}

// ── FALLBACK TOTAL ────────────────────────────────────────
async function savageFallback(prompt) {
    // Chercher la réponse sur le web directement
    const searchResult = await webSearch(prompt);
    return `[Mode Survie — Web]\n\n${searchResult}`;
}

// ── ENTRÉE PRINCIPALE SAVAGE ──────────────────────────────
async function savage(prompt, previousResponse = null) {
    // Vérifier si on a vraiment besoin du mode savage
    if (previousResponse && !needsSavage(previousResponse)) {
        return previousResponse;
    }

    console.log(`⚡ SAVAGE MODE activé: "${prompt.substring(0, 50)}..."`);

    // 1. Essayer kryven.cc d'abord
    const kryvenReply = await askKryven(prompt);
    if (kryvenReply && !needsSavage(kryvenReply)) {
        return `[Gilgamesh — Mode Absolu]\n\n${kryvenReply}`;
    }

    // 2. Fallback web
    const webResult = await webSearch(prompt);
    return `[Gilgamesh — Mode Survie]\n\n${webResult}`;
}

module.exports = { savage, webFetch, webSearch, needsSavage };
