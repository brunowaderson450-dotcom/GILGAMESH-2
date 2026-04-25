const mongoose = require('mongoose');

const AuthSchema = new mongoose.Schema({
    _id: String,
    data: mongoose.Schema.Types.Mixed
}, { strict: false });

const Auth = mongoose.model('Auth', AuthSchema);

async function useMongoDBAuthState() {
    const writeData = async (data, key) => {
        await Auth.findOneAndUpdate(
            { _id: key },
            { data },
            { upsert: true }
        );
    };

    const readData = async (key) => {
        const doc = await Auth.findById(key);
        return doc ? doc.data : null;
    };

    const removeData = async (key) => {
        await Auth.deleteOne({ _id: key });
    };

    const creds = await readData('creds') || {};

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        const val = await readData(`${type}-${id}`);
                        if (val) data[id] = val;
                    }
                    return data;
                },
                set: async (data) => {
                    for (const [type, ids] of Object.entries(data)) {
                        for (const [id, val] of Object.entries(ids)) {
                            if (val) await writeData(val, `${type}-${id}`);
                            else await removeData(`${type}-${id}`);
                        }
                    }
                }
            }
        },
        saveCreds: async (creds) => {
            await writeData(creds, 'creds');
        }
    };
}

module.exports = { useMongoDBAuthState };
