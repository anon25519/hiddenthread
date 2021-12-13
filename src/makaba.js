let Utils = require('./utils.js')
let Crypto = require('./crypto.js')
let Post = require('./post.js')
let HtCache = require('./cache.js')

const CURRENT_VERSION = "0.5.1";
const VERSION_SOURCE = "https://raw.githubusercontent.com/anon25519/hiddenthread/main/version.info";
const SCRIPT_SOURCE = 'https://github.com/anon25519/hiddenthread/raw/main/HiddenThread.user.js'

const STORAGE_KEY = "hiddenThread";

let getStorage = () => {
    let storage = localStorage.getItem(STORAGE_KEY) || "{}";
    return JSON.parse(storage);
}

let storage = getStorage()

let setStorage = (value) => {
    let newStorage = {
        ...getStorage(),
        ...value
    }
    storage = newStorage;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newStorage));
}

function createElementFromHTML(htmlString) {
    let div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstElementChild;
}

function getImgName(url) {
    return url.split('/').pop().split('.')[0];
}

async function createHiddenPost() {
    let imageContainerDiv = document.getElementById('imageContainerDiv');
    imageContainerDiv.innerHTML = '';

    let containers = document.getElementById('hiddenContainerInput').files;

    let maxDataRatio = 0;
    let isDownscaleAllowed = document.getElementById('isDownscaleAllowed').checked;
    if (document.getElementById('isDataRatioLimited').checked) {
        maxDataRatio = Math.min(Math.max(parseInt(document.getElementById('maxDataRatio').value), 1), 100) / 100;
    }

    let container = null;
    if (containers.length > 0) {
        let containersNum = new Array(containers.length);
        for (let i = 0; i < containersNum.length; i++) containersNum[i] = i;
        Utils.shuffleArray(containersNum, containersNum.length, Math);

        for (let num of containersNum) {
            if (containers[num].type == 'image/png' ||
                containers[num].type == 'image/jpeg') {
                container = containers[num];
                break;
            }
        }
    
        if (!container) {
            alert(containers.length == 1 ?
                "Выбранный файл должен быть JPG или PNG картинкой!" :
                "Хотя бы один из выбранных файлов должен быть JPG или PNG картинкой!");
            return;
        }
    }
    else {
        // Если не выбрана картинка, создаем пустую 1x1
        container = new ImageData(new Uint8ClampedArray(4), 1, 1);
        // Если не выбран процент заполнения, заполняем всё
        if (maxDataRatio == 0) maxDataRatio = 1;
    }

    let imageResult = await Post.createHiddenPostImpl(
        {
            'image': container,
            'maxDataRatio': maxDataRatio,
            'isDownscaleAllowed': isDownscaleAllowed
        },
        document.getElementById('hiddenPostInput').value,
        document.getElementById('hiddenFilesInput').files,
        document.getElementById('hiddenThreadPassword').value,
        document.getElementById('privateKey').value,
        document.getElementById('otherPublicKey').value);

    let toBlobPromise = new Promise(function(resolve, reject) {
        imageResult.canvas.toBlob(function(blob) {
            resolve(blob);
        });
    });
    let blob = await toBlobPromise;
    blob.name = getFileName();

    // Вставляем картинку в форму для отображения пользователю
    let img = document.createElement('img');
    img.style = "max-width: 300px;";
    let imgUrl = URL.createObjectURL(blob);
    
    img.src = imgUrl;
    imageContainerDiv.appendChild(createElementFromHTML('<span>Сохрани изображение ниже и вставь в форму отправки, если оно не вставилось автоматически:</span>'));
    imageContainerDiv.appendChild(document.createElement('br'));
    imageContainerDiv.appendChild(img);

    let downloadLink  = document.createElement('a');
    downloadLink.innerText = 'Сохранить картинку'
    downloadLink.href = imgUrl;
    downloadLink.download = blob.name;
    imageContainerDiv.appendChild(document.createElement('br'));
    imageContainerDiv.appendChild(downloadLink);

    // Вставляем картинку в форму отправки
    if (isDollchan()) {
        let containers = document.getElementsByClassName('de-hiddencontainer-thumb');
        let containerId = containers.length == 0 ? 0 : parseInt(containers[0].id.split('-').pop()) + 1;
        let inputFileThumbTemplate =
            `<div id="de-hiddencontainer-thumb-${containerId}" class="de-hiddencontainer-thumb" style="display: inline-block;">`+
            `  <div class="de-file">`+
            `    <div class="de-file-img">`+
            `      <div class="de-file-img" title="${blob.name}">`+
            `        <img class="de-file-img" src="${URL.createObjectURL(blob)}">`+
            `      </div>`+
            `    </div>`+
            `  </div>`+
            `<input type="button" onclick="`+
            `document.getElementById('de-hiddencontainer-input-${containerId}').value = null;`+
            `document.getElementById('de-hiddencontainer-input-${containerId}').remove();`+
            `document.getElementById('de-hiddencontainer-thumb-${containerId}').remove();" value="X"/>`+
            `</div>`;
        let inputFileTemplate = `<div style="display: none;"><input id="de-hiddencontainer-input-${containerId}" type="file" name="formimages[]" class="de-file-input" multiple="true" style="display: none;"></div>'`;
        document.getElementsByClassName('postform__raw filer')[0].insertAdjacentHTML("afterbegin", inputFileTemplate);
        let file = new File([blob], blob.name, {type: blob.type});
        let container = new DataTransfer();
        container.items.add(file);
        document.getElementById(`de-hiddencontainer-input-${containerId}`).files = container.files;

        document.getElementById('de-file-area').insertAdjacentHTML("afterbegin", inputFileThumbTemplate);
    }
    else {
        window.FormFiles.addMultiFiles([blob]);
    }

    return {len: imageResult.len, percent: imageResult.percent};
}

