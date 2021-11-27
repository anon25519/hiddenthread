let Utils = require('./utils.js')

///////////////////////////////////////////////////////////////////////////////
// LSB steganography

// Порядок упаковки:
// color (RGB), x, y, channel bit(0..7)

function getShuffledIndexList(length, steps) {
    let arrayIndexList = new Uint32Array(length / 4 * 3);
    for (let i = 0, j = 0; i < length; i++) {
        // Skip alpha channel
        if ((i + 1) % 4 != 0) {
            arrayIndexList[j] = i;
            j++;
        }
    }
    Utils.shuffleArray(arrayIndexList, steps);
    return arrayIndexList;
}

function hideDataToArray(array, data) {
    let requiredSteps = data.length * 8;
    let arrayIndexList = getShuffledIndexList(array.length, requiredSteps);
    let arrayIndex = arrayIndexList.length - 1; // Идем назад, т.к. индексы перемешаны с конца
    let arrayBitIndex = 0;
    for (let dataIndex = 0; dataIndex < data.length; dataIndex++) {
        for (let bitIndex = 7; bitIndex >= 0; bitIndex--) {
            let bit = (data[dataIndex] >> bitIndex) & 1;
            array[arrayIndexList[arrayIndex]] &= ~(1 << arrayBitIndex); // Clear bit
            array[arrayIndexList[arrayIndex]] |= bit << arrayBitIndex; // Set bit
            arrayIndex--;
            if (arrayIndex < 0) {
                arrayIndex = arrayIndexList.length - 1;
                arrayBitIndex++;
                if (arrayBitIndex == 8 && dataIndex < (data.length - 1)) {
                    throw new Error('Не удалось вместить данные в контейнер, осталось ещё ' +
                        (data.length - dataIndex - 1) + ' из ' + data.length + ' байт');
                }
            }
        }
    }
}

function extractDataFromArray(array, data) {
    let requiredSteps = data.length * 8;
    let arrayIndexList = getShuffledIndexList(array.length, requiredSteps);
    let arrayBitIndex = 0;
    let dataBitIndex = 7;
    let dataIndex = 0;
    let arrayIndex = arrayIndexList.length - 1; // Идем назад, т.к. индексы перемешаны с конца
    while (true) {
        let bit = (array[arrayIndexList[arrayIndex]] >> arrayBitIndex) & 1;
        data[dataIndex] |= bit << dataBitIndex;
        dataBitIndex--;
        if (dataBitIndex < 0) {
            dataBitIndex = 7;
            dataIndex++;
            if (dataIndex >= data.length) { return; }
        }

        arrayIndex--;
        if (arrayIndex < 0) {
            arrayIndex = arrayIndexList.length - 1;
            arrayBitIndex++;
            if (arrayBitIndex == 8) {
                throw new Error('Неожиданный конец контейнера, ожидалось ещё ' +
                    (data.length - dataIndex) + ' из ' + data.length + ' байт');
            }
        }
    }
}

///////////////////////////////////////////////////////////////////////////////


module.exports.hideDataToArray = hideDataToArray
module.exports.extractDataFromArray = extractDataFromArray
