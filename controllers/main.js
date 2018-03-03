'use strict';

const fs = require('fs');
const Mosaic = require("../models/Mosaic.js");
const Photo = require('../models/Photo.js');
const config = require('../config.js')
const utils = require('../utils.js');
const Jimp = require("jimp");
const mongoose = require('mongoose');

mongoose.Promise = global.Promise;

module.exports.createLocalMosaicObject = (inputImg, inputURL, extension = '.jpg', size = 125) => {
    let mosaicObject = {};

    return new Promise(function(resolve, reject){
        Jimp.read(inputImg).then(function(image){
            console.log("read image");
            mosaicObject["originalWidth"] = image.bitmap.width;
            mosaicObject["originalHeight"] = image.bitmap.height;

            let widthSmaller = image.bitmap.width < image.bitmap.height;
            let resizedImage = widthSmaller ? image.resize(size, Jimp.AUTO) : image.resize(Jimp.AUTO, size);

            mosaicObject["resizedWidth"] = resizedImage.bitmap.width;
            mosaicObject["resizedHeight"] = resizedImage.bitmap.height;

            mosaicObject["status"] = "uninitiated";
            mosaicObject["progress"] = 0.00;
            mosaicObject["mosaicMatrix"] = null;
            mosaicObject["inputImg"] = inputImg;
            mosaicObject["inputURL"] = inputURL;
            mosaicObject["timestampCreated"] = Date.now();

            utils.getColorData(mosaicObject["inputImg"], size).then((pixelDict) => {
                mosaicObject["resizedPixelDict"] = pixelDict;
                resolve(mosaicObject);
            });

        }).catch(function(readErr){
            reject(new Error(readErr));
        });
    });
}

module.exports.createExternalMosaicObject = (obj) => {
    // create DB record
    return new Promise(function(resolve, reject){
        let MosaicObject = new Mosaic(obj);
        Mosaic.insertMany([MosaicObject]).then((docs) => {
            resolve(docs[0]);
        }).catch((err) => {
            reject(new Error(err));
        });
    })
};


module.exports.updateExternalMosaicObject = (ID, updatedMatrix, status, progress) => {

    // update DB record
    return new Promise(function(resolve, reject){
        Mosaic.findOneAndUpdate({ _id: ID }, { mosaicMatrix: updatedMatrix, status: status, progress: progress }, { new: true }, (err, updatedMosaic) =>
         {
            if (err) {
                reject(new Error(err));
            } else {
                console.log(updatedMosaic["status"], updatedMosaic["progress"]);
                resolve(updatedMosaic);
            }
        });
    });
}

module.exports.findClosestBelow = (h, s, l, limit) => {
    return new Promise(function(resolve, reject){
        Photo.find({ medH: { $lte: h }, stdDev: { $lte: .2 } }).sort({ medH: -1 }).limit(limit).exec((err, docs) => {
            if (err) {
                reject(new Error(err));
            }
            if (docs === null) {
                resolve(null)
            } else {
                resolve(docs);
            }
        });
    })
}

module.exports.findClosestAbove = (h, s, l, limit) => {
    return new Promise(function(resolve, reject){
        Photo.find({ medH: { $lte: h }, stdDev: { $lte: .2 } }).sort({ medH: 1 }).limit(limit).exec((err, docs) => {
            if (err) {
                reject(new Error(err));
            }
            if (docs === null) {
                resolve(null)
            } else {
                resolve(docs);
            }
        });
    })
}

module.exports.findClosestOne = (h, s, l, limit, y, x) => {

    let minDistance = Infinity;
    let closestDoc = null;

    return new Promise((resolve, reject) => {
        module.exports.findClosestBelow(h, s, l, limit).then((closestDocsBelow) => {
            closestDocsBelow.forEach((doc) => {
                let currentDistance = Math.sqrt((doc["medH"] - h) * (doc["medH"] - h) + (doc["medS"] - s) * (doc["medS"] - s) + (doc["medL"] - l) * (doc["medL"] - l));
                if (currentDistance < minDistance) {
                    minDistance = currentDistance;
                    closestDoc = doc;
                }
            })
            return module.exports.findClosestAbove(h, s, l, limit);
        }).then((closestDocsBelow) => {
            closestDocsBelow.forEach((doc) => {
                let currentDistance = Math.sqrt((doc["medH"] - h) * (doc["medH"] - h) + (doc["medS"] - s) * (doc["medS"] - s) + (doc["medL"] - l) * (doc["medL"] - l));
                if (currentDistance < minDistance) {
                    minDistance = currentDistance;
                    closestDoc = doc;
                }
            })
            resolve(Object.assign(closestDoc, { "x": x, "y": y }));
        });
    })
}