const tags = [
    {
        open: '[i]',
        close: '[/i]',
        open_: "<em>",
        close_: "</em>"
    },
    {
        open: '[b]',
        close: '[/b]',
        open_: "<strong>",
        close_: "</strong>"
    },
    {
        open: '[spoiler]',
        close: '[/spoiler]',
        open_: `<span class=\"spoiler\">`,
        close_: "</span>"
    },
    {
        open: '[u]',
        close: '[/u]',
        open_: `<span class=\"u\">`,
        close_: "</span>"
    },
    {
        open: '[o]',
        close: '[/o]',
        open_: `<span class=\"o\">`,
        close_: "</span>"
    },
    {
        open: '[s]',
        close: '[/s]',
        open_: `<span class=\"s\">`,
        close_: "</span>"
    },
    {
        open: '[sup]',
        close: '[/sup]',
        open_: `<sup>`,
        close_: "</sup>"
    },
    {
        open: '[sub]',
        close: '[/sub]',
        open_: `<sub>`,
        close_: "</sub>"
    }
];

function convertToHtml(text) {
    let lines = text.split('\n');
    text = "";
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 2) {
            if (lines[i].trim().startsWith("&gt;")) {
                text += `<span class="unkfunc">${lines[i]}</span><br>`;
                continue;
            }
        }
        text += `${lines[i]}<br>`;
    }
    for (let i = 0; i < text.length; i++) {
        for (let j = 0; j < tags.length; j++) {
            const t = tags[j];
            if (text.substring(i, i + t.open.length).toLowerCase() === t.open) {
                let c = getClosingTagIndex(text, i, t);
                if (c == -1) {
                    continue;
                }
                text = replaceAt(text, i, t.open.length, t.open_);
                text = replaceAt(text, c + (t.open_.length - t.open.length), t.close.length, t.close_);
            }
        }

    }
    return text;
}

function replaceAt(text, index, length, replacement) {
    return text.substr(0, index) + replacement + text.substr(index + length);
}

function getClosingTagIndex(text, i, tag) {
    i += tag.open.length;
    let skip = 0;
    for (; i < text.length; i++) {
        if (text.substring(i, i + tag.open.length).toLowerCase() === tag.open) {
            skip += 1;
            continue;
        }

        if (text.substring(i, i + tag.close.length).toLowerCase() === tag.close) {
            skip -= 1;
            if (skip == -1) {
                return i;
            }
        }
    }
    return -1;
}

