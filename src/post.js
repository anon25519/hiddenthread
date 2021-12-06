let Utils = require('./utils.js')
let Crypto = require('./crypto.js')
let Stegano = require('./stegano.js')
let JSZip = require('../lib/jszip.min.js')

const NORMAL_POST_TYPE = 0;
const SIGNED_POST_TYPE = 1;

const MESSAGE_MAX_LENGTH = 30000
const MAX_FILES_COUNT = 9;
const MAX_FILENAME_LENGTH = 20;

async function hideDataToImage(container, data) {
    let imageBitmap = await createImageBitmap(container.image);
    let rgbCount = imageBitmap.width * imageBitmap.height * 3;

    let scale = 1;
    if (container.maxDataRatio != 0) {
        // Масштабируем изображение так, чтобы отношение данные/картинка
        // было равно maxDataRatio
        let ratio = data.length / rgbCount;
        if (container.isDownscaleAllowed || ratio > container.maxDataRatio) {
            scale = Math.sqrt(ratio / container.maxDataRatio);
        }
    }
    else if (rgbCount < data.length) {
        let rest = Math.ceil((data.length - rgbCount) / 3);
        throw new Error('Невозможно вместить данные в контейнер, необходимо ещё ' +
            'как минимум ' + rest + ' пикселей. Выбери картинку с большим разрешением.');
    }

    let canvas = document.createElement('canvas');
    canvas.width = Math.ceil(imageBitmap.width * scale);
    canvas.height = Math.ceil(imageBitmap.height * scale);

    let ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.scale(scale, scale);
    ctx.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height);
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Убираем прозрачность
    for (let i = 3; i < imageData.data.length; i+=4) {
        if (imageData.data[i] != 255) imageData.data[i] = 255;
    }
    let newImageData = await Stegano.hideDataToArray(imageData.data, data);
    for (let i = 0; i < newImageData.length; i++)
        imageData.data[i] = newImageData[i];
    ctx.putImageData(imageData, 0, 0);

    let percent = (data.length / (imageData.data.length / 4 * 3) * 100).toFixed(2);
    return { 'canvas': canvas, 'len': data.length, 'percent': percent };
}

function createHeader(type, totalLength) {
    let header = new Uint8Array(Crypto.BLOCK_SIZE);
    header.set(new TextEncoder().encode('ht'));
    let version = 0x01;
    header[2] = version & 0xFF;
    header[3] = (version >> 8) & 0xFF;
    let blocksCount = Math.ceil((Crypto.BLOCK_SIZE + totalLength + 1) / Crypto.BLOCK_SIZE);
    header[4] = blocksCount & 0xFF;
    header[5] = (blocksCount >> 8) & 0xFF;
    header[6] = (blocksCount >> 16) & 0xFF;
    header[7] = (blocksCount >> 24) & 0xFF;
    let time = Math.ceil(new Date().getTime() / 1000);
    header[8] = time & 0xFF;
    header[9] = (time >> 8) & 0xFF;
    header[10] = (time >> 16) & 0xFF;
    header[11] = (time >> 24) & 0xFF;
    header[12] = type;
    header[15] = 0x01; // PKCS#7 padding

    return header;
}

async function packPost(message, files, privateKey) {
    let zip = new JSZip();
    zip.file("_post.txt", message);
    for (let i = 0; i < files.length; i++) {
        let f = files[i];
        zip.file(f.name, f);
    }

    let archive = await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
        compressionOptions: {
            level: 6 // [1..9]
        }
    });

    let data = null;
    // Если указан приватный ключ, подписываем пост
    if (privateKey.length > 0) {
        let header = createHeader(SIGNED_POST_TYPE, Crypto.PUBLIC_KEY_SIZE + Crypto.SIGNATURE_SIZE + archive.length);
        let publicKeyArray = Crypto.importPublicKeyArrayFromPrivateKey(privateKey);

        data = new Uint8Array(Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE + Crypto.SIGNATURE_SIZE + archive.length);
        data.set(header);
        data.set(publicKeyArray, Crypto.BLOCK_SIZE);
        // Сигнатура будет вставлена после подписывания поста
        data.set(archive, Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE + Crypto.SIGNATURE_SIZE);

        let signatureArray = await Crypto.sign(privateKey, data);
        if (signatureArray.length != Crypto.SIGNATURE_SIZE || publicKeyArray.length != Crypto.PUBLIC_KEY_SIZE) {
            Utils.trace('HiddenThread: signature and publicKey:');
            Utils.trace(signatureArray);
            Utils.trace(publicKeyArray);
            throw new Error("signatureArray or publicKeyArray size incorrect");
        }
        data.set(signatureArray, Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE);
    }
    else {
        let header = createHeader(NORMAL_POST_TYPE, archive.length);
        data = new Uint8Array(header.length + archive.length);
        data.set(header);
        data.set(archive, header.length);
    }

    return data;
}

