let Utils = require('./utils.js')
let Crypto = require('./crypto.js')
let Post = require('./post.js')

const CURRENT_VERSION = "0.5";
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

// https://medium.com/@karenmarkosyan/how-to-manage-promises-into-dynamic-queue-with-vanilla-javascript-9d0d1f8d4df5
class Queue {
    static queue = [];
    static pendingPromise = false;

    static enqueue(promise) {
      return new Promise((resolve, reject) => {
          this.queue.push({
              promise,
              resolve,
              reject,
          });
          this.dequeue();
      });
    }

  static dequeue() {
      if (this.workingOnPromise) {
        return false;
      }
      const item = this.queue.shift();
      if (!item) {
        return false;
      }
      try {
        this.workingOnPromise = true;
        item.promise()
          .then((value) => {
            this.workingOnPromise = false;
            item.resolve(value);
            this.dequeue();
          })
          .catch(err => {
            this.workingOnPromise = false;
            item.reject(err);
            this.dequeue();
          })
      } catch (err) {
        this.workingOnPromise = false;
        item.reject(err);
        this.dequeue();
      }
      return true;
    }
}


function createHiddenPost() {
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

    Post.createHiddenPostImpl(
        {
            'image': container,
            'maxDataRatio': maxDataRatio,
            'isDownscaleAllowed': isDownscaleAllowed
        },
        document.getElementById('hiddenPostInput').value,
        document.getElementById('hiddenFilesInput').files,
        document.getElementById('hiddenThreadPassword').value,
        document.getElementById('privateKey').value,
        document.getElementById('otherPublicKey').value)
        .then(function (imageResult) {
            imageResult.canvas.toBlob(function (blob) {
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
            });

            alert('Спрятано ' + imageResult.len + ' байт (занято ' + imageResult.percent + '% изображения)');
        })
        .catch(function (e) {
            Utils.trace('HiddenThread: Ошибка при создании скрытопоста: ' + e + ' stack:\n' + e.stack);
            alert('Ошибка при создании скрытопоста: ' + e);
        });
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
            if (text.substring(i, i + t.open.length) === t.open) {
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
        if (text.substring(i, i + tag.open.length) === tag.open) {
            skip += 1;
            continue;
        }

        if (text.substring(i, i + tag.close.length) === tag.close) {
            skip -= 1;
            if (skip == -1) {
                return i;
            }
        }
    }
    return -1;
}

