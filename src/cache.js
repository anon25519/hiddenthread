let Utils = require('./utils.js')

let db = null;
let maxCacheSize = 0;
let WRONG_PASSWORDS_LIMIT = 10;

async function initCacheStorage(_maxCacheSize) {
    let openRequest = indexedDB.open("htdb", 1);
    maxCacheSize = _maxCacheSize;

    let openRequestResult = await new Promise(function(resolve, reject) {
        openRequest.onerror = function(event) {
            Utils.trace('HiddenThread: initCacheStorage open() error');
            reject(event);
        };
        openRequest.onsuccess = function(event) {
            resolve(event);
        };
        openRequest.onupgradeneeded = function(event) {
            Utils.trace('HiddenThread: indexedDB onupgradeneeded');
            const db = openRequest.result;
            let objectStore = db.createObjectStore("hiddenposts", { keyPath: "id", autoIncrement: true });
            objectStore.createIndex("img_id", "img_id", { unique: true });
            objectStore.add({totalSize: 0});
        }
    });

    db = openRequestResult.target.result;
}

async function clearStore() {
    let transaction = db.transaction(["hiddenposts"], "readwrite");
    let objectStore = transaction.objectStore("hiddenposts");
    let request = objectStore.clear();
    await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: clearStore clear() error');
            reject(event);
        };
    });
    request = objectStore.put({totalSize: 0, id: 1});
    await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: clearStore put() error');
            reject(event);
        };
    });
}

function getPostSize(post) {
    let size = JSON.stringify(post).length;
    if (post.hiddenPost) {
        // Добавляем размер blob
        size += post.hiddenPost.zipData.size;
    }
    return size;
}

async function saveHiddenPostCache(objectStore, imgId, hiddenPost, id)
{
    let request = null;
    let size = null;
    if (id) {
        let post = {img_id: imgId, id: id, hiddenPost: hiddenPost, size: 0};
        size = getPostSize(post);
        post.size = size;
        request = objectStore.put(post)
    } else {
        let post = {img_id: imgId, hiddenPost: hiddenPost, size: 0};
        size = getPostSize(post);
        post.size = size;
        request = objectStore.add(post);
    }

    await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: saveHiddenPostCache error');
            reject(event);
        };
    });
    return size;
}

async function saveNormalPostCache(objectStore, imgId, wrongPasswordHashes, wrongPrivateKeyHashes, id)
{
    let request = null;
    let size = null;
    if (id) {
        let post = {img_id: imgId, id: id, wrongPasswordHashes: wrongPasswordHashes,
            wrongPrivateKeyHashes: wrongPrivateKeyHashes, size: 0};
        size = getPostSize(post);
        post.size = size;
        request = objectStore.put(post)
    } else {
        let post = {img_id: imgId, wrongPasswordHashes: wrongPasswordHashes,
            wrongPrivateKeyHashes: wrongPrivateKeyHashes, size: 0};
        size = getPostSize(post);
        post.size = size;
        request = objectStore.add(post);
    }

    await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: saveNormalPostCache error');
            reject(event);
        };
    });
    return size;
}

async function getCachedPostWithStore(key)
{
    let transaction = db.transaction(["hiddenposts"], "readwrite");
    let objectStore = transaction.objectStore("hiddenposts");
    let index = objectStore.index('img_id');
    let request = index.get(key);
    let cachedPost = await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: getCachedPostWithStore get() error');
            reject(event);
        };
    });
    return { post: cachedPost, objectStore: objectStore };
}

async function checkCacheOverflow(objectStore, sizeDelta)
{
    // Получаем текущий размер кэша
    let request = objectStore.get(1);
    let getSizeResult = await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: checkCacheOverflow get() error');
            reject(event);
        };
    });

    let newTotalSize = getSizeResult.totalSize + sizeDelta;

    // Обновляем размер кэша
    request = objectStore.put({totalSize: newTotalSize, id: 1});
    await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: checkCacheOverflow put() error');
            reject(event);
        };
    });

    if (newTotalSize > (maxCacheSize * 1024 * 1024))
    {
        let clearRequest = objectStore.clear();
        await new Promise(function(resolve, reject) {
            clearRequest.onsuccess = function(event) {
                resolve(event.target.result);
            };
            clearRequest.onerror = function(event) {
                Utils.trace('HiddenThread: checkCacheOverflow clear() error');
                reject(event);
            };
        });
        request = objectStore.put({totalSize: 0, id: 1});
        await new Promise(function(resolve, reject) {
            request.onsuccess = function(event) {
                resolve(event.target.result);
            };
            request.onerror = function(event) {
                Utils.trace('HiddenThread: checkCacheOverflow put() error');
                reject(event);
            };
        });
    }
}