// Добавление HTML скрытопоста к основному посту
function addHiddenPostToHtml(postId, loadedPost, unpackedData) {
    Utils.trace(`HiddenThread: Post ${postId} is hidden, its object:`);
    Utils.trace(loadedPost);
    Utils.trace(unpackedData);

    let clearPost = document.getElementById('post-' + postId);
    let postBodyDiv = document.createElement('div');
    postBodyDiv.id = 'hidden_post-body-' + postId;
    postBodyDiv.classList.add("post");
    postBodyDiv.classList.add("post_type_reply");
    postBodyDiv.classList.add("post_type_hiddenthread");
    postBodyDiv.setAttribute('data-num', String(postId));

    let postMetadata = document.createElement('div');
    postMetadata.style = 'font-family: courier new;';
    let postArticle = document.createElement('article');
    postArticle.id = 'hidden_m' + postId;
    postArticle.classList.add("post__message");

    let postArticleMessage = document.createElement('div');
    postArticleMessage.innerHTML = convertToHtml(unpackedData.message);

    if (loadedPost.isPrivate) {
        postMetadata.appendChild(createElementFromHTML('<div style="color:orange;"><i>Этот пост виден только с твоим приватным ключом</i></div>'));
    }
    let tzOffset = (new Date()).getTimezoneOffset() * 60;
    let timeString = (new Date((loadedPost.timestamp - tzOffset) * 1000))
        .toISOString().replace('T', ' ').replace(/\.\d+Z/g, '');
    let d = clearPost.getElementsByClassName('post__time')[0].textContent.split(' ');
    let postDateMs = Date.parse(`20${d[0].split('/')[2]}-${d[0].split('/')[1]}-${d[0].split('/')[0]}T${d[2]}Z`);
    if (Math.abs(postDateMs/1000 - loadedPost.timestamp) > 24*3600) {
        timeString += ' <span style="color:red;">(неверное время поста!)</span>';
    }
    let tzName = (new Date()).toLocaleDateString(undefined, { timeZoneName: 'short' }).split(',')[1].trim();
    postMetadata.appendChild(createElementFromHTML(`<div>Дата создания скрытопоста (${tzName}): ${timeString}</div>`));
    postMetadata.appendChild(Post.createFileLinksDiv(unpackedData.files,
        unpackedData.hasSkippedFiles, postId, !storage.isPreviewDisabled));

    if (loadedPost.publicKey) {
        let postArticleSign = document.createElement('div');
        postArticleSign.innerHTML =
            'Публичный ключ: <span style="word-wrap:normal;word-break:normal;color:' +
            (loadedPost.isVerified ? 'green' : 'red') + ';">' +
            loadedPost.publicKey + '</span>' +
            (loadedPost.isVerified ? '' : ' (неверная подпись!)');
        postMetadata.appendChild(postArticleSign);
    }
    postArticle.appendChild(postMetadata);
    if (unpackedData.unpackResult) {
        postArticle.appendChild(createElementFromHTML(
            `<div style="font-family:courier new;color:red;">${unpackedData.unpackResult}</div>`));
    }
    postArticle.appendChild(document.createElement('br'));
    postArticle.appendChild(postArticleMessage);

    postBodyDiv.appendChild(postArticle);

    clearPost.appendChild(document.createElement('br'));
    clearPost.appendChild(postBodyDiv);

    // Переносим ссылки на скрытопосты в тело скрытопоста, если они ещё не там
    let normalPostBody = document.getElementById(`post-${postId}`);
    let hiddenPostsRefmap = normalPostBody.querySelector(`#ht_refmap-${postId}`);
    if (hiddenPostsRefmap) {
        document.getElementById(`hidden_m${postId}`).insertAdjacentElement('afterend', hiddenPostsRefmap);
    }
}


// Добавление HTML скрытопоста в объект основного поста (для всплывающих постов)
function addHiddenPostToObj(postId) {
    let thread = window.Post(window.thread.id);
    let currentPost = thread.getPostsObj()[String(postId)];
    let postArticle = document.getElementById('hidden_m' + postId);
    currentPost.ajax.comment = currentPost.ajax.comment + '<br>' + postArticle.innerHTML;
}

// Ссылка на пост в тексте
function createReplyLink(postId) {
    return `<a href="/${window.board}/res/${window.thread.id}.html#${postId}" ` +
        `class="${isDollchan() ? 'de-link-postref' : ''} post-reply-link" ` +
        `data-thread="${window.thread.id}" data-num="${postId}">&gt;&gt;${postId}</a>`;
}

// Ссылка на пост в ответах
function createPostRefLink(postId) {
    if (isDollchan()) {
        return `<a href="#${postId}" class="de-link-backref">&gt;&gt;${postId}</a><span class="de-refcomma">, </span>`;
    }
    else {
        return createReplyLink(postId);
    }
}

function addReplyLinks(postId, refPostIdList) {
    let thread = window.Post(window.thread.id);

    let refPostIdSet = new Set();
    for (const refPostId of refPostIdList) {
        let postEl = document.getElementById(`post-${refPostId}`);
        if (!postEl) continue;

        let hiddenPostsRefmap = document.getElementById(`ht_refmap-${refPostId}`);
        // Если списка с ответами на скрытопосты ещё не существует, создаём его и помещаем
        // в тело скрытопоста (либо в тело обычного поста, если скрытопост ещё не создан)
        if (!hiddenPostsRefmap) {
            if (isDollchan()) {
                hiddenPostsRefmap = createElementFromHTML(`<div id="ht_refmap-${refPostId}" class="de-refmap"></div>`);
            }
            else {
                hiddenPostsRefmap = createElementFromHTML(`<div id="ht_refmap-${refPostId}" class="post__refmap" style="display: block;"></div>`);
            }

            let hiddenPostEl = document.getElementById(`hidden_post-body-${refPostId}`);
            if (!hiddenPostEl) {
                document.getElementById(`m${refPostId}`).insertAdjacentElement('afterend', hiddenPostsRefmap);
            }
            else {
                document.getElementById(`hidden_m${refPostId}`).insertAdjacentElement('afterend', hiddenPostsRefmap);
            }
        }

        if (!refPostIdSet.has(refPostId)) {
            refPostIdSet.add(refPostId);
            // Добавление ссылки на текущий пост в ответы другого поста
            // В HTML:
            hiddenPostsRefmap.appendChild(createElementFromHTML(createPostRefLink(postId)));

            // В Object (для всплывающих постов):
            let refPost = thread.getPostsObj() && thread.getPostsObj()[refPostId];
            if (refPost) {
                if (!refPost.replies) {
                    refPost.replies = new Array();
                }
                if (!(postId in refPost.replies)) refPost.replies.push(postId);
            }
        }
    }
}

