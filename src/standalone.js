let Utils = require('./utils.js')
let Crypto = require('./crypto.js')
let Post = require('./post.js')

function createElementFromHTML(htmlString) {
    let div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstElementChild;
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
    let filename = 'image.png'
    if (containers.length > 0) {
        let containersNum = new Array(containers.length);
        for (let i = 0; i < containersNum.length; i++) containersNum[i] = i;
        Utils.shuffleArray(containersNum, containersNum.length, true);

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

        filename = container.name;
        let l = filename.split('.')
        filename = l.slice(0, l.length - 1).join('.') + '.png'
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
            imageResult.canvas.toBlob(function(blob) {
                let img = document.createElement('img');
                img.style = "max-width: 300px;";
                let imgUrl = URL.createObjectURL(blob);

                img.src = imgUrl;
                imageContainerDiv.appendChild(createElementFromHTML('<span>Картинка со скрытопостом:</span>'));
                imageContainerDiv.appendChild(document.createElement('br'));
                imageContainerDiv.appendChild(img);

                let downloadLink  = document.createElement('a');
                downloadLink.innerText = 'Сохранить картинку'
                downloadLink.href = imgUrl;
                downloadLink.download = filename;
                imageContainerDiv.appendChild(document.createElement('br'));
                imageContainerDiv.appendChild(downloadLink);
              });

            alert('Спрятано ' + imageResult.len + ' байт (занято ' + imageResult.percent + '% изображения)');
        })
        .catch(function (e) {
            console.log('HiddenThread: Ошибка при создании скрытопоста: ' + e + ' stack:\n' + e.stack);
            alert('Ошибка при создании скрытопоста: ' + e);
        });
}

function convertToHtml(text) {
    text = text
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
    let lines = text.split('\n');
    text = "";
    for (let i = 0; i < lines.length; i++) {
        text += `${lines[i]}<br>`;
    }
    return text;
}

function renderHiddenPost(postResult) {
    console.log(`HiddenThread: Post is hidden, its object:`);
    console.log(postResult);

    let clearPost = document.getElementById('decodedPost');
    clearPost.innerHTML = '';
    let postBodyDiv = document.createElement('div');
    postBodyDiv.classList.add("post");
    postBodyDiv.classList.add("post_type_reply");
    postBodyDiv.classList.add("post_type_hiddenthread");

    let postMetadata = document.createElement('div');
    postMetadata.style = 'font-family: courier new;';
    let postArticle = document.createElement('article');
    postArticle.classList.add("post__message");

    let postArticleMessage = document.createElement('div');
    postArticleMessage.innerHTML = convertToHtml(postResult.post.message);

    if (postResult.isPrivate) {
        postMetadata.appendChild(createElementFromHTML('<div style="color:orange;"><i>Этот пост виден только с твоим приватным ключом</i></div>'));
    }
    let timeString = (new Date(postResult.header.timestamp * 1000))
        .toISOString().replace('T', ' ').replace(/\.\d+Z/g, '');

    postMetadata.appendChild(createElementFromHTML('<div>Дата создания скрытопоста (UTC): ' + timeString + '</div>'));
    postMetadata.appendChild(Post.createFileLinksDiv(postResult.post.files, postResult.post.hasSkippedFiles, 0));

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
}

/*
Проверяет есть ли в этом посте скрытый пост, расшифровывает
и выводит результат
*/
function loadPost() {
    let clearPost = document.getElementById('decodedPost');
    clearPost.innerHTML = '';

    let containers = document.getElementById('hiddenContainerInputDecode').files;
    let imgFile = containers[0];

    if (!imgFile)
    {
        alert('Выберите картинку со скрытопостом!')
        return;
    }

    var fr = new window.FileReader();
    fr.onload = (function () {
        var img = new Image();
        img.onload = (function () {
            Post.loadPostFromImage(img,
                document.getElementById('hiddenThreadPasswordDecode').value,
                document.getElementById('privateKeyDecode').value)
                .then(function (postResult) {
                    console.log(postResult);
                    if (postResult == null)
                    {
                        alert('Не удалось декодировать скрытопост - неверный пароль или ключ, либо это обычная картинка')
                        return;
                    }
                    renderHiddenPost(postResult);
                });
        });
        img.src = fr.result;
    });
    fr.readAsDataURL(imgFile);

}

function createInterface() {
    // listeners
    let enlargeCheck = document.getElementById('isDataRatioLimited')
    enlargeCheck.onchange = function () {
        document.getElementById('maxDataRatioDiv').style = `display:${enlargeCheck.checked ? 'block' : 'none'}`;
    }

    document.getElementById('hiddenDecodeButton').onclick = function () {
        loadPost();
    }

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
        Crypto.generateKeyPair()
            .then(function (pair) {
                document.getElementById('privateKey').value = pair[0];
                document.getElementById('publicKey').value = pair[1];
            });
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

document.addEventListener("DOMContentLoaded", createInterface);
