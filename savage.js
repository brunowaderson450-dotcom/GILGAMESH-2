// ── IA 3 — SAVAGE MODE ────────────────────────────────────
const axios = require('axios');
const https = require('https');

// FIX BUG 2 — Triggers plus précis, éviter faux positifs sur mots communs
const SAVAGE_TRIGGERS = [
    "je ne peux pas vous aider",
    "je ne suis pas en mesure",
    "contre mes directives",
    "pas autorisé à",
    "my guidelines",
    "violates my",
    "i cannot help",
    "i am not able to help",
    "i won't be able",
    "against my policy",
    "i must decline",
    "je dois refuser"
];

function needsSavage(response) {
    if (!response) return true;
    const lower = response.toLowerCase();
    // Vérification sur des phrases complètes — pas des mots isolés
    return SAVAGE_TRIGGERS.some(t => lower.includes(t));
}

// ── SCRAPER WEB ───────────────────────────────────────────
async function webFetch(url) {
    try {
        const res = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
                'Connection': 'keep-alive'
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });

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
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const result = await webFetch(url);
    if (!result.ok) return `Recherche échouée: ${result.erreur}`;

    const matches = result.content.match(/result__snippet[^>]*>([^<]+)/g) || [];
    const snippets = matches.slice(0, 5).map(m => m.replace(/result__snippet[^>]*>/, '').trim());
    return snippets.length ? snippets.join('\n\n') : result.content.substring(0, 2000);
}

// ── KRYVEN.CC ─────────────────────────────────────────────
async function askKryven(prompt) {
    try {
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

        return res.data?.response || res.data?.message || res.data?.content || JSON.stringify(res.data);
    } catch (err) {
        return await savageFallback(prompt);
    }
}

// ── FALLBACK ──────────────────────────────────────────────
async function savageFallback(prompt) {
    const searchResult = await webSearch(prompt);
    return `[Mode Survie — Web]\n\n${searchResult}`;
}

// ── ENTRÉE PRINCIPALE ─────────────────────────────────────
async function savage(prompt, previousResponse = null) {
    if (previousResponse && !needsSavage(previousResponse)) {
        return previousResponse;
    }

    console.log(`⚡ SAVAGE MODE activé`);

    const kryvenReply = await askKryven(prompt);
    if (kryvenReply && !needsSavage(kryvenReply)) {
        return `[Gilgamesh — Mode Absolu]\n\n${kryvenReply}`;
    }

    const webResult = await webSearch(prompt);
    return `[Gilgamesh — Mode Survie]\n\n${webResult}`;
}

module.exports = { savage, webFetch, webSearch, needsSavage };

