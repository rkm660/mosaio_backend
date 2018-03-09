'use strict';

const fs = require('fs');
const mongoose = require('mongoose');
const config = require('./config.js')
const utils = require('./utils.js');
const main = require('./controllers/main.js');

mongoose.Promise = global.Promise;

// step 1
module.exports.validate = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
        if (!body.rawURL) {
            callback(null, utils.createErrorResponse(400, "Request must contain rawURL."));
        }
    } catch (e) {
        callback(null, utils.createErrorResponse(500, "Error parsing request."));
    }

    db.once('open', () => {

        // validate input URL
        main.validateInputURL(body.rawURL)
            .then((validatedURLObject) => {
                let inputImg = validatedURLObject['inputImg'];
                let inputURL = validatedURLObject['inputURL'];
                let error = validatedURLObject['error'];

                // some problem with the input URL
                if (error) {
                    callback(null, utils.createErrorResponse(400, error));
                    db.close();
                } else {
                    // check for duplicate mosaic
                    main.checkDuplicateMosaic(inputURL).then((mosaic) => {
                        // mosaic object already exists
                        if (mosaic) {
                            callback(null, utils.createValidResponse({ '_id': mosaic['_id'] }));
                        }
                        // return normalized url and img src
                        else {
                            callback(null, utils.createValidResponse({ '_id': null, 'inputImg': inputImg, 'inputURL': inputURL }));
                        }
                        db.close();
                    }).catch((err) => {
                        // error in checking for duplicate mosaic in DB
                        callback(null, utils.createErrorResponse(err.statusCode, err.message));
                        db.close();
                    })
                }
            }).catch((err) => {
                // error in validating input URL
                callback(null, utils.createErrorResponse(err.statusCode, err.message));
                db.close();
            });
    });
}

// step 2
module.exports.create = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(null, utils.createErrorResponse(501, "Error parsing request."));
    }
    db.once('open', () => {
        // mosaic object already exists
        if (body._id !== null) {
            callback(null, utils.createValidResponse(Object.assign({}, { _id: body._id })));
            db.close();
        } else {
            // create mosaic object locally, then in DB
            main.createLocalMosaicObject(body.inputImg, body.inputURL).then((localMosaicObject) => {
                main.createExternalMosaicObject(localMosaicObject).then((externalMosaicObject) => {
                    callback(null, utils.createValidResponse(Object.assign({}, { _id: externalMosaicObject['_id'] })));
                    db.close();
                }).catch((err) => {
                    callback(null, utils.createErrorResponse(500, "Error creating DB object."));
                    db.close();
                });
            }).catch((err) => {
                callback(null, utils.createErrorResponse(500, "Error creating internal object."));
                db.close();
            });
        }
    });
}

// step 3
module.exports.dequeue = (event, context, callback) => {
    const THRESHOLD = 10;

    const db = mongoose.connect(config.mongoURI).connection;

    db.once('open', () => {
        main.countPendingMosaics().then((result) => {
            let difference = THRESHOLD - result;
            if (difference > 0) {
                main.getQueuedMosaics(difference).then((mosaics) => {
                    let executionPromises = mosaics.map((mosaic) => { return main.init(mosaic["_id"]) });
                    Promise.all(executionPromises).then((results) => {
                        console.log(results.length.toString() + " mosaics initialized.");
                        callback(null, utils.createValidResponse({ "message": results.length.toString() + " mosaics initialized." }))
                        db.close();
                    }).catch((err) => {
                        callback(null, utils.createErrorResponse(501, "Error initializing mosaics."));
                        db.close();
                    });
                }).catch((err) => {
                    callback(null, utils.createErrorResponse(501, "No pending mosaics."));
                    db.close();
                });
            } else {
                callback(null, utils.createValidResponse({ "message": "Nothing to create." }))
                db.close();
            }
        })
    });
}