function parseMessage(message)
{
    message = message
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");

    let refPostIdList = [];

    message = message.replaceAll(new RegExp('&gt;&gt;(\\d{1,10})', 'g'),
        function(m, s) {
            refPostIdList.push(s);
            return createReplyLink(s);
        });

    return {
        'message': message,
        'refPostIdList': refPostIdList
    }
};

function renderHiddenPost(postId, loadedPost, unpackedData) {
    let res = parseMessage(unpackedData.message);
    unpackedData.message = res.message;
    addHiddenPostToHtml(postId, loadedPost, unpackedData);
    addReplyLinks(postId, res.refPostIdList);
    // TODO: отображение скрытопостов во всплывающих постах с куклоскриптом
    addHiddenPostToObj(postId); // Текст скрытопоста берется из HTML
}

/* Перепроверить все посты */
function reloadHiddenPosts() {
    // очистить список скаченных и просмотренных изображений
    // чтобы они снова скачались и просканировались
    document.getElementById("imagesLoadedCount").textContent = loadedPosts.size;
    watchedImages = new Set();
    loadHiddenThread();
}


async function loadAndRenderPost(postId, url, password, privateKey) {
    let response = await fetch(url);
    if (!response.ok) throw new Error(`fetch not ok, url: ${url}`);
    let imgArrayBuffer = await response.arrayBuffer();

    let imgId = getImgName(url);
    document.getElementById("imagesLoadedCount").textContent =
        parseInt(document.getElementById("imagesLoadedCount").textContent) + 1;

    let loadedPost = await Post.loadPostFromImage(imgArrayBuffer, password, privateKey);

    if (!loadedPost)
        return loadedPost;

    loadedPosts.add(imgId);
    document.getElementById("hiddenPostsLoadedCount").textContent = loadedPosts.size;

    let unpackedData = await Post.unzipPostData(loadedPost.zipData);
    renderHiddenPost(postId, loadedPost, unpackedData);

    return loadedPost;
}

/*
Проверяет есть ли в этом посте скрытый пост, расшифровывает
и выводит результат
*/
async function loadPost(postId, url, password, privateKey, passwordHash, privateKeyHash) {
    Utils.trace('HiddenThread: loading post ' + postId + ' ' + url);

    let imgId = getImgName(url);
    let cachedPost = null;
    try {
        cachedPost = await HtCache.getCachedPost(imgId);
    } catch (e) {}

    if (cachedPost) {
        // Если в кэше не скрытопост и в кэше нет текущего пароля или ключа,
        // то загружаем пост, выводим его (если удалось декодировать), обновляем кэш
        if (!cachedPost.hiddenPost && (cachedPost.wrongPasswordHashes.indexOf(passwordHash) == -1 ||
            cachedPost.wrongPrivateKeyHashes.indexOf(privateKeyHash) == -1)) {
            let loadedPost = await loadAndRenderPost(postId, url, password, privateKey);
            try {
                await HtCache.updateCache(imgId, loadedPost, passwordHash, privateKeyHash);
            } catch (e) {}
        }
        // Если в кэше скрытопост, выводим его
        else if(cachedPost.hiddenPost) {
            loadedPosts.add(imgId);
            document.getElementById("hiddenPostsLoadedCount").textContent = loadedPosts.size;
            document.getElementById("hiddenPostsCachedCount").textContent =
                parseInt(document.getElementById("hiddenPostsCachedCount").textContent) + 1;
            document.getElementById("imagesLoadedCount").textContent =
                parseInt(document.getElementById("imagesLoadedCount").textContent) + 1;

            let unpackedPost = await Post.unzipPostData(cachedPost.hiddenPost.zipData);
            renderHiddenPost(postId, cachedPost.hiddenPost, unpackedPost);
        }
        // В кэше не скрытопост
        else {
            document.getElementById("imagesLoadedCount").textContent =
                parseInt(document.getElementById("imagesLoadedCount").textContent) + 1;
        }
    } else {
        // Если в кэше ничего нет, то загружаем пост,
        // выводим его (если удалось декодировать), обновляем кэш
        let loadedPost = await loadAndRenderPost(postId, url, password, privateKey);
        try {
            await HtCache.updateCache(imgId, loadedPost, passwordHash, privateKeyHash);
        } catch (e) {}
    }
}

