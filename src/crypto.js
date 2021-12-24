let Utils = require('./utils.js')
let Elliptic = require('../lib/elliptic.min.js')

const BLOCK_SIZE = 16;
const IV_SIZE = 16;
const PUBLIC_KEY_SIZE = 65;
const SIGNATURE_SIZE = 64;

///////////////////////////////////////////////////////////////////////////////
// AES

async function getKeyMaterial(password) {
    let enc = new TextEncoder();
    let key = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(password), {
        name: "PBKDF2"
    },
        false, ["deriveBits", "deriveKey"]
    );
    return key;
}

async function getKey(password, salt) {
    let keyMaterial = await getKeyMaterial(password);
    let key = await window.crypto.subtle.deriveKey(
        {
            "name": "PBKDF2",
            salt: salt,
            "iterations": 1000,
            "hash": "SHA-256"
        },
        keyMaterial,
        {
            "name": "AES-CBC",
            "length": 256
        },
        true,
        ["encrypt", "decrypt"]
    );
    return key;
}

async function encrypt(password, data) {
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_SIZE));
    const algorithm = {
        iv,
        name: 'AES-CBC',
    };

    // В качестве соли для пароля используется IV
    let key = await getKey(password, iv);
    const encryptedData = await window.crypto.subtle.encrypt(
        algorithm,
        key,
        data,
    );

    let res = new Uint8Array(iv.length + encryptedData.byteLength);
    res.set(iv);
    res.set(new Uint8Array(encryptedData), iv.length);
    return res;
}

async function decrypt(password, data, onlyFirstBlock) {
    let iv = data.subarray(0, IV_SIZE);
    const algorithm = {
        iv,
        name: 'AES-CBC',
    };

    let key = await getKey(password, iv);
    let encryptedData = onlyFirstBlock ?
        data.subarray(IV_SIZE, IV_SIZE + BLOCK_SIZE) :
        data.subarray(IV_SIZE);
    const decryptedData = await window.crypto.subtle.decrypt(
        algorithm,
        key,
        encryptedData,
    );
    return new Uint8Array(decryptedData);
}

///////////////////////////////////////////////////////////////////////////////



///////////////////////////////////////////////////////////////////////////////
// ECC

function importPublicKeyArrayFromPrivateKey(privateKeyBase58) {
    let privateKeyArray = Utils.base58ToArray(privateKeyBase58);
    if (!privateKeyArray || privateKeyArray.length != 32)
        throw new Error('Неверный формат приватного ключа! Ожидалось 32 байта в кодировке base58');
    try {
        // WebCrypto не умеет получать публичный ключ из приватного, поэтому используется elliptic.js
        let e = new Elliptic.ec('p256')
        let publicKeyArray = e.keyFromPrivate(privateKeyArray).getPublic().encode();
        return new Uint8Array(publicKeyArray);
    }
    catch (e) {
        throw new Error('Не удалось получить публичный ключ из приватного: ' + e + '. stack:\n' + e.stack);
    }
}

async function exportPrivateKey(privateKey) {
    let privateKeyJwk = await window.crypto.subtle.exportKey(
        "jwk",
        privateKey
    );
    return Utils.arrayToBase58(Utils.base64urlToArray(privateKeyJwk.d));
}

async function importPrivateKey(privateKeyBase58, isForSign = true) {
    async function importPrivateKeyImpl(privateKeyJwk) {
        return await window.crypto.subtle.importKey(
            "jwk",
            privateKeyJwk,
            {
                name: isForSign ? 'ECDSA' : 'ECDH',
                namedCurve: "P-256"
            },
            true,
            [isForSign ? 'sign' : 'deriveKey']
        );
    }

    let privateKey = null;
    let privateKeyJwk = {
        'crv': 'P-256',
        'd': Utils.arrayToBase64url(Utils.base58ToArray(privateKeyBase58)),
        'ext': true,
        'key_ops': [isForSign ? 'sign' : 'deriveKey'],
        'kty': 'EC',
        'x': '',
        'y': ''
    }

    try {
        privateKey = await importPrivateKeyImpl(privateKeyJwk);
    }
    catch (e) {
        // Если браузер не поддерживает импорт приватного ключа без публичного,
        // то генерируем его
        let publicKeyArray = importPublicKeyArrayFromPrivateKey(privateKeyBase58);
        privateKeyJwk.x = Utils.arrayToBase64url(publicKeyArray.subarray(1, 33));
        privateKeyJwk.y = Utils.arrayToBase64url(publicKeyArray.subarray(33));
        try {
            privateKey = await importPrivateKeyImpl(privateKeyJwk);
        }
        catch (e) {
            throw new Error('HiddenThread: не удалось импортировать приватный ключ: ' + e);
        }
    }
    return privateKey;
}