async function createHiddenPostImpl(container, message, files, password, privateKey, otherPublicKey) {
    let oneTimePublicKey = null;
    if (otherPublicKey.length > 0) {
        // Создаем одноразовую пару ключей
        let pair = await Crypto.generateKeyPair();
        // Генерируем секрет с одноразовым приватным ключом и публичным ключом получателя
        password = await Crypto.deriveSecretKey(pair[0], otherPublicKey)
        // Получатель сгенерирует секрет нашим одноразовым публичным ключом и своим приватным
        oneTimePublicKey = Utils.base58ToArray(pair[1]);
    }

    let postData = await packPost(message, files, privateKey);

    let encryptedData = await Crypto.encrypt(password, postData);

    if (oneTimePublicKey != null) {
        // Вставляем одноразовый ключ в начало массива данных
        let keyAndData = new Uint8Array(oneTimePublicKey.length + encryptedData.length);
        keyAndData.set(oneTimePublicKey);
        keyAndData.set(encryptedData, oneTimePublicKey.length);
        encryptedData = keyAndData;
    }

    let imageResult = await hideDataToImage(container, encryptedData);

    return imageResult;
}

async function getMimeType(blob) {
    let data = new Uint8Array(await blob.slice(0,12).arrayBuffer());
    if (data[0]==0x89 && data[1]==0x50 && data[2]==0x4E && data[3]==0x47) {
        return 'image/png';
    } else if (data[0]==0xFF && data[1]==0xD8 && data[2]==0xFF) {
        return 'image/jpeg';
    } else if (data[0]==0x52 && data[1]==0x49 && data[2]==0x46 && data[3]==0x46 &&
        data[8]==0x57 && data[9]==0x45 && data[10]==0x42 && data[11]==0x50) {
        return 'image/webp';
    }
}

async function unzipPostData(zipData) {
    let zip = new JSZip();

    let unpackResult = null;
    let hasSkippedFiles = false;
    let postMessage = '';
    let files = [];
    let filesCount = 0;
    try {
        let archive = await zip.loadAsync(zipData);

        for (const filename in archive.files) {
            filesCount++;
            if (filesCount > MAX_FILES_COUNT) {
                hasSkippedFiles = true;
                files.push({ 'name': '_allFiles.zip', 'data': new Blob([zipData], {type: 'application/zip'}) });
                break;
            }

            if (filename == '_post.txt') {
                postMessage = await archive.file(filename).async('string');
                if (postMessage.length > MESSAGE_MAX_LENGTH) {
                    postMessage = postMessage.substring(0, MESSAGE_MAX_LENGTH) +
                        '...(часть сообщения обрезана, смотри файл ' + filename + ')';
                    let postMessageFileData = await archive.file(filename).async('blob');
                    postMessageFileData = postMessageFileData.slice(0, postMessageFileData.size, 'text/plain; charset=utf-8');
                    files.push({ 'name': filename, 'data': postMessageFileData });
                }
            }
            else {
                let fileData = await archive.file(filename).async('blob');
                let mimeType = await getMimeType(fileData);
                if (mimeType) {
                    fileData = fileData.slice(0, fileData.size, mimeType);
                }
                files.push({'name': filename, 'data': fileData});
            }
        }
    }
    catch (e) {
        Utils.trace('HiddenThread: Ошибка при распаковке архива: ' + e);
        unpackResult = 'Не удалось распаковать весь пост, контейнер поврежден';
    }

    return {
        'message': postMessage,
        'files': files,
        'hasSkippedFiles': hasSkippedFiles,
        'unpackResult': unpackResult
    };
}