function getFileName() {
    var fileName = document.getElementById('fileName').value;

    if (!fileName) {
        return "image.png";
    }

    return fileName.endsWith('.png') ? fileName : `${fileName}.png`
}

function CheckVersion() {
    var request = new XMLHttpRequest();
    request.open("GET", VERSION_SOURCE);
    request.onreadystatechange = function () {
        if (request.readyState === 4 && request.status === 200) {
            Utils.trace(`Актуальная версия HiddenThread: ${request.responseText}`);
            let infoDiv = document.getElementById('versionInfo');
            infoDiv.innerHTML = '';
            let info = document.createElement('span');
            if (CURRENT_VERSION === request.responseText) {
                info.style = 'color: green';
                info.textContent = 'У вас актуальная версия скрипта';
            } else {
                info.style = 'color: red';
                info.textContent = 'Ваша версия скрипта устарела';
                infoDiv.insertAdjacentHTML('afterbegin', `(<a href="${SCRIPT_SOURCE}">обновить</a>)`);
            }
            infoDiv.insertAdjacentElement('afterbegin', info);
        }
    };
    request.send(null); // Send the request now
}

function createInterface() {
    let toggleText = () => {
        return storage.hidePostForm
            ? "Открыть"
            : "Закрыть"
    }
    let formTemplate = `
        <br>
        <div id="hiddenPostDiv" style="display: inline-block; text-align: left; ${isDollchan()?'min-width: 600px;':'width: 100%;'}">
            <hr>
            <div style="position: relative; display: flex; justify-content: center; align-items: center">
                <p style="font-size:x-large;">Скрытотред ${CURRENT_VERSION}</p>
                <span id="hiddenThreadToggle" style="position: absolute; right: 0; cursor: pointer">${toggleText()}</span>
            </div>
            <div id="hiddenThreadForm" style="display: ${storage.hidePostForm ? 'none' : ''}">
                <div style="padding:5px;">
                    <input id="htClearFormButton" type="button" style="padding:5px;margin:auto;display:block;color:red" value="Очистить форму" />
                </div>
                <div style="padding:5px;">
                    <span style="padding-right: 5px;">Пароль:</span>
                    <input placeholder="Без пароля" id="hiddenThreadPassword" />
                    <input id="reloadHiddenPostsButton" type="button" style="padding: 5px;" value="Загрузить скрытопосты" />
                    <a target="_blank" style="font-size: small; margin-left: 5px" href="https://github.com/anon25519/hiddenthread">?</a>
                </div>
                <div style="padding:5px;text-align:center;">
                    <!--<span id="loadingStatus" style="display: none">Загрузка...</span>-->
                    Загружено картинок: <span id="imagesLoadedCount">0</span>/<span id="imagesCount">0</span>
                    <br>
                    Загружено скрытопостов: <span id="hiddenPostsLoadedCount">0</span>
                    (из кэша: <span id="hiddenPostsCachedCount">0</span>)
                </div>
                <textarea
                    id="hiddenPostInput"
                    placeholder="Пиши скрытый текст тут. Максимальная длина ${Post.MESSAGE_MAX_LENGTH}"
                    style="box-sizing: border-box; display: inline-block; width: 100%; padding: 5px;"
                    rows="10"
                ></textarea>
                <div id="hiddenFilesDiv" style="padding: 5px;">
                    <span>Выбери скрытые файлы: </span>
                    <input id="hiddenFilesInput" type="file" multiple="true" />
                    <br>
                    <span>Выбери картинку-контейнер (из нескольких берется рандомная): </span>
                    <input id="hiddenContainerInput" type="file" multiple="true" />
                    <br>
                    <span style="margin-right: 5px">Имя картинки:</span>
                    <input placeholder="image.png" id="fileName">
                    <br>
                    <input id="hiddenFilesClearButton" class="mt-1" type="button" value="Очистить список файлов" />
                    <input id="hiddenContainerClearButton" class="mt-1" type="button" value="Очистить список контейнеров" />
                </div>
                <div style="padding: 5px;">
                    <div style="font-size:large;text-align:center;">Подписать пост</div>
                    Приватный ключ (ECDSA p256, base58): <br>
                    <input
                        id="privateKey"
                        placeholder="Без ключа"
                        style="box-sizing: border-box; display: inline-block; width: 100%; padding: 5px;"
                    />
                    <br>
                    Публичный ключ:
                    <br>
                    <input
                        id="publicKey"
                        readonly
                        style="box-sizing: border-box; display: inline-block; width: 100%; padding: 5px; color: grey;"
                    />
                    <br>
                    <div align="center" class="mt-1">
                        <input id="generateKeyPairButton" type="button" style="padding: 5px;" value="Сгенерировать ключи" />
                    </div>
                </div>
                <div style="padding: 5px;">
                    <div style="font-size:large;text-align:center;">Приватный пост</div>
                    Публичный ключ получателя: <br>
                    <input placeholder="Без получателя" id="otherPublicKey" style="box-sizing: border-box; display: inline-block; width: 100%; padding: 5px;">
                </div>
                <div style="padding: 5px;">
                    <div style="font-size:large;text-align:center;">Настройки контейнера</div>
                    <div>Подстраивать разрешение картинки под размер поста: <input id="isDataRatioLimited" type="checkbox"></div>
                    <div id="maxDataRatioDiv" style="display:none">
                    <div>Точное соответствие (картинка может быть уменьшена): <input id="isDownscaleAllowed" type="checkbox"></div>
                    <div>Процент заполнения контейнера данными: <input type="number" id="maxDataRatio" min="1" max="100" value="20" style="width:70px"></div>
                    </div>
                </div>
                <br>
                <div align="center">
                    <input id="createHiddenPostButton" type="button" value="Создать картинку со скрытопостом" style="padding: 5px;">
                </div>
                <div id="imageContainerDiv" align="center" />
            </div>
            <div id="versionInfo" style="display: flex; justify-content: center;"></div>
            <hr>
        </div>
    `
    let style = document.createElement("style")
    let css = `
        #hiddenPostDiv .mt-1 { margin-top: 1em; }
        #hiddenPostDiv input, textarea {
            border: 1px solid var(--theme_default_btnborder);
            background: var(--theme_default_altbtnbg);
            color: var(--theme_default_btntext);
        }
        #hiddenPostDiv input[type=button] {
            color: var(--theme_default_btntext);
        }
        .post_type_hiddenthread {
            border-left: 3px solid #${storage.postsColor ? storage.postsColor : 'F00000'};
            border-right: 3px solid #${storage.postsColor ? storage.postsColor : 'F00000'};
        }
    `
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style)

    // render
    document.getElementById('postform').insertAdjacentHTML(isDollchan() ? 'afterend' : 'beforeend', formTemplate);

    // Меню
    document.getElementsByClassName('adminbar__boards')[0].insertAdjacentHTML(
        'beforeend', `
        <span>&nbsp;&nbsp;&nbsp;&nbsp;HiddenThread:
        <a id="hideNormalPosts" href="#">Свернуть/развернуть все обычные посты</a>
        | <a id="hiddenThreadSettings" href="#">Настройки</a>
        <div id="hiddenThreadSettingsWindow" style="display: none; border: solid 1px black; padding: 2px; text-align: left; min-width: 370px; max-width: fit-content; margin: auto;">
            <div>Настройки</div>
            <hr>
            <div>
                <div><input id="htIsDebugLogEnabled" type="checkbox"> <span>Включить debug-лог</span></div>
                <div><input id="htIsQueueLoadEnabled" type="checkbox"> <span>Включить последовательную загрузку скрытопостов</span></div>
                <div><input id="htIsPreviewDisabled" type="checkbox"> <span>Отключить превью картинок в скрытопостах</span></div>
                <div><input id="htPostsColor" maxlength="6" size="6"> <span>Цвет выделения скрытопостов (в hex)</span></div>
                <div><input id="htMaxCacheSize" type="number" min="0" step="1" size="12"> <span>Макс. размер кэша, Мб</span></div>
                <div>Текущий размер кэша: <span id="htCacheSize">???</span></div>
                <div><button id="htClearCache">Очистить кэш</button></div>
            </div>
            <hr>
            <div>
                <input type="button" class="button" id="hiddenThreadSettingsSave" value="Сохранить">
                <input type="button" class="button" id="hiddenThreadSettingsCancel" value="Отмена">
                <br><i>Для применения обновите страницу</i>
            </div>
        </div>
        </span>`);
    let hiddenThreadSettingsLink = document.getElementById('hiddenThreadSettings');
    hiddenThreadSettingsLink.onclick = function() {
        let settingsWindow = document.getElementById('hiddenThreadSettingsWindow');
        document.getElementById("htIsDebugLogEnabled").checked = storage.isDebugLogEnabled;
        document.getElementById("htIsQueueLoadEnabled").checked = storage.isQueueLoadEnabled;
        document.getElementById("htIsPreviewDisabled").checked = storage.isPreviewDisabled;
        document.getElementById("htPostsColor").value = storage.postsColor ? storage.postsColor : 'F00000';
        document.getElementById("htMaxCacheSize").value = storage.maxCacheSize ? storage.maxCacheSize : 0;
        settingsWindow.style.display = settingsWindow.style.display == 'none' ? 'block' : 'none';
    }
    document.getElementById("hiddenThreadSettingsCancel").onclick = function() {
        document.getElementById('hiddenThreadSettingsWindow').style.display = 'none';
    }
    document.getElementById("hiddenThreadSettingsSave").onclick = function() {
        setStorage({ isDebugLogEnabled: document.getElementById("htIsDebugLogEnabled").checked });
        setStorage({ isQueueLoadEnabled: document.getElementById("htIsQueueLoadEnabled").checked });
        setStorage({ isPreviewDisabled: document.getElementById("htIsPreviewDisabled").checked });
        setStorage({ postsColor: document.getElementById("htPostsColor").value });
        let maxCacheSize = parseInt(document.getElementById("htMaxCacheSize").value);
        setStorage({ maxCacheSize: maxCacheSize ? maxCacheSize : 0 });
        document.getElementById('hiddenThreadSettingsWindow').style.display = 'none';
    }
    let clearCacheButton = document.getElementById("htClearCache");
    clearCacheButton.onclick = async function() {
        let oldText = clearCacheButton.textContent;
        clearCacheButton.textContent = 'Очищаем...';
        clearCacheButton.disabled = true;
        try {
            await HtCache.clearStore();
            alert('Кэш очищен');
        } catch (e) {
            alert('Не удалось очистить кэш: ' + e);
        }
        clearCacheButton.textContent = oldText;
        clearCacheButton.disabled = false;
    }

    // listeners
    let enlargeCheck = document.getElementById('isDataRatioLimited')
    enlargeCheck.onchange = function () {
        document.getElementById('maxDataRatioDiv').style = `display:${enlargeCheck.checked ? 'block' : 'none'}`;
    }

    let hideEl = document.getElementById('hideNormalPosts');
    hideEl.onclick = function () {
        hidePosts(watchedPosts);
        hideEl.value = !hideEl.value;
    }
    hideEl.value = false;

    let toggleEl = document.getElementById("hiddenThreadToggle")
    toggleEl.onclick = () => {
        setStorage({ hidePostForm: !storage.hidePostForm })
        toggleEl.textContent = toggleText()
        let formEl = document.getElementById("hiddenThreadForm")
        formEl.style.display = storage.hidePostForm
            ? "none"
            : ""
    }

    document.getElementById('htClearFormButton').onclick = function () {
        document.getElementById('hiddenPostInput').value = '';
        document.getElementById('hiddenFilesInput').value = null;
    }

    document.getElementById('reloadHiddenPostsButton').onclick = reloadHiddenPosts;

    document.getElementById('hiddenFilesClearButton').onclick = function () {
        document.getElementById('hiddenFilesInput').value = null;
    }
    document.getElementById('hiddenContainerClearButton').onclick = function () {
        document.getElementById('hiddenContainerInput').value = null;
    }
    let createHiddenPostButton = document.getElementById('createHiddenPostButton');
    createHiddenPostButton.onclick = async function () {
        let oldText = createHiddenPostButton.value;
        createHiddenPostButton.value = 'Генерируем картинку...';
        createHiddenPostButton.disabled = true;
        try {
            let res = await createHiddenPost();
            if (res)
                alert('Спрятано ' + res.len + ' байт (занято ' + res.percent + '% изображения)');
        } catch (e) {
            Utils.trace('HiddenThread: Ошибка при создании скрытопоста: ' + e + ' stack:\n' + e.stack);
            alert('Ошибка при создании скрытопоста: ' + e);
        }
        createHiddenPostButton.value = oldText;
        createHiddenPostButton.disabled = false;
    }
    document.getElementById('generateKeyPairButton').onclick = function () {
        if (!document.getElementById('privateKey').value ||
            confirm('Сгенерировать новую пару ключей? Предыдущая пара будет стерта!'))
        {
            Crypto.generateKeyPair()
                .then(function(pair) {
                    document.getElementById('privateKey').value = pair[0];
                    document.getElementById('publicKey').value = pair[1];
                });
        }
    }
    document.getElementById('privateKey').oninput = function () {
        let privateKey = document.getElementById('privateKey').value;
        let publicKeyArray = null;
        try {
            publicKeyArray = Crypto.importPublicKeyArrayFromPrivateKey(privateKey);
        }
        catch (e) { }

        if (publicKeyArray && publicKeyArray.length > 0) {
            document.getElementById('publicKey').value = Utils.arrayToBase58(publicKeyArray);
        }
        else {
            document.getElementById('publicKey').value = '';
        }
    }
}

