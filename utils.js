'use strict';

const math = require("mathjs")
const request = require('request')
const Promise = require("bluebird");
const fs = require('fs');
const path = require('path');
const Jimp = require("jimp");

module.exports.createValidResponse = (body) => ({
    statusCode: 200,
    headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true
    },
    body: JSON.stringify(body),
});

module.exports.createErrorResponse = (statusCode, message) => ({
    statusCode: statusCode || 501,
    headers: {
        "Access-Control-Allow-Origin": "*", 
        "Access-Control-Allow-Credentials": true
    },
    body: message || 'Incorrect ID',
});

module.exports.requestPage = (url) => {
    return new Promise(function(resolve, reject){
        request(url, (error, response, body) => {
            if (error) {
                return reject(new Error(error));
            }
            return resolve(body);
        });
    });
}

module.exports.guid = () => {
    let s4 = () => {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

module.exports.rgbToHsl = (r, g, b) => {
    r /= 255, g /= 255, b /= 255;

    var max = Math.max(r, g, b),
        min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max == min) {
        h = s = 0; // achromatic
    } else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }

        h /= 6;
    }

    return [h, s, l];
}

module.exports.convertPixelsToHSL = (pixelDict) => {
    let hArray = [];
    let sArray = [];
    let lArray = [];
    for (let w in pixelDict) {
        for (let h in pixelDict[w]) {
            let hsl = rgbToHsl(pixelDict[w][h]["r"], pixelDict[w][h]["g"], pixelDict[w][h]["b"]);
            hArray.push(hsl[0]);
            sArray.push(hsl[1]);
            lArray.push(hsl[2]);
        }
    }
    return [hArray, sArray, lArray];
}

module.exports.filteredColorData = (pixelDict) => {
    let convertedHSLArray = exports.convertPixelsToHSL(pixelDict);

    let medH = math.median(convertedHSLArray[0]);
    let medS = math.median(convertedHSLArray[1]);
    let medL = math.median(convertedHSLArray[2]);

    let hVar = math.var(convertedHSLArray[0]);
    let sVar = math.var(convertedHSLArray[1]);
    let lVar = math.var(convertedHSLArray[2]);

    let stdDev = math.sqrt(hVar + sVar + lVar);

    return { "medH": medH, "medS": medS, "medL": medL, "stdDev": stdDev };
}

module.exports.createEmptyMatrix = (width, height) => {
    let resultMatrix = {}
    for (var i = 0; i < height; i++) {
        resultMatrix[i] = {};
        for (var j = 0; j < width; j++) {
            resultMatrix[i][j] = null;
        }
    }
    return resultMatrix;
}

module.exports.getColorData = (image_url, size) => {

    let pixelDict = {};

    return new Promise(function(resolve, reject){
        Jimp.read(image_url, function(err, image){
            if (err) {
                resolve(pixelDict);
            } else {
                if (image == undefined) {
                    resolve(pixelDict);
                } else {

                    let widthSmaller = image.bitmap.width < image.bitmap.height;
                    let resizedImage = widthSmaller ? image.resize(size, Jimp.AUTO) : image.resize(Jimp.AUTO, size);

                    for (let h = 0; h < resizedImage.bitmap.height; h++) {
                        pixelDict[h] = {};
                        for (let w = 0; w < resizedImage.bitmap.width; w++) {
                            pixelDict[h][w] = {};
                        }
                    }
                    
                    resizedImage.scan(0, 0, resizedImage.bitmap.width, resizedImage.bitmap.height, function(x, y, idx){
                        var red = this.bitmap.data[idx + 0];
                        var green = this.bitmap.data[idx + 1];
                        var blue = this.bitmap.data[idx + 2];
                        var alpha = this.bitmap.data[idx + 3];

                        let hsl = module.exports.rgbToHsl(red, green, blue)

                        pixelDict[y][x]["h"] = hsl[0].toFixed(5);
                        pixelDict[y][x]["s"] = hsl[1].toFixed(5);
                        pixelDict[y][x]["l"] = hsl[2].toFixed(5);

                        if (x == resizedImage.bitmap.width - 1 && y == resizedImage.bitmap.height - 1) {
                            resolve(pixelDict);
                        }
                    });
                }
            }
        });
    });
}