module.exports.findClosestAll = (mongoID, pixelDict, y, upper, height, mosaicMatrix) => {
    return new Promise((resolve, reject) => {
        if (y >= height) {
            module.exports.updateExternalMosaicObject(mongoID, mosaicMatrix, 'complete', (y / height * 100).toFixed(2)).then((updatedMongoObj) => {
                resolve(mosaicMatrix);
            }).catch((err) => {
                reject(new Error(err));
            });
        } else if (y >= upper) {
            module.exports.updateExternalMosaicObject(mongoID, mosaicMatrix, 'pending', (y / height * 100).toFixed(2)).then((updatedMongoObj) => {
                console.log("done");
                resolve(mosaicMatrix);
            }).catch((err) => {
                reject(new Error(err));
            });
        } else {
            let promiseArray = [];
            for (let x in pixelDict[y]) {
                promiseArray.push(module.exports.findClosestOne(pixelDict[y][x]["h"], pixelDict[y][x]["s"], pixelDict[y][x]["l"], 50, y, x));
            }
            Promise.all(promiseArray).then((results) => {
                results.forEach((result) => {
                    mosaicMatrix[result["y"]][result["x"]] = {
                        "_id": result["_id"],
                        "previewSrc": result["previewSrc"],
                        "thumbnailSrc": result["thumbnailSrc"],
                        "originalURL": result["originalURL"],
                        "userName": result["userName"]
                    };
                })
                module.exports.updateExternalMosaicObject(mongoID, null, 'pending', (y / height * 100).toFixed(2)).then((updatedMongoObj) => {
                    resolve(module.exports.findClosestAll(mongoID, pixelDict, y + 1, upper, height, mosaicMatrix));
                }).catch((err) => {
                    reject(new Error(err));
                });
            }).catch((err) => {
                reject(new Error(err));
            });
        }
    });
}


module.exports.validateInputURL = (rawURL) => {

    let result = { "inputImg": null, "inputURL": null, "error": null };

    return new Promise((resolve, reject) => {
        if (rawURL.indexOf("instagram.com/p/") == -1) {
            result["error"] = "Please make sure the URL is in the following format: https://www.instagram.com/p/XXXXXXXXXXX/"
            resolve(result);
        }
        utils.requestPage(rawURL).then((body) => {

            if (body.indexOf("Page Not Found") != -1) {
                result["error"] = "Sorry, looks like this instagram page either doesn't exist or is private.";
                resolve(result);
            }

            let start = body.indexOf('<meta property="og:image" content="') + 35;
            let end = body.substring(start).indexOf('.jpg') + 4 + start;
            let inputImg = body.substring(start, end);
            result["inputImg"] = inputImg;

            start = body.indexOf('<link rel="canonical" href="') + 28;
            end = body.substring(start).indexOf('"') + start;
            let inputURL = body.substring(start, end);
            result["inputURL"] = inputURL;
            resolve(result);

        }).catch((err) => {
            reject(new Error(err));
        });
    });
};

module.exports.checkDuplicateMosaic = (url) => {
    return new Promise((resolve, reject) => {
        Mosaic.findOne({ inputURL: url }, (err, mosaic) => {
            if (err)
                reject(new Error(err));
            resolve(mosaic);
        });
    });
};

module.exports.getMosaicByID = (mosaicID) => {
    return new Promise((resolve, reject) => {
        Mosaic.findById(mosaicID, (err, mosaic) => {
            if (err)
                reject(new Error(err));
            resolve(mosaic);
        });
    })
};