function hidePosts(posts) {
    for (let post of posts) {
        let body = document.getElementById(`post-body-${post}`);
        if (isDollchan()) {
            body.getElementsByClassName('post__message')[0].classList.toggle('de-post-hiddencontent');
            if (body.getElementsByClassName('post__images')[0]) {
                body.getElementsByClassName('post__images')[0].classList.toggle('de-post-hiddencontent');
            }
            let refmaps = body.getElementsByClassName('de-refmap');
            if (refmaps) {
                for (let r of refmaps) {
                    r.classList.toggle('de-post-hiddencontent');
                }
            }
        }
        else {
            body.classList.toggle('post_type_hidden');
        }
    }
}

// Получить посты, которые нужно просмотреть
/*
Возвращает объект:
postsToScan{
    urls: [url1, url2],
    postId: ...
}
*/
function getPostsToScan()
{
    if (isDollchan()) return getPostsToScanFromHtml();

    let threadId = window.thread.id;
    let thread = window.Post(threadId);
    let postsToScan = [];

    let postIdList = null;
    try {
        postIdList = thread.threadPosts();
    }
    catch (e) {
        // Если не удалось получить объект треда, берем id и ссылки из HTML
        return getPostsToScanFromHtml();
    }

    for (let postId of postIdList) {
        let postAjax = thread.getPostsObj()[String(postId)].ajax;
        if (!postAjax) continue;

        let postFiles = postAjax.files;

        let urls = [];
        for (let file of postFiles) {
            if (file.path.endsWith('.png')) {
                urls.push(file.path);
            }
        }
        postsToScan.push({
            urls: urls,
            postId: postId
        });
    }

    return postsToScan;
}