function insertWithLimit(array, value) {
    array.push(value);
    if (array.length > WRONG_PASSWORDS_LIMIT) {
        array.shift();
    }
    return array;
}

async function updateCache(imgId, loadedPost, passwordHashes, privateKeyHashes) {
    if (maxCacheSize == 0)
        return;

    let cache = await getCachedPostWithStore(imgId);
    let cachedPost = cache.post;
    let objectStore = cache.objectStore;

    if (cachedPost && cachedPost.hiddenPost)
        return;

    let oldCachedPostSize = cachedPost ? cachedPost.size : 0;
    let newCachedPostSize = undefined;

    if (loadedPost) {
        if (cachedPost && !cachedPost.hiddenPost) {
            // в кэше не скрытопост
            newCachedPostSize = await saveHiddenPostCache(objectStore, imgId, loadedPost, cachedPost.id);
        } else if(!cachedPost) {
            // кэш пуст
            newCachedPostSize = await saveHiddenPostCache(objectStore, imgId, loadedPost);
        } else {
            throw new Error('assert');
        }
    } else {
        if (cachedPost && !cachedPost.hiddenPost) {
            function updateArray(oldArray, newArray) {
                let newValues = newArray.filter(x => !oldArray.includes(x));
                for (let value of newValues) {
                    oldArray = insertWithLimit(oldArray, value);
                }
                return { updated: newValues.length > 0, updatedArray: oldArray };
            }
            let updatePasswordsResult = updateArray(cachedPost.wrongPasswordHashes, passwordHashes);
            let updatePrivateKeysResult = updateArray(cachedPost.wrongPrivateKeyHashes, privateKeyHashes);

            if (updatePasswordsResult.updated || updatePrivateKeysResult.updated) {
                // в кэше не скрытопост и в кэше нет хотя бы одного текущего пароля или ключа
                newCachedPostSize = await saveNormalPostCache(objectStore, imgId,
                    updatePasswordsResult.updatedArray, updatePrivateKeysResult.updatedArray, cachedPost.id);
            } else {
                newCachedPostSize = oldCachedPostSize;
            }
        } else if(!cachedPost) {
            // кэш пуст
            newCachedPostSize = await saveNormalPostCache(objectStore, imgId,
                passwordHashes.slice(0, WRONG_PASSWORDS_LIMIT), privateKeyHashes.slice(0, WRONG_PASSWORDS_LIMIT));
        } else {
            throw new Error('assert');
        }
    }

    let sizeDelta = newCachedPostSize - oldCachedPostSize;
    await checkCacheOverflow(objectStore, sizeDelta);
}

async function getCachedPost(imgId) {
    let transaction = db.transaction(["hiddenposts"], "readonly");
    let objectStore = transaction.objectStore("hiddenposts");
    let index = objectStore.index('img_id');
    let request = index.get(imgId);
    let cachedPost = await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: getCachedPost get() error');
            reject(event);
        };
    });
    return cachedPost;
}

async function getCacheSize() {
    let transaction = db.transaction(["hiddenposts"], "readonly");
    let objectStore = transaction.objectStore("hiddenposts");
    let request = objectStore.get(1);
    let result = await new Promise(function(resolve, reject) {
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            Utils.trace('HiddenThread: getCacheSize get() error');
            reject(event);
        };
    });
    return result.totalSize;
}

module.exports.updateCache = updateCache
module.exports.getCachedPost = getCachedPost
module.exports.initCacheStorage = initCacheStorage
module.exports.clearStore = clearStore
module.exports.getCacheSize = getCacheSize
