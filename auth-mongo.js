require('dotenv').config();
const mongoose = require('mongoose');
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

const AuthSchema = new mongoose.Schema({
    _id: String,
    data: String
}, { strict: false });

const Auth = mongoose.models.Auth || mongoose.model('Auth', AuthSchema);

async function useMongoDBAuthState() {
    const writeData = async (data, key) => {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await Auth.findOneAndUpdate(
            { _id: key },
            { data: serialized },
            { upsert: true, new: true }
        );
    };

    const readData = async (key) => {
        try {
            const doc = await Auth.findById(key);
            if (!doc || !doc.data) return null;
            return JSON.parse(doc.data, BufferJSON.reviver);
        } catch {
            return null;
        }
    };

    const removeData = async (key) => {
        try {
            await Auth.deleteOne({ _id: key });
        } catch {}
    };

    // Charge ou initialise les creds
    const storedCreds = await readData('creds');
    const creds = storedCreds || initAuthCreds();

    // Si creds nouveaux, les sauvegarder immédiatement
    if (!storedCreds) {
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            const val = await readData(`${type}-${id}`);
                            if (val) data[id] = val;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    await Promise.all(
                        Object.entries(data).flatMap(([type, ids]) =>
                            Object.entries(ids).map(([id, val]) =>
                                val
                                    ? writeData(val, `${type}-${id}`)
                                    : removeData(`${type}-${id}`)
                            )
                        )
                    );
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, 'creds');
        }
    };
}

module.exports = { useMongoDBAuthState };