function getPostsToScanFromHtml() {
    let postsToScan = [];
    let posts = document.getElementsByClassName('post');

    for (let post of posts) {
        let postImages = post.getElementsByClassName('post__images');
        let urls = [];
        for (let img of postImages) {
            let urlsHtml = img.getElementsByClassName('post__image-link');
            for (let url of urlsHtml) {
                if (url.href.endsWith('.png')) {
                    urls.push(url.href);
                }
            }
        }
        postsToScan.push({
            urls: urls,
            postId: post.getAttribute('data-num')
        });
    }

    return postsToScan;
}


async function getCacheSizeReadable() {
    try {
        let size = await HtCache.getCacheSize();
        return Utils.getHumanReadableSize(size);
    } catch (e) {}
    return "???";
}

async function getIdbUsageReadable() {
    try {
        const quota = await navigator.storage.estimate();
        return Utils.getHumanReadableSize(quota.usage);
    } catch (e) {}
    return "???";
}

// множество ID просмотренных постов
let watchedPosts = new Set();
// множество ID просмотренных картинок
let watchedImages = new Set();
// множество ID картинок с загруженными скрытопостами
let loadedPosts = new Set();
let scanning = false;
/*
Просмотреть все посты и попробовать расшифровать
*/
async function loadHiddenThread() {
    if (scanning) {
        return; // Чтобы не запускалось в нескольких потоках
    }
    scanning = true;

    let postsToScan = getPostsToScan();

    document.getElementById("imagesCount").textContent = getImagesCount(postsToScan).toString();
    document.getElementById('htCacheSize').textContent = `???+ ${await getCacheSizeReadable()} (IDB usage: ${await getIdbUsageReadable()})`;

    let password = document.getElementById('hiddenThreadPassword').value;
    let privateKey = document.getElementById('privateKey').value;
    let passwordHash = await Crypto.digestMessage(password);
    let privateKeyHash = await Crypto.digestMessage(privateKey);

    let loadPostPromises = [];
    for (let post of postsToScan) {
        for (let url of post.urls) {
            let imgId = getImgName(url);
            if (loadedPosts.has(imgId) || watchedImages.has(imgId)) {
                continue;
            }
            watchedImages.add(imgId);

            function promiseGenerator() {
                return new Promise(async function(resolve, reject) {
                    try {
                        await loadPost(post.postId, url, password, privateKey, passwordHash, privateKeyHash);
                    }
                    catch(e) {
                        Utils.trace('HiddenThread: Ошибка при загрузке поста: ' + e + ' stack:\n' + e.stack);
                    }
                    resolve();
                });
            }

            let p = promiseGenerator();
            if(storage.isQueueLoadEnabled) {
                await p;
            } else {
                loadPostPromises.push(p);
            }
        }
        if (!watchedPosts.has(post.postId)) {
            watchedPosts.add(post.postId);
            if (document.getElementById('hideNormalPosts').value) {
                hidePosts([post.postId]);
            }
        }
    }

    await Promise.all(loadPostPromises);

    document.getElementById('htCacheSize').textContent = `${await getCacheSizeReadable()} (IDB usage: ${await getIdbUsageReadable()})`;

    scanning = false;
}

function getImagesCount(postsToScan) {
    let r = 0;
    for (let i = 0; i < postsToScan.length; i++) {
        r += postsToScan[i].urls.length;
    }
    return r;
}

function isDollchan() {
    return document.getElementsByClassName('de-runned').length;
}

function isMakaba() {
    return document.getElementsByClassName('makaba').length
}

// Работаем только на главной и в тредах
if (!isMakaba()) return;

if (!storage.isDebugLogEnabled)
    Utils.trace = function() {}

HtCache.initCacheStorage(storage.maxCacheSize ? storage.maxCacheSize : 0);

createInterface();
CheckVersion();

setInterval(loadHiddenThread, 5000);
