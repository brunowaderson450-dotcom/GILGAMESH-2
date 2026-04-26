const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const brain = require('./brain');

// ── SCHEMA LOG ────────────────────────────────────────────
const UpdateLog = mongoose.models.UpdateLog || mongoose.model('UpdateLog', new mongoose.Schema({
    instruction: String,
    fichier: String,
    ancien_code: String,
    nouveau_code: String,
    succes: Boolean,
    erreur: String,
    timestamp: { type: Date, default: Date.now }
}));

// ── FICHIERS AUTORISÉS (lowercase pour éviter case-sensitivity) ───
const FICHIERS_AUTORISES = ['brain.js', 'comms.js', 'gate.js', 'index.js', 'autonomy.js'];

// ── VÉRIFICATION SYNTAXE SÉCURISÉE (sans new Function) ───────────
function verifierSyntaxe(code) {
    // FIX ERREUR 1 — new Function() est dangereux, on utilise node --check
    const tmpFile = path.join('/tmp', `gilgamesh_check_${Date.now()}.js`);
    try {
        fs.writeFileSync(tmpFile, code, 'utf8');
        execSync(`node --check ${tmpFile}`, { timeout: 5000 });
        return { valide: true };
    } catch (err) {
        return { valide: false, erreur: err.stderr?.toString() || err.message };
    } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
    }
}

// ── PARSE JSON SÉCURISÉ ───────────────────────────────────────────
function parseJSON(raw) {
    // FIX ERREUR 3 — JSON.parse sans try-catch
    try {
        const clean = raw
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
        return { ok: true, data: JSON.parse(clean) };
    } catch (err) {
        return { ok: false, erreur: `JSON invalide: ${err.message}` };
    }
}

// ── SELF UPDATE ───────────────────────────────────────────
async function selfUpdate(instruction) {
    console.log(`🔧 Auto-update demandé: ${instruction}`);

    const prompt = `
Tu es le module de mise à jour de Gilgamesh Nicholas Bruno.
Instruction reçue: "${instruction}"

Réponds UNIQUEMENT avec un JSON valide, aucun texte autour, aucun markdown:
{
  "fichier": "nom_du_fichier.js",
  "description": "ce que tu changes",
  "code": "le code complet du fichier mis à jour"
}

Fichiers disponibles: brain.js, comms.js, gate.js, index.js, autonomy.js
Le code doit être complet — pas de snippets, le fichier entier.
`;

    // Étape 1 — Générer le code
    let raw;
    try {
        raw = await brain.thinkCode(prompt);
    } catch (err) {
        return { succes: false, erreur: `IA inaccessible: ${err.message}` };
    }

    // Étape 2 — Parser le JSON (FIX ERREUR 3)
    const parsed = parseJSON(raw);
    if (!parsed.ok) return { succes: false, erreur: parsed.erreur };

    const { fichier, description, code } = parsed.data;

    // Étape 3 — Vérifier fichier autorisé (FIX ERREUR 4 — case insensitive)
    const fichierNormalise = fichier?.toLowerCase();
    if (!FICHIERS_AUTORISES.includes(fichierNormalise)) {
        return { succes: false, erreur: `Fichier non autorisé: ${fichier}` };
    }

    // Utiliser le nom exact lowercase
    const filePath = path.join(__dirname, fichierNormalise);

    // Étape 4 — Backup ancien code
    let ancienCode = '// nouveau fichier';
    try {
        ancienCode = fs.readFileSync(filePath, 'utf8');
    } catch {}

    // Étape 5 — Vérification syntaxe SÉCURISÉE (FIX ERREUR 1)
    const syntaxCheck = verifierSyntaxe(code);
    if (!syntaxCheck.valide) {
        await UpdateLog.create({
            instruction, fichier: fichierNormalise,
            ancien_code: ancienCode, nouveau_code: code,
            succes: false, erreur: syntaxCheck.erreur
        });
        return { succes: false, erreur: `Syntaxe invalide: ${syntaxCheck.erreur}` };
    }

    // Étape 6 — Écrire le fichier
    try {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`✅ ${fichierNormalise} mis à jour: ${description}`);
    } catch (writeErr) {
        return { succes: false, erreur: `Écriture impossible: ${writeErr.message}` };
    }

    // Étape 7 — Logger
    await UpdateLog.create({
        instruction, fichier: fichierNormalise,
        ancien_code: ancienCode, nouveau_code: code,
        succes: true
    });

    // Étape 8 — Redémarrer
    console.log('🔄 Redémarrage dans 3s...');
    setTimeout(() => {
        try { execSync('pm2 restart gilgamesh'); }
        catch { process.exit(0); }
    }, 3000);

    return { succes: true, description };
}

// ── ROLLBACK ──────────────────────────────────────────────
async function rollback(fichier) {
    const fichierNormalise = fichier?.toLowerCase();

    if (!FICHIERS_AUTORISES.includes(fichierNormalise)) {
        return { succes: false, erreur: `Fichier non autorisé: ${fichier}` };
    }

    const dernierUpdate = await UpdateLog.findOne({ fichier: fichierNormalise, succes: true })
        .sort({ timestamp: -1 });

    if (!dernierUpdate?.ancien_code) {
        return { succes: false, erreur: `Aucun backup trouvé pour ${fichierNormalise}` };
    }

    const filePath = path.join(__dirname, fichierNormalise);
    fs.writeFileSync(filePath, dernierUpdate.ancien_code, 'utf8');
    console.log(`⏪ Rollback de ${fichierNormalise} effectué`);

    setTimeout(() => {
        try { execSync('pm2 restart gilgamesh'); }
        catch { process.exit(0); }
    }, 3000);

    return { succes: true, message: `${fichierNormalise} restauré à la version précédente` };
}

// ── HISTORIQUE ────────────────────────────────────────────
async function historique(limite = 5) {
    const logs = await UpdateLog.find()
        .sort({ timestamp: -1 })
        .limit(limite)
        .lean();

    if (!logs.length) return 'Aucun update enregistré.';

    return logs.map((l, i) =>
        `${i + 1}. [${l.succes ? '✅' : '❌'}] ${l.fichier}\n   → ${l.instruction}\n   → ${new Date(l.timestamp).toLocaleString('fr-FR')}`
    ).join('\n\n');
}

module.exports = { selfUpdate, rollback, historique }; 