async function exportPublicKey(publicKey) {
    let publicKeyArray = await window.crypto.subtle.exportKey(
        "raw",
        publicKey
    );
    return Utils.arrayToBase58(new Uint8Array(publicKeyArray));
}

async function importPublicKey(publicKeyRaw, isForVerify = true) {
    let publicKey = await window.crypto.subtle.importKey(
        "raw",
        publicKeyRaw,
        {
            name: isForVerify ? "ECDSA" : "ECDH",
            namedCurve: "P-256"
        },
        true,
        isForVerify ? ['verify'] : []
    );
    return publicKey;
}

async function generateKeyPair() {
    let keyPair = await window.crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        true,
        ["sign", "verify"]);

    let privateKey = await exportPrivateKey(keyPair.privateKey);
    let publicKey = await exportPublicKey(keyPair.publicKey);
    let pair = [privateKey, publicKey]
    return pair;
}

async function sign(privateKeyBase58, data) {
    let signature = await window.crypto.subtle.sign(
        {
            name: "ECDSA",
            hash: { name: "SHA-256" },
        },
        await importPrivateKey(privateKeyBase58),
        data
    );

    return new Uint8Array(signature);
}

async function verify(publicKey, signature, data) {
    let result = await window.crypto.subtle.verify(
        {
            name: "ECDSA",
            hash: { name: "SHA-256" },
        },
        await importPublicKey(publicKey),
        signature,
        data
    );

    return result;
}

async function deriveSecretKey(privateKeyBase58, publicKeyBase58) {
    let publicKeyArray = Utils.base58ToArray(publicKeyBase58);
    if (!publicKeyArray || publicKeyArray.length != PUBLIC_KEY_SIZE)
        throw new Error(`Неверный формат публичного ключа! Ожидалось ${PUBLIC_KEY_SIZE} байт в кодировке base58.`);

    try {
        let secret = await window.crypto.subtle.deriveKey(
            {
                name: "ECDH",
                public: await importPublicKey(publicKeyArray, false)
            },
            await importPrivateKey(privateKeyBase58, false),
            {
                name: "AES-CBC",
                length: 256
            },
            true,
            ["encrypt", "decrypt"]
        );
    
        let secretRaw = await window.crypto.subtle.exportKey('raw', secret);
        return Utils.arrayToBase58(new Uint8Array(secretRaw));
    } catch (e) {
        throw new Error('Не удалось сгенерировать секрет (указан неверный публичный ключ?): ' + e + '. stack:\n' + e.stack);
    }
}

///////////////////////////////////////////////////////////////////////////////

async function digestMessageHex(message) {
    const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);           // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
    return hashHex;
}
async function digestMessageBase58(message) {
    const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);           // hash the message
    return Utils.arrayToBase58(new Uint8Array(hashBuffer));
}

module.exports.encrypt = encrypt
module.exports.decrypt = decrypt
module.exports.importPublicKeyArrayFromPrivateKey = importPublicKeyArrayFromPrivateKey
module.exports.generateKeyPair = generateKeyPair
module.exports.sign = sign
module.exports.verify = verify
module.exports.deriveSecretKey = deriveSecretKey
module.exports.digestMessageHex = digestMessageHex
module.exports.digestMessageBase58 = digestMessageBase58

module.exports.BLOCK_SIZE = BLOCK_SIZE
module.exports.IV_SIZE = IV_SIZE
module.exports.PUBLIC_KEY_SIZE = PUBLIC_KEY_SIZE
module.exports.SIGNATURE_SIZE = SIGNATURE_SIZE