module.exports.iterator = (event, context, callback) => {
    let index = event.iterator.index
    let step = event.iterator.step
    let height = event.iterator.height

    index += step

    callback(null, {
        index,
        step,
        height,
        continue: index <= height
    })
}

module.exports.assemble = (event, context, callback) => {

    const db = mongoose.connect(config.mongoURI).connection;

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(event._id, {
            ["mosaicMatrix." + event.iterator.index.toString()]: 1,
            "resizedPixelDict": 1,
            "status": 1
        }).then((mosaicObject) => {

            main.findClosestAll(event._id, mosaicObject['resizedPixelDict'], event.iterator.index, event.iterator.height, mosaicObject["mosaicMatrix"]).then((bool) => {
                callback(null, {
                    _id: event._id,
                    iterator: {
                        index: event.iterator.index,
                        step: event.iterator.step,
                        height: event.iterator.height,
                    }
                });
                db.close();
            }).catch((err) => {
                console.log(err);
                callback(null, utils.createErrorResponse(501, "Error in assemble."));
                db.close();
            });
        });
    });
}


module.exports.getPhotos = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
        if (!body.photoIDs) {
            callback(null, utils.createErrorResponse(400, "Request must contain array of photoIDs."));
        }
    } catch (e) {
        callback(null, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {
        // start mosaic creation process
        main.getPhotosByID(body.photoIDs).then((photos) => {
            callback(null, utils.createValidResponse(photos));
            db.close();
        }).catch((err) => {
            callback(null, utils.createErrorResponse(501, "Error in getPhotos."));
            db.close();
        });
    });
}


module.exports.getMosaicPartial = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
        if (!body.mosaicID || body.part === undefined) {
            callback(null, utils.createErrorResponse(400, "Request must contain mosaicID."));
        }
    } catch (e) {
        callback(null, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {
        main.getMosaicByID(body.mosaicID).then((mosaicObject) => {
            switch (body.part) {
                case 'META':
                    callback(null, utils.createValidResponse(Object.assign({}, {
                        inputImg: mosaicObject['inputImg'],
                        inputURL: mosaicObject['inputURL'],
                        originalWidth: mosaicObject['originalWidth'],
                        originalHeight: mosaicObject['originalHeight'],
                        resizedWidth: mosaicObject['resizedWidth'],
                        resizedHeight: mosaicObject['resizedHeight'],
                        status: mosaicObject['status'],
                        progress: mosaicObject['progress'],
                        timestampInitialized: mosaicObject['timestampInitialized'],
                        timestampFinished: mosaicObject['timestampFinished'],
                        timestampQueued: mosaicObject['timestampQueued']
                    })));
                    db.close();
                case 'PIXEL_DICT':
                    callback(null, utils.createValidResponse(Object.assign({}, {
                        resizedPixelDict: mosaicObject['resizedPixelDict'],
                        _id: 0
                    })));
                    db.close();
                case 'MOSAIC_1':
                    callback(null, utils.createValidResponse(Object.assign({}, {
                        mosaicMatrix_1: Object.assign({}, utils.getDictionarySlice(mosaicObject['mosaicMatrix'], 0, 50)),
                        _id: 0
                    })));
                    db.close();
                case 'MOSAIC_2':
                    callback(null, utils.createValidResponse(Object.assign({}, {
                        mosaicMatrix_2: Object.assign({}, utils.getDictionarySlice(mosaicObject['mosaicMatrix'], 50, 100)),
                        _id: 0
                    })));
                    db.close();
                case 'MOSAIC_3':
                    callback(null, utils.createValidResponse(Object.assign({}, {
                        mosaicMatrix_3: Object.assign({}, utils.getDictionarySlice(mosaicObject['mosaicMatrix'], 100, Object.keys(mosaicObject['mosaicMatrix']).length - 1)),
                        _id: 0
                    })));
                    db.close();
                default:
                    callback(null, utils.createValidResponse({}));
                    db.close();
            }
        });
    });
}