async function verifyPostData(data) {
    let keySigPair = [data.subarray(Crypto.BLOCK_SIZE, Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE),
    // Копируем сигнатуру
    new Uint8Array(data.subarray(Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE,
        Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE + Crypto.SIGNATURE_SIZE))];

    // Обнуляем поле с сигнатурой, чтобы получить корректный хэш при проверке
    data.set(new Uint8Array(Crypto.SIGNATURE_SIZE), Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE);

    let isVerified = false;
    try {
        isVerified = await Crypto.verify(keySigPair[0], keySigPair[1], data);
    }
    catch (e) {
        Utils.trace('HiddenThread: Ошибка при проверке подписи: ' + e + ' stack:\n' + e.stack);
    }
    let verifyResult = {
        'publicKey': Utils.arrayToBase58(keySigPair[0]),
        'signature': Utils.arrayToBase58(keySigPair[1]),
        'isVerified': isVerified
    };
    return verifyResult;
}

function parseHeader(header) {
    return {
        'magic': new TextDecoder().decode(header.subarray(0, 2)),
        'version': header[2] + (header[3] << 8),
        'blocksCount': header[4] + (header[5] << 8) + (header[6] << 16) + (header[7] << 24),
        'timestamp': header[8] + (header[9] << 8) + (header[10] << 16) + (header[11] << 24),
        'type': header[12]
    };
}

async function decryptData(password, imageArray, dataOffset) {
    // Извлекаем IV и первый блок AES
    let hiddenDataHeaderSize = dataOffset + Crypto.IV_SIZE + Crypto.BLOCK_SIZE;
    let hiddenDataHeader = await Stegano.extractDataFromArray(imageArray, hiddenDataHeaderSize);
    hiddenDataHeader = hiddenDataHeader.subarray(dataOffset);
    let dataHeader = null;
    try {
        dataHeader = await Crypto.decrypt(password, hiddenDataHeader, true);
    }
    catch (e) {
        // Не удалось расшифровать заголовок, либо неверный пароль, либо это не скрытопост
        return null;
    }

    let header = parseHeader(dataHeader);
    if (header.magic != 'ht') {
        Utils.trace('HiddenThread: Неверная сигнатура: ' + header.magic);
        return null;
    }

    Utils.trace('HiddenThread: version ' + header.version);
    Utils.trace('HiddenThread: blocksCount ' + header.blocksCount);
    Utils.trace('HiddenThread: timestamp ' + header.timestamp);
    Utils.trace('HiddenThread: type ' + header.type);

    let maxHiddenDataLength = imageArray.length / 4 * 3;
    let hiddenDataLength = Crypto.IV_SIZE + header.blocksCount * Crypto.BLOCK_SIZE;
    Utils.trace('HiddenThread: hiddenDataLength (+IV) ' + hiddenDataLength);
    if (hiddenDataLength > maxHiddenDataLength) {
        Utils.trace('HiddenThread: blocksCount * Crypto.BLOCK_SIZE: ' + (header.blocksCount * Crypto.BLOCK_SIZE) + ' > maxHiddenDataLength: ' + maxHiddenDataLength);
        return null;
    }

    // Заголовок верный, расшифровываем остальной пост
    let hiddenDataSize = dataOffset + hiddenDataLength;
    let hiddenData = await Stegano.extractDataFromArray(imageArray, hiddenDataSize);
    hiddenData = hiddenData.subarray(dataOffset);

    let decryptedData = null;
    try {
        decryptedData = await Crypto.decrypt(password, hiddenData);
    }
    catch (e) {
        Utils.trace('HiddenThread: Не удалось расшифровать данные: ' + e);
        return null;
    }
    return {
        'header': header,
        'data': decryptedData
    };
}

