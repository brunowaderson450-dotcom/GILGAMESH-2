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

// ── FICHIERS AUTORISÉS ────────────────────────────────────
const FICHIERS_AUTORISÉS = ['brain.js', 'comms.js', 'gate.js', 'index.js'];

// ── SELF UPDATE ───────────────────────────────────────────
async function selfUpdate(instruction) {
    console.log(`🔧 Auto-update demandé: ${instruction}`);

    // Étape 1 — Générer le nouveau code via IA 2
    const prompt = `
Tu es le module de mise à jour de Gilgamesh Nicholas Bruno.
Instruction reçue: "${instruction}"

Réponds UNIQUEMENT avec un JSON valide, aucun texte autour:
{
  "fichier": "nom_du_fichier.js",
  "description": "ce que tu changes",
  "code": "le code complet du fichier mis à jour"
}

Fichiers disponibles: brain.js, comms.js, gate.js, index.js, autonome.js  
Le code doit être complet — pas de snippets, le fichier entier.
`;

    let result;
    try {
        const raw = await brain.thinkCode(prompt);
        // Nettoyer la réponse
        const clean = raw
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        result = JSON.parse(clean);
    } catch (err) {
        return { succes: false, erreur: `IA n'a pas retourné un JSON valide: ${err.message}` };
    }

    const { fichier, description, code } = result;

    // Étape 2 — Vérifier que le fichier est autorisé
    if (!FICHIERS_AUTORISÉS.includes(fichier)) {
        return { succes: false, erreur: `Fichier non autorisé: ${fichier}` };
    }

    const filePath = path.join(__dirname, fichier);

    // Étape 3 — Backup de l'ancien code
    let ancienCode = '';
    try {
        ancienCode = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        ancienCode = '// nouveau fichier';
    }

    // Étape 4 — Test syntaxique du nouveau code
    try {
        new Function(code); // vérifie la syntaxe basique
    } catch (syntaxErr) {
        await UpdateLog.create({
            instruction, fichier,
            ancien_code: ancienCode,
            nouveau_code: code,
            succes: false,
            erreur: `Erreur syntaxe: ${syntaxErr.message}`
        });
        return { succes: false, erreur: `Syntaxe invalide: ${syntaxErr.message}` };
    }

    // Étape 5 — Écrire le nouveau code
    try {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`✅ ${fichier} mis à jour: ${description}`);
    } catch (writeErr) {
        return { succes: false, erreur: `Écriture impossible: ${writeErr.message}` };
    }

    // Étape 6 — Logger le succès
    await UpdateLog.create({
        instruction, fichier,
        ancien_code: ancienCode,
        nouveau_code: code,
        succes: true
    });

    // Étape 7 — Redémarrer Gilgamesh
    console.log('🔄 Redémarrage de Gilgamesh...');
    setTimeout(() => {
        try {
            execSync('pm2 restart gilgamesh');
        } catch {
            // Si pas PM2, forcer un exit (Render/Oracle redémarre auto)
            process.exit(0);
        }
    }, 2000);

    return { succes: true, description };
}

// ── ROLLBACK ──────────────────────────────────────────────
async function rollback(fichier) {
    const dernierUpdate = await UpdateLog.findOne({
        fichier,
        succes: true
    }).sort({ timestamp: -1 });

    if (!dernierUpdate || !dernierUpdate.ancien_code) {
        return { succes: false, erreur: `Aucun backup trouvé pour ${fichier}` };
    }

    const filePath = path.join(__dirname, fichier);
    fs.writeFileSync(filePath, dernierUpdate.ancien_code, 'utf8');

    console.log(`⏪ Rollback de ${fichier} effectué`);

    setTimeout(() => {
        try { execSync('pm2 restart gilgamesh'); }
        catch { process.exit(0); }
    }, 2000);

    return { succes: true, message: `${fichier} restauré à la version précédente` };
}

// ── HISTORIQUE ────────────────────────────────────────────
async function historique(limite = 5) {
    const logs = await UpdateLog.find()
        .sort({ timestamp: -1 })
        .limit(limite)
        .lean();

    if (!logs.length) return 'Aucun update enregistré.';

    return logs.map((l, i) =>
        `${i + 1}. [${l.succes ? '✅' : '❌'}] ${l.fichier}\n   → ${l.instruction}\n   → ${new Date(l.timestamp).toLocaleString()}`
    ).join('\n\n');
}

module.exports = { selfUpdate, rollback, historique };
