const fs = require('fs');
const mongoose = require('mongoose');
const config = require('./config.js')
const utils = require('./utils.js');
const main = require('./controllers/main.js');

mongoose.Promise = global.Promise;

module.exports.validate = function(event, context, callback) {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {

        // validate input URL
        main.validateInputURL(body.rawURL)
            .then((validatedURLObject) => {
                let inputImg = validatedURLObject['inputImg'];
                let inputURL = validatedURLObject['inputURL'];
                let error = validatedURLObject['error'];
                if (error != null) {
                    callback(error, utils.createErrorResponse(501, error));
                    db.close();
                } else {
                    // check for duplicate mosaic
                    main.checkDuplicateMosaic(inputImg).then((mosaic) => {
                        if (mosaic) {
                            callback(null, utils.createValidResponse({ '_id': mosaic['_id'] }));
                        } else {
                            callback(null, utils.createValidResponse({ '_id': null, 'inputImg': inputImg, 'inputURL': inputURL }));
                        }
                        db.close();
                    }).catch((err) => {
                        callback(err, utils.createErrorResponse(err.statusCode, err.message));
                        db.close();
                    })
                }
            }).catch((err) => {
                callback(err, utils.createErrorResponse(err.statusCode, err.message));
                db.close();
            });
    });
}

module.exports.create = function(event, context, callback) {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    // create mosaic object locally, then in DB
    db.once('open', () => {
        main.createLocalMosaicObject(body.inputImg, body.inputURL).then((localMosaicObject) => {
            main.createExternalMosaicObject(localMosaicObject).then((externalMosaicObject) => {
                callback(null, utils.createValidResponse(externalMosaicObject));
                db.close();
            });
        });
    })
}

module.exports.assemble = function(event, context, callback) {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    // start mosaic creation process
    db.once('open', () => {
        main.getMosaicByID(body._id).then((mosaicObject) => {

            let matrix;

            if (mosaicObject["mosaicMatrix"] == null) {
                matrix = utils.createEmptyMatrix(mosaicObject['resizedWidth'], mosaicObject['resizedHeight']);
            } else {
                matrix = mosaicObject["mosaicMatrix"];
            }

            let height = Object.keys(mosaicObject['resizedPixelDict']).length;

            main.findClosestAll(db, body._id, mosaicObject['resizedPixelDict'], body.y, body.n, height, matrix).then((mosaicMatrix) => {
                callback(null, utils.createValidResponse({ '_id': body._id, 'y': body.y, 'n': body.n, 'height': height }));
                db.close();
            });
        });
    });
}