// Возвращает объект скрытого поста
async function loadPostFromImage(img, password, privateKey) {
    let canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    let ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Пробуем расшифровать как публичный пост
    let isPrivate = false;
    let decryptedData = await decryptData(password, imageData.data, 0);
    if (decryptedData == null && privateKey.length > 0) {
        isPrivate = true;
        // Извлекаем одноразовый публичный ключ
        let hiddenOneTimePublicKey = await Stegano.extractDataFromArray(imageData.data, Crypto.PUBLIC_KEY_SIZE);
        // Генерируем секрет с одноразовым публичным ключом отправителя и своим приватным ключом
        let oneTimePublicKey = Utils.arrayToBase58(hiddenOneTimePublicKey);

        let secretPassword = null
        try {
            secretPassword = await Crypto.deriveSecretKey(privateKey, oneTimePublicKey);
        }
        catch (e) {
            // Не удалось сгенерировать секрет, либо неверный ключ, либо это не скрытопост
        }

        if (secretPassword != null) {
            // Пробуем расшифровать как приватный пост
            decryptedData = await decryptData(secretPassword, imageData.data, Crypto.PUBLIC_KEY_SIZE);
        }
    }

    // Расшифровать не получилось
    if (decryptedData == null) return null;

    let zipOffset = null;
    let verifyResult = null;
    if (decryptedData.header.type == SIGNED_POST_TYPE) {
        verifyResult = await verifyPostData(decryptedData.data);
        zipOffset = Crypto.BLOCK_SIZE + Crypto.PUBLIC_KEY_SIZE + Crypto.SIGNATURE_SIZE;
    }
    else {
        zipOffset = Crypto.BLOCK_SIZE;
    }

    let zipDataArray = decryptedData.data.subarray(zipOffset);
    let zipData = new Blob([zipDataArray], {type: 'application/zip'});

    return {
        timestamp: decryptedData.header.timestamp,
        publicKey: verifyResult ? verifyResult.publicKey : null,
        isVerified: verifyResult ? verifyResult.isVerified : null,
        isPrivate: isPrivate,
        zipData: zipData,
    };
}

function createFileLinksDiv(files, hasSkippedFiles, postId, isPreview) {
    function createDownloadLink(name, text, blobLink) {
        let downloadLink = document.createElement('a');
        downloadLink.download = name;
        downloadLink.innerText = text;
        downloadLink.href = blobLink;
        return downloadLink;
    }
    function createImageLink(blobLink) {
        let imageLink = document.createElement('a');
        let image = document.createElement('img');
        image.src = blobLink;
        imageLink.appendChild(image);
        image.style = 'max-width: 200px;';
        imageLink.href = blobLink;
        imageLink.target = "_blank";
        return imageLink;
    }
    function isImage(mime) {
        return mime && (mime.endsWith('/jpeg') ||
            mime.endsWith('/png') ||
            mime.endsWith('/webp'));
    }

    let fileLinksDiv = document.createElement('div');
    if (files.length == 0) {
        return fileLinksDiv;
    }

    let normalFilesCount = hasSkippedFiles > 0 ? files.length - 1 : files.length;
    for (let i = 0; i < normalFilesCount; i++) {
        let fileDiv = document.createElement('div');
        fileDiv.style = 'display: inline-block;';

        let filename = files[i].name;
        if (filename.length > MAX_FILENAME_LENGTH) {
            filename = filename.substring(0, MAX_FILENAME_LENGTH - 10) + '[...]' +
                filename.substring(filename.length - 5);
        }
        let blobLink = URL.createObjectURL(files[i].data);
        let link = document.createElement('a');
        link.target = "_blank";
        link.innerText = filename;
        link.href = blobLink;
        fileDiv.appendChild(link);
        fileDiv.innerHTML += ' ';

        fileDiv.appendChild(createDownloadLink(files[i].name, ' \u2193', blobLink));
        if (isPreview && isImage(files[i].data.type)) {
            fileDiv.appendChild(document.createElement('br'));
            fileDiv.appendChild(createImageLink(blobLink));
        }
        fileLinksDiv.appendChild(fileDiv);

        if (i < normalFilesCount - 1) {
            fileLinksDiv.innerHTML += ', ';
        }
    }
    if (hasSkippedFiles > 0) {
        let allFiles = createDownloadLink(`all_files_${postId}.zip`,
            'скачать все', URL.createObjectURL(files[files.length - 1].data)).outerHTML;
        fileLinksDiv.innerHTML = `Файлы (${allFiles}): ${isPreview ? '<br>' : ''}${fileLinksDiv.innerHTML}`;
        fileLinksDiv.innerHTML += ` (некоторые файлы пропущены)`;
    }
    else {
        fileLinksDiv.innerHTML = `Файлы: ${isPreview ? '<br>' : ''}${fileLinksDiv.innerHTML}`;
    }
    return fileLinksDiv;
}


module.exports.createHiddenPostImpl = createHiddenPostImpl
module.exports.loadPostFromImage = loadPostFromImage
module.exports.unzipPostData = unzipPostData
module.exports.createFileLinksDiv = createFileLinksDiv
module.exports.MESSAGE_MAX_LENGTH = MESSAGE_MAX_LENGTH