// Добавление HTML скрытопоста к основному посту
function addHiddenPostToHtml(postId, postResult) {
    Utils.trace(`HiddenThread: Post ${postId} is hidden, its object:`);
    Utils.trace(postResult);

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
    postArticleMessage.innerHTML = convertToHtml(postResult.post.message);

    if (postResult.isPrivate) {
        postMetadata.appendChild(createElementFromHTML('<div style="color:orange;"><i>Этот пост виден только с твоим приватным ключом</i></div>'));
    }
    let timeString = (new Date(postResult.header.timestamp * 1000))
        .toISOString().replace('T', ' ').replace(/\.\d+Z/g, '');
    let d = clearPost.getElementsByClassName('post__time')[0].textContent.split(' ');
    let postDateMs = Date.parse(`20${d[0].split('/')[2]}-${d[0].split('/')[1]}-${d[0].split('/')[0]}T${d[2]}Z`);
    if (Math.abs(postDateMs/1000 - postResult.header.timestamp) > 24*3600) {
        timeString += ' <span style="color:red;">(неверное время поста!)</span>';
    }
    postMetadata.appendChild(createElementFromHTML('<div>Дата создания скрытопоста (UTC): ' + timeString + '</div>'));
    postMetadata.appendChild(Post.createFileLinksDiv(postResult.post.files, postResult.post.hasSkippedFiles, postId));

    if (postResult.verifyResult != null) {
        let postArticleSign = document.createElement('div');
        postArticleSign.innerHTML =
            'Публичный ключ: <span ' +
            (postResult.verifyResult.isVerified ? 'style="color:green;"' : 'style="color:red;"') + '>' +
            postResult.verifyResult.publicKey + '</span>' +
            (postResult.verifyResult.isVerified ? '' : ' (неверная подпись!)');
        postMetadata.appendChild(postArticleSign);
    }
    postArticle.appendChild(postMetadata);
    if (postResult.post.unpackResult) {
        postArticle.appendChild(createElementFromHTML(
            `<div style="font-family:courier new;color:red;">${postResult.post.unpackResult}</div>`));
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

function renderHiddenPost(postId, postResult) {
    let res = parseMessage(postResult.post.message);
    postResult.post.message = res.message;
    addHiddenPostToHtml(postId, postResult);
    addReplyLinks(postId, res.refPostIdList);
    // TODO: отображение скрытопостов во всплывающих постах с куклоскриптом
    addHiddenPostToObj(postId); // Текст скрытопоста берется из HTML
}

/* Перепроверить все посты */
function reloadHiddenPosts() {
    // очистить список скаченных и просмотренных изображений
    // чтобы они снова скачались и просканировались
    loadedImages = new Set();
    watchedImages = new Set();
    loadHiddenThread();
}

/*
Проверяет есть ли в этом посте скрытый пост, расшифровывает
и выводит результат
*/
async function loadPost(postId, file_url) {
    let img = new Image();
    img.src = file_url;
    await img.decode();

    Utils.trace('HiddenThread: loading post ' + postId + ' ' + file_url);
    loadedImages.add(file_url);
    document.getElementById("imagesLoadedCount").textContent = loadedImages.size;
    let postResult = await Post.loadPostFromImage(
        img,
        document.getElementById('hiddenThreadPassword').value,
        document.getElementById('privateKey').value)

    if(postResult == null) return;
    loadedPosts.add(file_url);
    document.getElementById("hiddenPostsLoadedCount").textContent = loadedPosts.size;
    renderHiddenPost(postId, postResult);
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
        .post_type_hiddenthread { border-left: 3px solid #F00000; border-right: 3px solid #F00000; }
    `
    if (style.styleSheet) {
        // This is required for IE8 and below.
        style.styleSheet.cssText = css;
    } else {
        style.appendChild(document.createTextNode(css));
    }
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
        settingsWindow.style.display = settingsWindow.style.display == 'none' ? 'block' : 'none';
    }
    document.getElementById("hiddenThreadSettingsCancel").onclick = function() {
        document.getElementById('hiddenThreadSettingsWindow').style.display = 'none';
    }
    document.getElementById("hiddenThreadSettingsSave").onclick = function() {
        setStorage({ isDebugLogEnabled: document.getElementById("htIsDebugLogEnabled").checked });
        setStorage({ isQueueLoadEnabled: document.getElementById("htIsQueueLoadEnabled").checked });
        document.getElementById('hiddenThreadSettingsWindow').style.display = 'none';
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

    document.getElementById('reloadHiddenPostsButton').onclick = reloadHiddenPosts;

    document.getElementById('hiddenFilesClearButton').onclick = function () {
        document.getElementById('hiddenFilesInput').value = null;
    }
    document.getElementById('hiddenContainerClearButton').onclick = function () {
        document.getElementById('hiddenContainerInput').value = null;
    }
    document.getElementById('createHiddenPostButton').onclick = function () {
        createHiddenPost();
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


// множество просмотренных постов
var watchedPosts = new Set();
// множество просмотренных url картинок
var watchedImages = new Set();
// множество url с скаченными картинками
var loadedImages = new Set();
// множество url с загруженными скрытопостами
var loadedPosts = new Set();
let scanning = false;
/*
Просмотреть все посты и попробовать расшифровать
*/
function loadHiddenThread() {
    if (scanning) {
        return; // Чтобы не запускалось в нескольких потоках
    }
    scanning = true;

    let postsToScan = getPostsToScan();

    document.getElementById("imagesCount").textContent = getImagesCount(postsToScan).toString();

    for (let post of postsToScan) {
        for (let url of post.urls) {
            if (loadedImages.has(url) || loadedPosts.has(url) || watchedImages.has(url)) {
                continue;
            }
            watchedImages.add(url);

            function promiseGenerator() {
                return new Promise(async function(resolve, reject) {
                    try {
                        await loadPost(post.postId, url);
                    }
                    catch(e) {
                        Utils.trace('HiddenThread: Ошибка при загрузке поста: ' + e + ' stack:\n' + e.stack);
                    }
                    resolve();
                });
            }

            if(storage.isQueueLoadEnabled) {
                Queue.enqueue(promiseGenerator);
            } else {
                promiseGenerator();
            }
        }
        if (!watchedPosts.has(post.postId)) {
            watchedPosts.add(post.postId);
            if (document.getElementById('hideNormalPosts').value) {
                hidePosts([post.postId]);
            }
        }
    }
    document.getElementById("imagesLoadedCount").textContent = loadedImages.size;
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

createInterface();
CheckVersion();

setInterval(loadHiddenThread, 5000);
